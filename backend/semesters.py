"""Semester codes from the Schedule of Classes (SOC).

A code is a season letter (S spring, M summer, N fall mini, F fall, as
SEASON_NAME in frontend/js/data.js) and the year's last two digits: S27 is
Spring 2027, F26 Fall 2026, M26 Summer 2026. No list of semesters is kept in
code: the daily update scrapes every semester the SOC lists into soc.json, so
a new semester is accepted and shown the day it is scraped.
"""
from __future__ import annotations

import json
import os
import re

SEMESTER_RE = re.compile(r"^[FSMN]\d{2}$")
# Order within a year: spring, summer, fall (as sortSemesters in frontend/js/data.js).
_SEASON_ORDER = {"S": 1, "M": 2, "N": 3, "F": 4}

# soc_path -> ((mtime_ns, size), default semester) for the file last read there.
_default_cache: dict[str, tuple[tuple[int, int], str | None]] = {}


def normalize_semester(raw) -> str | None:
    """'S27' or ' s27 ' -> 'S27'; None for anything that is not a semester code."""
    if not isinstance(raw, str):
        return None
    code = raw.strip().upper()
    return code if SEMESTER_RE.match(code) else None


def semester_rank(code) -> int:
    """A number that grows with time ('F26' < 'S27'); -1 for anything that is not a code."""
    code = normalize_semester(code)
    return int(code[1:]) * 10 + _SEASON_ORDER[code[0]] if code else -1


def pick_default_semester(campuses: dict[str, set[str]]) -> str | None:
    """The semester the app opens on, from {semester: campuses with a running section}.

    The newest fall or spring with a section in Qatar; without one, the newest
    fall or spring, then the newest semester. Summer is never the default
    while there is a fall or spring. catalogSemesters in frontend/js/data.js
    applies the same rule to the catalog's offerings, which
    reconcile_offerings.py builds from soc.json.
    """
    codes = sorted((c for c in campuses if normalize_semester(c) == c), key=semester_rank, reverse=True)
    regular = [c for c in codes if c[0] in "FS"]
    for code in regular:
        if "Qatar" in campuses[code]:
            return code
    return (regular or codes or [None])[0]


def soc_campuses(soc) -> dict[str, set[str]]:
    """{semester: campuses with a section that is not cancelled} in a parsed soc.json."""
    out: dict[str, set[str]] = {}
    for sem, data in ((soc or {}).get("semesters") or {}).items():
        found = out.setdefault(sem, set())
        for course in (data or {}).get("courses") or []:
            for section in (course or {}).get("sections") or []:
                if section and section.get("campus") and not section.get("cancelled"):
                    found.add(section["campus"])
    return out


def default_semester(soc_path) -> str | None:
    """pick_default_semester for the soc.json at soc_path; None if it cannot be read.

    The file is about 30 MB, so the answer is kept until the file changes (the
    daily update replaces it). Requests that name a semester never need it.
    """
    try:
        st = os.stat(soc_path)
    except OSError:
        return None
    key, signature = str(soc_path), (st.st_mtime_ns, st.st_size)
    hit = _default_cache.get(key)
    if hit and hit[0] == signature:
        return hit[1]
    try:
        with open(soc_path, encoding="utf-8") as fh:
            value = pick_default_semester(soc_campuses(json.load(fh)))
    except (OSError, ValueError, AttributeError, TypeError):
        value = None
    _default_cache[key] = (signature, value)
    return value
