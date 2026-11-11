"""Shared SOC parsing: campus attribution, modality, offering records.

Used by scrape_soc.py, reconcile_offerings.py, and unit tests. The campus of
an offering is the one the SOC gives; a confirmed correction belongs in
backend/data/mapping_overlays.json ("campus_overrides"), never here.
"""
from __future__ import annotations

import re

SEMESTER_LABELS = {
    "S": "Spring",
    "M": "Summer",
    "F": "Fall",
    "N": "Fall mini",
}
SEMESTER_CODE_RE = re.compile(r"^[FSMN]\d{2}$")
# Order within a year: spring, summer, fall mini, fall. The same order as
# semester_rank in backend/semesters.py and semesterRank in frontend/js/data.js.
SEASON_ORDER = {"S": 1, "M": 2, "N": 3, "F": 4}

VALID_CAMPUSES = frozenset({"Qatar", "Pittsburgh"})


def semester_rank(code) -> int:
    """A number that grows with time ("F26" < "S27"); -1 for anything that is not a semester code.

    The one semester order of the pipeline scripts (sort with key=semester_rank).
    """
    text = code.strip().upper() if isinstance(code, str) else ""
    if not SEMESTER_CODE_RE.match(text):
        return -1
    return int(text[1:]) * 10 + SEASON_ORDER[text[0]]


def soc_form_semesters(soc) -> list[str] | None:
    """The semesters the SOC search form listed at the last scrape, newest first.

    scrape_soc.py records them in metadata.semesters_on_form. soc.json also
    keeps semesters that have left the form, and their sections are history;
    these are the semesters the SOC lists now. reconcile_offerings.py writes
    them to courses.json as "soc_semesters", the list of the app's semester
    picker. None when soc.json has no such list.
    """
    entries = ((soc or {}).get("metadata") or {}).get("semesters_on_form")
    codes: list[str] = []
    for entry in entries if isinstance(entries, list) else []:
        raw = entry.get("code") if isinstance(entry, dict) else entry
        code = raw.strip().upper() if isinstance(raw, str) else ""
        if SEMESTER_CODE_RE.match(code) and code not in codes:
            codes.append(code)
    return sorted(codes, key=semester_rank, reverse=True) or None


def semester_code_to_label(code: str) -> str:
    """F26 -> Fall 2026"""
    if not code or len(code) < 3:
        return code or ""
    season = SEMESTER_LABELS.get(code[0], code[0])
    year = 2000 + int(code[1:3])
    return f"{season} {year}"


def parse_campus_from_location(location: str | None, fallback_campus: str | None = None) -> str | None:
    """Map SOC location text to Qatar or Pittsburgh.

    PRG_LOCATION fallback (PIT/DOH scrape tag) wins when location is ambiguous.
    """
    if fallback_campus in VALID_CAMPUSES:
        return fallback_campus

    loc = (location or "").strip().lower()
    if not loc:
        return fallback_campus if fallback_campus in VALID_CAMPUSES else None

    if "doha" in loc or "qatar" in loc:
        return "Qatar"
    if "pittsburgh" in loc or loc.endswith(", pennsylvania"):
        return "Pittsburgh"

    return None


def normalize_modality(delivery_mode: str | None) -> str:
    """Map raw SOC delivery_mode strings to In Person / Remote / Hybrid."""
    dm = (delivery_mode or "").strip().lower()
    if not dm:
        return "In Person"
    if "remote only" in dm or dm == "remote":
        return "Remote"
    if "hybrid" in dm:
        return "Hybrid"
    if "in-person + remote" in dm or "in-person (rotation) + remote" in dm:
        return "Hybrid"
    if "in-person + technology" in dm:
        return "Hybrid"
    if "remote" in dm and "in-person" in dm:
        return "Hybrid"
    if "remote" in dm:
        return "Remote"
    return "In Person"


def format_days_times(section: dict) -> str:
    days = (section.get("days") or "").strip() or "TBA"
    begin = (section.get("begin_time") or "").strip()
    end = (section.get("end_time") or "").strip()
    if begin and begin != "TBA" and end:
        return f"{days} {begin}-{end}"
    return days


def normalize_course_code(code) -> str | None:
    """Canonicalize course codes: 82101, 82101.0, 82-101 -> 82-101."""
    if code is None:
        return None
    if isinstance(code, (int, float)):
        code = str(int(code)) if float(code) == int(code) else str(code)
    s = str(code).strip()
    if not s:
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if "-" in s:
        left, right = s.split("-", 1)
        if left.isdigit() and right.isdigit():
            return f"{left}-{right}"
        return s
    digits = s.replace("-", "")
    if len(digits) == 5 and digits.isdigit():
        return f"{digits[:2]}-{digits[2:]}"
    return s


def course_number_to_code(num: str) -> str:
    """15122 -> 15-122"""
    normalized = normalize_course_code(num)
    return normalized if normalized else (num or "")


def parse_soc_units(raw) -> int | None:
    """Parse SOC unit strings: 10, 12.0, 9.00, 1-3, summer one -> int when possible."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    lowered = s.lower()
    if lowered in ("var", "variable", "tba", "n/a", "none"):
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if s.isdigit():
        return int(s)
    m = re.match(r"^(\d+(?:\.\d+)?)", s)
    if m:
        return int(float(m.group(1)))
    m = re.match(r"^(\d+)\s*-\s*(\d+)$", s)
    if m:
        return int(m.group(1))
    return None


def build_offering(
    *,
    semester_code: str,
    section: dict,
    units: str | None = None,
    instructor: str | None = None,
) -> dict:
    """Normalized offering for one SOC section.

    A cancelled section gets `cancelled: True`. Callers skip those (see
    is_cancelled_section) so they never count as offerings or set campus flags.
    """
    campus = parse_campus_from_location(
        section.get("location"),
        section.get("campus"),
    )
    offering = {
        "semester": semester_code_to_label(semester_code),
        "semester_code": semester_code,
        "campus": campus,
        "section": section.get("section") or "",
        "modality": normalize_modality(section.get("delivery_mode")),
        "units": units or section.get("units") or "",
        "days_times": format_days_times(section),
        "instructor": instructor or section.get("instructor") or "",
        "location": section.get("location") or "",
        "delivery_mode_raw": section.get("delivery_mode") or "",
    }
    if is_cancelled_section(section):
        offering["cancelled"] = True
    return offering


def is_cancelled_section(section: dict | None) -> bool:
    """True when the scraper marked this SOC section (or offering) cancelled."""
    return bool((section or {}).get("cancelled"))


def active_sections(sections: list[dict] | None) -> list[dict]:
    """SOC sections that still run (cancelled ones removed)."""
    return [s for s in sections or [] if not is_cancelled_section(s)]


def is_cancelled_course(course: dict) -> bool:
    """True when a SOC course has sections and every one is cancelled."""
    sections = course.get("sections") or []
    return bool(sections) and not active_sections(sections)


# Malformed rows. Before tables were read by header, summer pages (which add
# a "Session" column after the title) were parsed as 10 fixed cells, so every
# field after the title moved one column: units held the session ("summer",
# "qatar summer", "summer one"), section held the units, location held a time.
# soc.json still carries that data for semesters no longer on the SOC form
# (M25). It is kept in soc.json but ignored: no offerings, campus flags, titles
# or catalog rows come from it.
#
# Real units: "9", "1.5", "VAR", "3-12", "0,36-48", "1.0 - 12.0", "9-48 4".
_UNITS_RE = re.compile(
    r"^(?:var|\d+(?:\.\d+)?(?:\s*[-,]\s*\d+(?:\.\d+)?)*(?:\s+\d+(?:\.\d+)?)?)$",
    re.IGNORECASE,
)
# Real section ids: "1", "A", "W2", "AA", "Lec 14".
_SECTION_ID_RE = re.compile(r"^(?:Lec \d{1,3}|[A-Z0-9]{1,3})$")


def is_valid_units(units) -> bool:
    """True for a SOC units cell: a number, a range or list of numbers, or VAR."""
    return bool(_UNITS_RE.match(str(units if units is not None else "").strip()))


def is_section_id(value) -> bool:
    """True for a SOC section id ("A", "1", "W2", "Lec 3"); "TBA" is not one."""
    s = str(value if value is not None else "").strip()
    return s.upper() != "TBA" and bool(_SECTION_ID_RE.match(s))


def is_malformed_course(course: dict | None) -> bool:
    """True when a SOC course's units cell is not units (a shifted summer row)."""
    return not is_valid_units((course or {}).get("units"))


def is_malformed_section(section: dict | None) -> bool:
    """True when a SOC section's section cell is not a section id."""
    return not is_section_id((section or {}).get("section"))


def usable_sections(course: dict | None) -> list[dict]:
    """Running, well-formed sections of a SOC course.

    Empty for a malformed course; otherwise cancelled and malformed sections
    are left out.
    """
    if is_malformed_course(course):
        return []
    return [s for s in active_sections((course or {}).get("sections"))
            if not is_malformed_section(s)]


def is_ignored_course(course: dict | None) -> bool:
    """True when the pipeline ignores this SOC course entirely.

    That is a malformed course (units cell not units), or a course with
    sections where none is usable and at least one is malformed (every
    section is cancelled or malformed). A course whose sections are all
    cancelled is not ignored: the SOC lists it, it just does not run.
    reconcile (offerings, titles, presence) and validate_soc_coverage both
    use this, so they agree on which courses the SOC lists.
    """
    if is_malformed_course(course):
        return True
    secs = (course or {}).get("sections") or []
    return (bool(secs) and not usable_sections(course)
            and any(is_malformed_section(s) for s in secs))


def malformed_counts(soc: dict) -> dict[str, dict[str, int]]:
    """{semester: {"courses": n, "sections": m}} that the pipeline ignores.

    "courses" counts ignored courses (is_ignored_course); "sections" counts
    every section of a malformed course plus malformed sections of
    well-formed courses.
    """
    out: dict[str, dict[str, int]] = {}
    for sem_code, sem_data in (soc.get("semesters") or {}).items():
        courses = sections = 0
        for course in sem_data.get("courses") or []:
            secs = course.get("sections") or []
            if is_ignored_course(course):
                courses += 1
            if is_malformed_course(course):
                sections += len(secs)
            else:
                sections += sum(1 for s in secs if is_malformed_section(s))
        out[sem_code] = {"courses": courses, "sections": sections}
    return out


_CANCELLED_SUFFIX_RE = re.compile(r"\s*This Section Cancelled\s*$", re.IGNORECASE)
_TRAILING_TBA_RE = re.compile(r"\s*:\s*TBA\s*$", re.IGNORECASE)


def clean_soc_title(title: str | None) -> str | None:
    """Clean a course title stored by the old scraper.

    Before titles were parsed cell by cell, soc.json titles could end in
    "This Section Cancelled", carry a section subtitle as "Title : subtitle"
    (from "<br />: subtitle"), or end in ": TBA". Returns the bare course
    title, or None when nothing usable is left (empty or only "TBA"), so
    callers can fall back to another title.
    """
    if title is None:
        return None
    t = " ".join(str(title).split())
    t = _CANCELLED_SUFFIX_RE.sub("", t)
    if t.startswith(":"):
        return None  # only a subtitle, no course title
    cut = t.find(" : ")
    if cut >= 0:
        t = t[:cut]
    t = _TRAILING_TBA_RE.sub("", t)
    t = t.rstrip(" :").strip()
    if not t or t.lower() == "tba":
        return None
    return t


_TBA_TOKEN_RE = re.compile(r"\bTBA\b", re.IGNORECASE)


def is_placeholder_title(title: str | None) -> bool:
    """True for a cleaned title that still holds a "TBA" placeholder.

    Production Prep courses are listed as "Production Prep: TBA 5" until the
    show is chosen. Such a title is used only when no semester has another.
    """
    return bool(title) and bool(_TBA_TOKEN_RE.search(title))


def normalize_title(title: str | None) -> str:
    """Lowercase alphanumeric title for comparison."""
    t = (title or "").lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


_TITLE_STOP = frozenset({"in", "the", "and", "for", "of", "a", "to", "with", "at"})


def _title_tokens(title: str | None) -> set[str]:
    return {
        tok
        for tok in normalize_title(title).split()
        if len(tok) > 2 and tok not in _TITLE_STOP
    }


def titles_match(catalog_title: str | None, soc_title: str | None) -> bool:
    """True when catalog and SOC titles refer to the same course."""
    a = normalize_title(catalog_title)
    b = normalize_title(soc_title)
    if not a or not b:
        return True
    if a == b or b.startswith(a) or a.startswith(b):
        return True
    catalog_tokens = _title_tokens(catalog_title)
    soc_tokens = _title_tokens(soc_title)
    if not catalog_tokens or not soc_tokens:
        return True
    overlap = len(catalog_tokens & soc_tokens)
    return overlap > 0
