#!/usr/bin/env python3
"""
CMU Schedule of Classes (SOC) Scraper
Runs daily from the server's cron job. Tries upcoming semesters; writes backend/data/soc.json
only when a real, non-empty scrape succeeds.

Scrapes each (semester, department) once per configured campus, then merges
courses that appear at multiple campuses. Each section is tagged with its
campus; each course's `campus` field lists every campus it runs at.

Columns are mapped from each results table's header, because summer pages
add a "Session" column after the title. Rows are split on </tr>, because
real pages give only the first row of each course an opening <tr>.

Continuation rows: SOC often lists extra meeting times on rows with a blank
section cell (same section, different days/times). parse_courses() inherits
the previous section letter for those rows.

Cancelled sections stay in `sections` with `cancelled: true` (the SOC note is
stripped from the title) but are not offerings and add no campus. A section
subtitle ("Title <br />: subtitle") goes in the section's `section_title`.

Run daily by update_data.py (cron, through run_scrape.sh) on staged copies:
  scrape_soc.py → reconcile_offerings.py → mapping overlays → validate → publish

Output structure:
{
  "metadata": {...},
  "semesters": {
    "F26": {
      "courses": [
        {
          "course_number": "15122",
          "title": "Principles of Imperative Computation",
          "department_code": "CS",
          "department": "Computer Science",
          "units": "10",
          "campus": ["Pittsburgh", "Qatar"],
          "sections": [
            {"section": "1", "days": "MWF", ..., "campus": "Pittsburgh"},
            {"section": "A", "days": "MWF", ..., "campus": "Qatar"}
          ]
        }
      ],
      "department_summary": [...],
      "scraped_at": "..."
    }
  }
}
"""
import codecs
import urllib.request
import urllib.parse
import urllib.error
import re
import json
import time
import sys
import os
import html as html_lib
from datetime import datetime, timezone

# Shared parsers live alongside this script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from soc_parse import (  # noqa: E402
    active_sections,
    apply_campus_fix,
    build_offering,
    course_number_to_code,
    is_cancelled_course,
    semester_code_to_label,
)
from soc_departments import (  # noqa: E402
    SOC_LOCATION_CODES,
    get_department_list,
    get_semester_list,
    load_soc_form,
)
from pipeline_paths import SOC_JSON  # noqa: E402

# ---------- Configuration ----------
BASE = os.environ.get("SOC_BASE_URL", "https://enr-apps.as.cmu.edu/open/SOC/SOCServlet")
SEARCH = BASE + "/search"
MIN_COURSES_FOR_VALID_SCRAPE = int(os.environ.get("MIN_COURSES_FOR_VALID_SCRAPE", "100"))
# Summer (M-prefix) semesters list far fewer courses than fall/spring.
MIN_COURSES_FOR_SUMMER_SCRAPE = int(os.environ.get("MIN_COURSES_FOR_SUMMER_SCRAPE", "10"))


def scrape_threshold(semester_code: str) -> int:
    if semester_code and semester_code[0].upper() == "M":
        return MIN_COURSES_FOR_SUMMER_SCRAPE
    return MIN_COURSES_FOR_VALID_SCRAPE
# Default is next to the backend (backend/data/soc.json), whatever the working directory.
OUTPUT_PATH = os.environ.get("SOC_OUTPUT_PATH", str(SOC_JSON))
LOCATIONS_TO_SCRAPE = SOC_LOCATION_CODES


# ---------- HTTP helpers ----------

_META_CHARSET_RE = re.compile(rb'<meta\s[^>]*charset\s*=\s*["\']?([A-Za-z0-9_.:-]+)', re.IGNORECASE)
# Browsers read a page labelled ISO-8859-1 (or ASCII) as windows-1252.
_LATIN1_LABELS = {'iso-8859-1', 'iso8859-1', 'latin-1', 'latin1', 'l1',
                  'us-ascii', 'ascii', 'windows-1252', 'cp1252'}


def _cp1252_undefined_as_latin1(err):
    """Codec error handler: a byte cp1252 leaves undefined becomes U+0080-U+009F."""
    if not isinstance(err, UnicodeDecodeError):
        raise err
    bad = err.object[err.start:err.end]
    return ''.join(chr(byte) for byte in bad), err.end


_CP1252_FALLBACK = 'countsfor-cp1252-latin1'
codecs.register_error(_CP1252_FALLBACK, _cp1252_undefined_as_latin1)


def decode_body(raw, header_charset=None):
    """Decode an HTTP body with the charset the server declares.

    The SOC serves "text/html;charset=ISO-8859-1" (and the same meta tag), so
    the e-acute in "L'etoile" arrives as the single byte 0xE9. Decoding that
    as UTF-8 turned every accented letter into U+FFFD. Order: the HTTP header
    charset, then <meta charset>, then UTF-8 if the bytes are valid UTF-8,
    else windows-1252.
    """
    charset = (header_charset or '').strip().strip('"\'').lower()
    if not charset:
        m = _META_CHARSET_RE.search(raw[:4096])
        if m:
            charset = m.group(1).decode('ascii', 'ignore').lower()
    if not charset:
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            charset = 'windows-1252'
    if charset in _LATIN1_LABELS:
        # 0x81, 0x8D, 0x8F, 0x90, 0x9D are unassigned in cp1252: only those
        # bytes become their latin-1 code points (as browsers do); every other
        # byte keeps its cp1252 meaning (0x93 is still a curly quote).
        return raw.decode('cp1252', errors=_CP1252_FALLBACK)
    try:
        return raw.decode(charset)
    except LookupError:
        return raw.decode('utf-8', errors='replace')
    except UnicodeDecodeError:
        return raw.decode(charset, errors='replace')


def _read(req):
    with urllib.request.urlopen(req, timeout=60) as resp:
        return decode_body(resp.read(), resp.headers.get_content_charset())


def fetch_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (countsfor-bot)'})
    return _read(req)


def fetch_post(params):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(SEARCH, data=data,
                                 headers={'User-Agent': 'Mozilla/5.0 (countsfor-bot)'})
    return _read(req)


# ---------- Parsing ----------

# SOC result tables label each column with a th class (col-course, ...).
# Fall and spring pages have 10 columns; summer pages add "Session" after the
# title, so cells are mapped by header instead of by fixed position.
_HEADER_CLASS_FIELDS = {
    'col-course': 'course_number',
    'col-title': 'title',
    'col-session': 'session',
    'col-units': 'units',
    'col-section': 'section',
    'col-mini': 'mini',
    'col-days': 'days',
    'col-begin': 'begin_time',
    'col-end': 'end_time',
    'col-location': 'location',
    'col-deliverymode': 'delivery_mode',
}
_HEADER_TEXT_FIELDS = {
    'course': 'course_number',
    'course title': 'title',
    'session': 'session',
    'units': 'units',
    'sec': 'section',
    'mini': 'mini',
    'days': 'days',
    'begin': 'begin_time',
    'end': 'end_time',
    'teaching location': 'location',
    'delivery mode': 'delivery_mode',
}

_TABLE_RE = re.compile(r'<table\b[^>]*>(.*?)</table>', re.DOTALL | re.IGNORECASE)
# Real SOC pages open only the first row of each course with <tr>; the
# section and continuation rows after it have only a closing </tr>. Rows are
# therefore split on </tr> instead of being matched as <tr>...</tr> pairs.
_ROW_END_RE = re.compile(r'</tr\s*>', re.IGNORECASE)
_TH_RE = re.compile(r'<th\b([^>]*)>(.*?)</th>', re.DOTALL | re.IGNORECASE)
_TD_RE = re.compile(r'<td\b[^>]*>(.*?)</td>', re.DOTALL | re.IGNORECASE)
_CANCELLED_DIV_RE = re.compile(
    r'<div\b[^>]*class="[^"]*\bcancelled\b[^"]*"[^>]*>', re.IGNORECASE)
# The title cell carries the note as <div class="cancelled"><small>...</small></div>.
_CANCELLED_NOTE_RE = re.compile(
    r'<div\b[^>]*class="[^"]*\bcancelled\b[^"]*"[^>]*>.*?</div>',
    re.DOTALL | re.IGNORECASE)
_BR_RE = re.compile(r'<br\s*/?>', re.IGNORECASE)


def _cell_text(cell_html):
    """Strip tags and entities, collapse whitespace."""
    text = re.sub(r'<[^>]+>', ' ', cell_html or '')
    text = html_lib.unescape(text).replace('\xa0', ' ')
    return ' '.join(text.split())


def _header_fields(table_html):
    """Return the field name for each column, or None if the table has no header."""
    ths = _TH_RE.findall(table_html)
    if not ths:
        return None
    fields = []
    for attrs, label in ths:
        field = None
        cls = re.search(r'class="([^"]*)"', attrs)
        for name in (cls.group(1).split() if cls else []):
            if name in _HEADER_CLASS_FIELDS:
                field = _HEADER_CLASS_FIELDS[name]
                break
        if field is None:
            field = _HEADER_TEXT_FIELDS.get(_cell_text(label).lower())
        fields.append(field)
    if 'course_number' not in fields or 'section' not in fields:
        return None
    return fields


def parse_title_cell(cell_html):
    """Split a SOC title cell into (title, section_title, cancelled).

    The SOC renders a section subtitle as "Title <br />: subtitle" and a
    cancelled section as "Title <div class="cancelled">...This Section
    Cancelled...</div>". Continuation rows may hold only the subtitle.
    """
    cell_html = cell_html or ''
    cancelled = bool(_CANCELLED_DIV_RE.search(cell_html))
    cell_html = _CANCELLED_NOTE_RE.sub(' ', cell_html)
    parts = _BR_RE.split(cell_html, maxsplit=1)
    title = _cell_text(parts[0])
    section_title = ''
    if len(parts) > 1:
        section_title = _cell_text(parts[1])
        if section_title.startswith(':'):
            section_title = section_title[1:].strip()
    return title, section_title, cancelled


def _parse_table(table_html, dept_code, dept_name, courses):
    fields = _header_fields(table_html)
    if fields is None:
        return
    current_course = None
    last_section = None
    last_section_row = None
    for row_html in _ROW_END_RE.split(table_html):
        tds = _TD_RE.findall(row_html)
        if not tds:
            continue  # header row
        raw = {field: cell for field, cell in zip(fields, tds) if field}
        cells = {f: _cell_text(raw.get(f)) for f in _HEADER_CLASS_FIELDS.values()}
        title, section_title, title_cancelled = parse_title_cell(raw.get('title'))
        cnum = cells['course_number']

        if cnum.isdigit() and len(cnum) == 5:
            current_course = {
                'course_number': cnum, 'title': title, 'units': cells['units'],
                'department_code': dept_code, 'department': dept_name,
                'sections': []
            }
            courses.append(current_course)
            last_section = None
            last_section_row = None

        if not current_course:
            continue

        sec = cells['section']
        days, begin, end = cells['days'], cells['begin_time'], cells['end_time']
        location, delivery = cells['location'], cells['delivery_mode']
        cancelled = title_cancelled or bool(_CANCELLED_DIV_RE.search(raw.get('section') or ''))
        has_schedule = bool(days or begin or end)
        if sec:
            last_section = sec

        effective_sec = sec or last_section
        # SOC continuation rows leave section blank but repeat meeting times
        # for the same section (e.g. W meets MW and UT at different hours).
        if effective_sec and (sec or has_schedule):
            if not sec and last_section_row:
                cancelled = cancelled or bool(last_section_row.get('cancelled'))
                section_title = section_title or last_section_row.get('section_title', '')
            if not location and last_section_row:
                location = last_section_row.get('location') or location
            if not delivery and last_section_row:
                delivery = last_section_row.get('delivery_mode') or delivery
            row = {
                'section': effective_sec, 'mini': cells['mini'], 'days': days,
                'begin_time': begin, 'end_time': end,
                'location': location, 'delivery_mode': delivery
            }
            if 'session' in fields:
                row['session'] = cells['session']
            if section_title:
                row['section_title'] = section_title
            if cancelled:
                row['cancelled'] = True
            current_course['sections'].append(row)
            last_section_row = row


def parse_courses(html, dept_code, dept_name):
    """Parse every SOC results table, mapping cells to columns by header.

    A section row carries `cancelled: True` when the SOC marks it cancelled
    and `section_title` when its title cell has a "<br />: subtitle". Tables
    without a recognisable header are skipped: an empty result falls under
    the course threshold and keeps the prior scrape instead of misreading
    cells.
    """
    courses = []
    for table_html in _TABLE_RE.findall(html or ''):
        _parse_table(table_html, dept_code, dept_name, courses)
    return courses


def get_department_list_for_scrape(form_html=None):
    return get_department_list(fetch_get, SEARCH, form_html=form_html)


def get_semester_list_for_scrape(form_html=None):
    return get_semester_list(fetch_get, SEARCH, form_html=form_html)


# ---------- Main scrape per semester ----------

def attach_offerings(course, semester_code):
    """Attach normalized offerings and the campus list to a merged course.

    Cancelled sections stay in `sections` (with `cancelled: True`) but are
    not offerings and do not put a campus in `campus`. A course whose
    sections are all cancelled gets `cancelled: True` and an empty `campus`.
    """
    offerings = []
    campuses = []
    for section in active_sections(course.get('sections')):
        off = build_offering(
            semester_code=semester_code,
            section=section,
            units=course.get('units'),
        )
        off['campus'] = apply_campus_fix(
            course.get('course_number', ''),
            course.get('title'),
            off.get('campus'),
        )
        offerings.append(off)
        if section.get('campus') and section['campus'] not in campuses:
            campuses.append(section['campus'])
    course['offerings'] = offerings
    course['campus'] = campuses
    if is_cancelled_course(course):
        course['cancelled'] = True
    course['semester'] = semester_code_to_label(semester_code)
    course['semester_code'] = semester_code
    return course


def scrape_semester(semester_code, dept_list, min_courses=None):
    """
    For each (department, campus) pair, fetch the listing and parse it.
    Courses that appear at multiple campuses are merged into a single entry
    with `campus` as a list and sections tagged by campus.

    Returns (courses, dept_summary) or (None, None) if below threshold.
    """
    print(f"\n[{semester_code}] Scraping {len(dept_list)} depts "
          f"x {len(LOCATIONS_TO_SCRAPE)} campuses...")

    # (dept_code, course_number) -> merged course dict
    courses_by_key = {}
    dept_summary = []

    for i, (code, name) in enumerate(dept_list):
        sys.stdout.write(f"\r  [{i+1}/{len(dept_list)}] {code:<5} {name[:40]:<40}")
        sys.stdout.flush()

        dept_courses_seen = set()
        dept_section_count = 0
        dept_errors = []

        for loc_code, loc_name in LOCATIONS_TO_SCRAPE:
            try:
                html = fetch_post({
                    'SEMESTER': semester_code, 'MINI': 'NO', 'GRAD_UNDER': 'All',
                    'PRG_LOCATION': loc_code, 'DEPT': code, 'COURSE': ''
                })
                for c in parse_courses(html, code, name):
                    # Tag every section with its campus
                    for s in c['sections']:
                        s['campus'] = loc_name

                    key = (c['department_code'], c['course_number'])
                    if key in courses_by_key:
                        existing = courses_by_key[key]
                        if loc_name not in existing['campus']:
                            existing['campus'].append(loc_name)
                        existing['sections'].extend(c['sections'])
                    else:
                        c['campus'] = [loc_name]
                        courses_by_key[key] = c

                    dept_courses_seen.add(key)
                    dept_section_count += len(c['sections'])
            except Exception as e:
                dept_errors.append(f"{loc_code}: {e}")
                print(f"\n  ERROR [{code}/{loc_code}]: {e}")
            time.sleep(0.15)

        summary_entry = {
            'code': code, 'name': name,
            'courses': len(dept_courses_seen),
            'sections': dept_section_count,
        }
        if dept_errors:
            summary_entry['error'] = "; ".join(dept_errors)
        dept_summary.append(summary_entry)

    all_courses = list(courses_by_key.values())
    total_sections = sum(len(c['sections']) for c in all_courses)
    print(f"\n  -> {len(all_courses)} courses, {total_sections} sections")

    threshold = min_courses if min_courses is not None else scrape_threshold(semester_code)
    if len(all_courses) < threshold:
        print(f"  Below threshold ({threshold}) -- "
              f"treating as not-yet-released.")
        return None, None

    for course in all_courses:
        attach_offerings(course, semester_code)

    return all_courses, dept_summary


# ---------- Output assembly ----------

def load_existing():
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {'metadata': {}, 'semesters': {}}


def main():
    campus_names = ", ".join(name for _, name in LOCATIONS_TO_SCRAPE)
    print(f"CMU SOC Scraper (campuses: {campus_names})")
    print("=" * 60)

    try:
        form_html, semester_list, dept_list = load_soc_form(fetch_get, SEARCH)
    except Exception as e:
        print(f"ERROR: could not load SOC search form: {e}")
        sys.exit(1)

    sem_codes = [code for code, _ in semester_list]
    print(f"Semesters from SOC form: {', '.join(f'{c} ({label})' for c, label in semester_list)}")
    print(f"Departments: {len(dept_list)}")

    timestamp = datetime.now(timezone.utc).isoformat()
    prior = load_existing()
    prior_semesters = prior.get("semesters") or {}
    scraped_semesters: dict = {}
    new_semesters_seen = []

    for sem_code, sem_label in semester_list:
        courses, summary = scrape_semester(sem_code, dept_list)
        if courses is None:
            if sem_code in prior_semesters:
                print(f"  Kept prior {sem_code} data from last successful scrape.")
                scraped_semesters[sem_code] = prior_semesters[sem_code]
            else:
                print(f"  Skipped {sem_code} — no schedule data yet.")
            continue

        scraped_semesters[sem_code] = {
            'courses': courses,
            'department_summary': summary,
            'scraped_at': timestamp,
            'semester_label': sem_label,
            'total_courses': len(courses),
            'total_sections': sum(len(c['sections']) for c in courses),
        }
        new_semesters_seen.append(sem_code)

    if not scraped_semesters:
        print("\nNo valid data scraped for any semester on the SOC form. Aborting write.")
        sys.exit(1)

    # Keep semesters from prior runs that are no longer on the SOC form.
    for sem_code, sem_data in prior_semesters.items():
        if sem_code not in scraped_semesters:
            scraped_semesters[sem_code] = sem_data

    existing = {
        'metadata': {},
        'semesters': scraped_semesters,
    }
    existing['metadata'] = {
        'source': 'Carnegie Mellon University -- Schedule of Classes',
        'url': SEARCH,
        'last_scrape': timestamp,
        'semesters_on_form': [{'code': c, 'label': l} for c, l in semester_list],
        'semesters_available': sorted(scraped_semesters.keys()),
        'campuses': [name for _, name in LOCATIONS_TO_SCRAPE],
        'note': 'Scraped every semester listed on the SOC form for Pittsburgh (PIT) and Qatar (DOH).',
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2)

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"\n{'=' * 60}")
    print(f"  Wrote {OUTPUT_PATH} ({size_mb:.2f} MB)")
    print(f"  Semesters: {', '.join(sorted(existing['semesters'].keys()))}")
    if new_semesters_seen:
        print(f"  Scraped: {', '.join(new_semesters_seen)}")


if __name__ == '__main__':
    main()