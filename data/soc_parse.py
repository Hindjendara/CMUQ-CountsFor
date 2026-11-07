"""Shared SOC parsing: campus attribution, modality, offering records.

Used by scrape_soc.py, reconcile_offerings.py, and unit tests.
"""
from __future__ import annotations

import re

SEMESTER_LABELS = {
    "S": "Spring",
    "M": "Summer",
    "F": "Fall",
    "N": "Fall mini",
}

VALID_CAMPUSES = frozenset({"Qatar", "Pittsburgh"})
VALID_MODALITIES = frozenset({"In Person", "Remote", "Hybrid"})

# Known campus attribution fixtures (T6). Keys are 5-digit course numbers.
CAMPUS_FIXTURES = {
    "82289": "Qatar",  # 82-289 Tutoring for Community Outreach - CMUQ
}


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


def code_to_course_number(code: str) -> str:
    normalized = normalize_course_code(code)
    return (normalized or code or "").replace("-", "")


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


def expected_campus_for_course(course_number: str, title: str | None = None) -> str | None:
    """Return forced campus for known mis-tagged courses."""
    num = code_to_course_number(course_number)
    if num in CAMPUS_FIXTURES:
        return CAMPUS_FIXTURES[num]
    t = (title or "").lower()
    if "cmuq" in t or "qatar only" in t:
        return "Qatar"
    return None


def apply_campus_fix(course_number: str, title: str | None, campus: str | None) -> str | None:
    forced = expected_campus_for_course(course_number, title)
    if forced:
        return forced
    return campus


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
