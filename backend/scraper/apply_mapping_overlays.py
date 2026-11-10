#!/usr/bin/env python3
"""Apply backend/data/mapping_overlays.json to the served course catalog.

Mappings live in course records inside JSON catalogs, not in Postgres.
Run after reconcile_offerings.py so overlays survive daily SOC scrapes.

The SOC scrape stays the rule; the overlay file is the one place for manual
complements on top of it. One run applies its sections in this order, and
running it again changes nothing:

1. "overlays": additive requirement mappings.
2. "rule_buckets": buckets the catalog defines by a rule ("any SCS course,
   200-level or above, at least 9 units"), not a list. Each rule is expanded
   against every course row: a matching course gets a row tagged
   "source": "rule", and a rule row whose course no longer matches is
   removed. Rows without that tag are never touched. So new SOC courses count
   from the next daily run, and the step follows the SOC. Each rule states
   its own number range (graduate courses, 600 and above, and numbers below
   100 are left out unless the catalog's rule covers them); a per course unit
   minimum uses the most units the course can carry (course_max_units).
3. "remove_mappings": drop requirement rows per program. Runs after 1 and 2
   so nothing re-adds them; steps 1 and 2 also skip those programs.
4. "qatar_visibility": set "qatar_only" on courses the frontend shows only
   when their SOC offerings include the Qatar campus.

"qatar_only" belongs to this step: a row not listed in the file loses it.

The same run writes requirement_buckets.json next to each catalog it updates:
every bucket path per program, in catalog order ("catalog_buckets"), with
buckets that have no rows yet, plus any row path the list lacks. The admin
course editor offers these paths.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from json_io import load_json, save_json  # noqa: E402
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON  # noqa: E402
from soc_parse import is_cancelled_section, normalize_course_code  # noqa: E402

OVERLAYS_PATH = Path(
    os.environ.get("MAPPING_OVERLAYS_PATH")
    or MAPPING_OVERLAYS_JSON
)
PROGRAMS = ("CS", "IS", "BA", "BS", "AI")
# Every course row has these program keys; AI is there only when it has rows.
BASE_PROGRAM_KEYS = ("CS", "IS", "BA", "BS")
# qatar_visibility rule -> course flag the frontend reads
VISIBILITY_RULES = {"show_only_if_offered_qatar": "qatar_only"}
DEFAULT_CATALOGS = [
    COURSES_JSON,
]
# A requirement row a rule bucket added carries "source": RULE_SOURCE.
RULE_SOURCE = "rule"
# Written next to each catalog: {program: [bucket paths in catalog order]}.
REQUIREMENT_BUCKETS_NAME = "requirement_buckets.json"

# Requirement paths use the 2026-27 catalog bucket names.
IS_IGI_PATH = "GenEd---Foundations---Intercultural and Global Inquiry"
IS_CONTEXTUAL_PATH = "GenEd---Foundations---Contextual Thinking"
BA_GLOBAL_PATH = "GenEd---University Core---Global, Cultural, and Diverse Perspectives"
BS_ML_PATH = "GenEd---Nontechnical Breadth Requirements---D. Cultural/Global Understanding Course"
BS_NTB_PATH = "GenEd---Nontechnical Breadth Requirements---E. Nontechnical Elective Courses"
CS_HUMANITIES_PATH = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
CS_CAT3_PATH = "GenEd---Humanities and Arts---B. Breadth Requirement---Category 3: Cultural Analysis"

MODERN_LANGUAGE_CODES = [
    "82-101",
    "82-102",
    "82-111",
    "82-112",
    "82-141",
    "82-142",
    "82-241",
    "82-242",
    "82-313",
]

# Spreadsheet audit — expected mappings per course (major -> list of requirement paths)
EXPECTED_GENED_MAPPINGS = {
    "82-101": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-102": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-111": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-112": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-141": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-142": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-241": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-242": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-313": {
        "IS": [IS_IGI_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_CAT3_PATH, CS_HUMANITIES_PATH],
    },
    "82-314": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_CAT3_PATH, CS_HUMANITIES_PATH],
    },
    "82-355": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-412": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-414": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-511": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-512": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-277": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "82-289": {
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_ML_PATH, BS_NTB_PATH],
        "CS": [CS_HUMANITIES_PATH],
    },
    "79-286": {
        "IS": [IS_CONTEXTUAL_PATH],
        "BA": [BA_GLOBAL_PATH],
        "BS": [BS_NTB_PATH],
        "CS": [CS_CAT3_PATH, CS_HUMANITIES_PATH],
    },
    "79-232": {
        "IS": [IS_CONTEXTUAL_PATH],
    },
}


def normalize_catalog_codes(courses: list[dict]) -> int:
    """Rewrite float / compact codes to canonical XX-YYY. Returns change count."""
    changed = 0
    for course in courses:
        raw = course.get("course_code")
        canonical = normalize_course_code(raw)
        if not canonical:
            continue
        if raw != canonical:
            course["course_code"] = canonical
            changed += 1
    return changed


def _req_key(req: dict) -> tuple:
    return (
        req.get("major"),
        req.get("requirement"),
        bool(req.get("type")),
    )


def _merge_requirements(course: dict, overlay_reqs: dict) -> int:
    """Add overlay requirements without removing or overwriting existing rows.

    An overlay row that a rule bucket row already holds takes that row over:
    the row loses its "source": "rule" tag, so the rule step never removes a
    mapping the overlay file states.
    """
    if "requirements" not in course or not isinstance(course["requirements"], dict):
        course["requirements"] = {"CS": [], "IS": [], "BA": [], "BS": []}
    added = 0
    for major, reqs in overlay_reqs.items():
        bucket = course["requirements"].setdefault(major, [])
        existing = {_req_key(r): r for r in bucket if isinstance(r, dict)}
        for req in reqs:
            if not isinstance(req, dict):
                continue
            key = _req_key(req)
            if key in existing:
                if existing[key].get("source") == RULE_SOURCE:
                    existing[key].pop("source")
                continue
            row = dict(req)
            bucket.append(row)
            existing[key] = row
            added += 1
    return added


class OverlayError(Exception):
    """The overlay file is invalid or names a current course the catalog lacks."""


def _by_code(courses: list[dict]) -> dict[str, dict]:
    return {c.get("course_code"): c for c in courses if c.get("course_code")}


def _apply_additive_overlays(
    courses: list[dict],
    by_code: dict[str, dict],
    overlays: list[dict],
    removed: dict[str, set[str]] | None = None,
) -> dict:
    """Section 1. An overlay may set:

    - "create_missing": false to skip (with a warning) codes the catalog lacks
      instead of creating a manual_seed row (default true);
    - "ensure_course_defaults_codes": the only codes that get
      "ensure_course_defaults" (and may be created). Default: every code.

    Programs that remove_mappings lists for a course are skipped, so a rerun
    does not add rows only for section 3 to drop them again.
    """
    removed = removed or {}
    stats = {"courses_created": 0, "requirements_added": 0, "overlay_codes_missing": []}
    for overlay in overlays:
        overlay_reqs = overlay.get("requirements") or {}
        defaults = overlay.get("ensure_course_defaults") or {}
        create_missing = overlay.get("create_missing", True)
        defaults_codes = overlay.get("ensure_course_defaults_codes")
        if defaults_codes is not None:
            defaults_codes = {normalize_course_code(c) for c in defaults_codes}
        for code in overlay.get("course_codes") or []:
            canonical = normalize_course_code(code)
            if not canonical:
                continue
            gets_defaults = defaults_codes is None or canonical in defaults_codes
            course = by_code.get(canonical)
            if course is None:
                if not (create_missing and gets_defaults):
                    stats["overlay_codes_missing"].append(f"{overlay.get('id')}: {canonical}")
                    continue
                course = {
                    "course_code": canonical,
                    "course_name": canonical,
                    "department": defaults.get("department") or canonical.split("-")[0],
                    "units": 12,
                    "description": "",
                    "prerequisites": "",
                    "offered": [],
                    "offered_qatar": bool(defaults.get("offered_qatar")),
                    "offered_pitts": False,
                    "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
                    "soc_sections": [],
                    "offerings": [],
                    "manual_seed": True,
                }
                courses.append(course)
                by_code[canonical] = course
                stats["courses_created"] += 1
            if gets_defaults:
                for field, value in defaults.items():
                    if field == "department" and not course.get("department"):
                        course["department"] = str(value)
                    elif field == "offered_qatar" and value:
                        course["offered_qatar"] = True
            blocked = removed.get(canonical, set())
            reqs = {m: r for m, r in overlay_reqs.items() if m not in blocked}
            stats["requirements_added"] += _merge_requirements(course, reqs)
    return stats


def apply_overlays_to_courses(courses: list[dict], overlays: list[dict]) -> dict:
    """Normalize codes, then apply the additive "overlays" list only."""
    stats = {"codes_normalized": normalize_catalog_codes(courses)}
    added = _apply_additive_overlays(courses, _by_code(courses), overlays)
    stats["courses_created"] = added["courses_created"]
    stats["requirements_added"] = added["requirements_added"]
    return stats


# ---------- Section 2: rule buckets ----------
#
# A rule bucket entry:
#   {"id": "cs-scs-electives", "program": "CS",
#    "path": "BS in Computer Science---Computer Science---Two School of Computer Science electives",
#    "type": false,
#    "select": {"prefixes": ["02", "15", ...], "min_number": 200, "max_number": 599,
#               "ranges": [{"from": "85-102", "to": "85-599"}],
#               "min_units_per_course": 9,
#               "include": ["02-180"], "exclude": ["02-201", {"from": "36-000", "to": "36-999"}],
#               "non_technical": true},
#    "source": [{"file": "backend/data/sources/catalog-2026-27/...html", "heading": "A > B"}],
#    "note": "..."}
#
# A course matches when it is in "include", or else when it is not in
# "exclude" and its number is in "prefixes" between min_number and
# max_number (both inclusive) or in one of "ranges", and, with
# min_units_per_course, it can carry at least that many units (see
# course_max_units). "non_technical": true marks a rule the catalog limits to
# nontechnical courses and whose technical courses it names by list: that list
# is "exclude". Course rows the overlay step created (manual_seed) never match.

_CODE_RE = re.compile(r"^(\d{2})-(\d{3})$")
_RULE_KEYS = {"id", "program", "path", "type", "select", "source", "note"}
_SELECT_KEYS = {"prefixes", "min_number", "max_number", "ranges", "min_units_per_course",
                "include", "exclude", "non_technical"}
_UNITS_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


def _split_code(code) -> tuple[str, int] | None:
    """"15-122" -> ("15", 122); None for anything else."""
    m = _CODE_RE.match(str(code or ""))
    return (m.group(1), int(m.group(2))) if m else None


def course_max_units(course: dict) -> float | None:
    """The most units a course can be taken for, for a per-course minimum.

    The course's numeric units, and every number in the unit strings of its
    SOC offerings (cancelled sections left out): a "3-12" or "3,6,9,12"
    offering gives 12. A "VAR" offering holds no number, so a variable unit
    course falls back to its numeric units (which may be 0). None when the row
    has no number at all.
    """
    numbers: list[float] = []
    units = course.get("units")
    if isinstance(units, (int, float)) and not isinstance(units, bool):
        numbers.append(float(units))
    for offering in course.get("offerings") or []:
        if not isinstance(offering, dict) or is_cancelled_section(offering):
            continue
        numbers.extend(float(n) for n in _UNITS_NUMBER_RE.findall(str(offering.get("units") or "")))
    return max(numbers) if numbers else None


class _Select:
    """A validated "select" block."""

    def __init__(self, select: dict, where: str):
        if not isinstance(select, dict) or not select:
            raise OverlayError(f"{where}: select must be an object")
        unknown = set(select) - _SELECT_KEYS
        if unknown:
            raise OverlayError(f"{where}: unknown select field(s) {sorted(unknown)}")
        self.prefixes = select.get("prefixes") or []
        if not isinstance(self.prefixes, list) or not all(
                isinstance(p, str) and re.fullmatch(r"\d{2}", p) for p in self.prefixes):
            raise OverlayError(f"{where}: prefixes must be two-digit subject codes like \"15\"")
        if len(set(self.prefixes)) != len(self.prefixes):
            raise OverlayError(f"{where}: a prefix is listed twice")
        self.min_number = select.get("min_number")
        self.max_number = select.get("max_number")
        if self.prefixes:
            for name in ("min_number", "max_number"):
                value = select.get(name)
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 999:
                    raise OverlayError(f"{where}: {name} must be a course number from 0 to 999")
            if self.min_number > self.max_number:
                raise OverlayError(f"{where}: min_number is above max_number")
        elif "min_number" in select or "max_number" in select:
            raise OverlayError(f"{where}: min_number and max_number go with prefixes")
        self.ranges = [self._range(r, where) for r in select.get("ranges") or []]
        if not self.prefixes and not self.ranges and not select.get("include"):
            raise OverlayError(f"{where}: select needs prefixes, ranges or include")
        self.min_units = select.get("min_units_per_course")
        if self.min_units is not None and (
                not isinstance(self.min_units, (int, float)) or isinstance(self.min_units, bool)
                or self.min_units <= 0):
            raise OverlayError(f"{where}: min_units_per_course must be a positive number")
        self.include = self._codes(select.get("include") or [], where, "include")
        self.exclude_codes: set[str] = set()
        self.exclude_ranges: list[tuple[str, int, int]] = []
        exclude = select.get("exclude") or []
        if not isinstance(exclude, list):
            raise OverlayError(f"{where}: exclude must be a list")
        for item in exclude:
            if isinstance(item, dict):
                self.exclude_ranges.append(self._range(item, where))
            else:
                self.exclude_codes |= self._codes([item], where, "exclude")
        both = self.include & self.exclude_codes
        if both:
            raise OverlayError(f"{where}: {sorted(both)} both included and excluded")
        self.non_technical = select.get("non_technical", False)
        if self.non_technical not in (True, False):
            raise OverlayError(f"{where}: non_technical must be true or false")
        if self.non_technical and not (self.exclude_codes or self.exclude_ranges):
            raise OverlayError(f"{where}: non_technical needs the catalog's list of technical courses in exclude")

    @staticmethod
    def _codes(items, where: str, field: str) -> set[str]:
        if not isinstance(items, list):
            raise OverlayError(f"{where}: {field} must be a list")
        out = set()
        for item in items:
            if not _split_code(item):
                raise OverlayError(f"{where}: {field} entry {item!r} is not a course code like 15-122")
            if item in out:
                raise OverlayError(f"{where}: {field} lists {item} twice")
            out.add(item)
        return out

    @staticmethod
    def _range(entry, where: str) -> tuple[str, int, int]:
        if not isinstance(entry, dict) or set(entry) != {"from", "to"}:
            raise OverlayError(f"{where}: a range is {{\"from\": \"NN-NNN\", \"to\": \"NN-NNN\"}}, got {entry!r}")
        low, high = _split_code(entry["from"]), _split_code(entry["to"])
        if not low or not high or low[0] != high[0] or low[1] > high[1]:
            raise OverlayError(f"{where}: bad range {entry!r} (same subject, from not above to)")
        return low[0], low[1], high[1]

    def matches(self, course: dict) -> bool:
        code = course.get("course_code")
        if code in self.include:
            return True
        parts = _split_code(code)
        if not parts or code in self.exclude_codes:
            return False
        prefix, number = parts
        if any(p == prefix and lo <= number <= hi for p, lo, hi in self.exclude_ranges):
            return False
        in_scope = (prefix in self.prefixes and self.min_number <= number <= self.max_number) or any(
            p == prefix and lo <= number <= hi for p, lo, hi in self.ranges)
        if not in_scope:
            return False
        if self.min_units is not None:
            units = course_max_units(course)
            if units is None or units < self.min_units:
                return False
        return True


class _RuleBucket:
    def __init__(self, entry: dict, index: int):
        where = f"rule_buckets[{index}]"
        if not isinstance(entry, dict):
            raise OverlayError(f"{where}: must be an object")
        unknown = set(entry) - _RULE_KEYS
        if unknown:
            raise OverlayError(f"{where}: unknown field(s) {sorted(unknown)}")
        self.id = entry.get("id")
        if not isinstance(self.id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", self.id):
            raise OverlayError(f"{where}: id must be a lowercase slug like cs-scs-electives")
        where = f"rule bucket {self.id}"
        self.program = entry.get("program")
        if self.program not in PROGRAMS:
            raise OverlayError(f"{where}: program must be one of {', '.join(PROGRAMS)}")
        self.path = entry.get("path")
        parts = self.path.split("---") if isinstance(self.path, str) else []
        if len(parts) < 2 or any(not p or p != p.strip() for p in parts):
            raise OverlayError(f"{where}: path must be a bucket path like GenEd---Science and Engineering")
        self.type = entry.get("type")
        if self.type is not (parts[0] == "GenEd"):
            raise OverlayError(f"{where}: type must be true for a GenEd path and false for a degree path")
        self.select = _Select(entry.get("select"), where)
        sources = entry.get("source")
        if not isinstance(sources, list) or not sources or not all(
                isinstance(s, dict) and set(s) == {"file", "heading"}
                and all(isinstance(s[k], str) and s[k].strip() for k in s) for s in sources):
            raise OverlayError(f"{where}: source must list {{\"file\", \"heading\"}} of the archived catalog page(s)")
        self.sources = sources

    @property
    def key(self) -> tuple[str, str, bool]:
        return (self.program, self.path, self.type)


def compile_rule_buckets(entries) -> list[_RuleBucket]:
    """Validate the "rule_buckets" section. Raises OverlayError."""
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise OverlayError("rule_buckets must be a list")
    rules = [_RuleBucket(entry, i) for i, entry in enumerate(entries)]
    ids = [r.id for r in rules]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise OverlayError(f"rule_buckets: duplicate id(s) {dupes}")
    return rules


def apply_rule_buckets(
    courses: list[dict],
    rules: list[_RuleBucket],
    removed: dict[str, set[str]] | None = None,
) -> dict:
    """Section 2: add a rule row for every matching course, drop stale rule rows.

    A course gets {"requirement", "type", "major", "source": "rule"} for each
    rule it matches, unless it already has a row with that path and type (from
    the catalog, an overlay or the rule itself). A row tagged "source": "rule"
    goes when its course no longer matches any rule for that bucket. Rows
    without the tag are never touched. Programs remove_mappings lists for a
    course are skipped, as in section 1, so a rerun changes nothing.
    """
    removed = removed or {}
    per_rule = {r.id: {"matched": 0, "added": 0} for r in rules}
    stats = {"rule_rows_added": 0, "rule_rows_removed": 0, "rule_includes_missing": [],
             "rule_buckets": per_rule}
    codes = {c.get("course_code") for c in courses}
    for rule in rules:
        for code in sorted(rule.select.include - codes):
            stats["rule_includes_missing"].append(f"{rule.id}: {code}")

    for course in courses:
        if course.get("manual_seed"):
            wanted: dict[tuple[str, str, bool], _RuleBucket] = {}
        else:
            blocked = removed.get(course.get("course_code"), set())
            wanted = {}
            for rule in rules:
                if rule.program not in blocked and rule.select.matches(course):
                    per_rule[rule.id]["matched"] += 1
                    wanted.setdefault(rule.key, rule)
        reqs = course.get("requirements")
        if not isinstance(reqs, dict):
            if not wanted:
                continue
            reqs = course["requirements"] = {p: [] for p in BASE_PROGRAM_KEYS}

        wanted_programs = {program for program, _, _ in wanted}
        for program in list(reqs):
            rows = reqs[program]
            if not isinstance(rows, list):
                continue
            kept = [r for r in rows if not (
                isinstance(r, dict) and r.get("source") == RULE_SOURCE
                and (program, r.get("requirement"), bool(r.get("type"))) not in wanted)]
            if len(kept) != len(rows):
                stats["rule_rows_removed"] += len(rows) - len(kept)
                reqs[program] = kept
                # Like every course with no AI row, drop an AI list the rules emptied.
                if not kept and program not in BASE_PROGRAM_KEYS and program not in wanted_programs:
                    del reqs[program]

        for (program, path, typ), rule in wanted.items():
            rows = reqs.setdefault(program, [])
            if any(isinstance(r, dict) and r.get("requirement") == path and bool(r.get("type")) == typ
                   for r in rows):
                continue
            rows.append({"requirement": path, "type": typ, "major": program, "source": RULE_SOURCE})
            per_rule[rule.id]["added"] += 1
            stats["rule_rows_added"] += 1
    return stats


# ---------- requirement_buckets.json ----------

def _catalog_buckets(doc: dict) -> dict[str, list[str]]:
    """Validate the "catalog_buckets" section: {program: [bucket paths in catalog order]}."""
    listed = doc.get("catalog_buckets") or {}
    if not isinstance(listed, dict):
        raise OverlayError("catalog_buckets must be an object keyed by program")
    for program, paths in listed.items():
        if program not in PROGRAMS:
            raise OverlayError(f"catalog_buckets: unknown program {program!r}")
        if not isinstance(paths, list) or not all(
                isinstance(p, str) and len(p.split("---")) >= 2 and all(s and s == s.strip() for s in p.split("---"))
                for p in paths):
            raise OverlayError(f"catalog_buckets {program}: every entry must be a bucket path")
        if len(set(paths)) != len(paths):
            raise OverlayError(f"catalog_buckets {program}: a path is listed twice")
    return listed


def _node_paths(path: str) -> list[str]:
    """A path and its ancestors below the root: "A---B---C" -> ["A---B", "A---B---C"]."""
    parts = path.split("---")
    return ["---".join(parts[:i]) for i in range(2, len(parts) + 1)]


def requirement_buckets(courses: list[dict], doc: dict) -> dict[str, list[str]]:
    """{program: [every bucket path]} for the admin course editor's pick list.

    The catalog order of "catalog_buckets" (with buckets that have no rows),
    then, sorted, every row path or rule path (or a parent of one) it lacks.
    """
    listed = _catalog_buckets(doc)
    found: dict[str, set[str]] = {}
    for course in courses:
        for program, rows in (course.get("requirements") or {}).items():
            for row in rows or []:
                if isinstance(row, dict) and isinstance(row.get("requirement"), str) and "---" in row["requirement"]:
                    found.setdefault(program, set()).update(_node_paths(row["requirement"]))
    for rule in compile_rule_buckets(doc.get("rule_buckets")):
        found.setdefault(rule.program, set()).update(_node_paths(rule.path))
    programs = [p for p in PROGRAMS if p in listed or p in found]
    programs += sorted(p for p in found if p not in PROGRAMS)
    out = {}
    for program in programs:
        base = list(listed.get(program, []))
        out[program] = base + sorted(found.get(program, set()) - set(base))
    return out


def _removal_programs(entry: dict) -> tuple[str, ...]:
    programs = entry.get("programs")
    if programs == "all":
        return PROGRAMS
    if not isinstance(programs, list) or not programs or any(p not in PROGRAMS for p in programs):
        raise OverlayError(
            f"remove_mappings {entry.get('course_code')}: programs must be \"all\" "
            f"or a list from {', '.join(PROGRAMS)}"
        )
    return tuple(programs)


def removed_programs_by_code(removals: list[dict]) -> dict[str, set[str]]:
    """course_code -> programs whose requirement rows remove_mappings drops."""
    out: dict[str, set[str]] = {}
    for entry in removals:
        code = normalize_course_code(entry.get("course_code"))
        if not code:
            raise OverlayError(f"remove_mappings entry without course_code: {entry}")
        out.setdefault(code, set()).update(_removal_programs(entry))
    return out


def apply_remove_mappings(by_code: dict[str, dict], removed: dict[str, set[str]]) -> dict:
    """Section 3: drop the requirement rows of the listed programs."""
    stats = {"mappings_removed": 0, "remove_codes_missing": []}
    for code, programs in sorted(removed.items()):
        course = by_code.get(code)
        if course is None:
            stats["remove_codes_missing"].append(code)
            continue
        reqs = course.get("requirements")
        if not isinstance(reqs, dict):
            continue
        for program in sorted(programs):
            if reqs.get(program):
                stats["mappings_removed"] += len(reqs[program])
                reqs[program] = []
    return stats


def _visibility_flags(entries: list[dict]) -> dict[str, set[str]]:
    wanted: dict[str, set[str]] = {}
    for entry in entries:
        code = normalize_course_code(entry.get("course_code"))
        rule = entry.get("rule")
        if not code or rule not in VISIBILITY_RULES:
            raise OverlayError(
                f"qatar_visibility entry needs course_code and a rule from {sorted(VISIBILITY_RULES)}: {entry}"
            )
        wanted.setdefault(code, set()).add(VISIBILITY_RULES[rule])
    return wanted


def apply_qatar_visibility(courses: list[dict], by_code: dict[str, dict], entries: list[dict]) -> dict:
    """Section 4: set the flag each rule names; rows not listed lose it."""
    wanted = _visibility_flags(entries)
    stats = {
        "visibility_flags": sum(len(f) for c, f in wanted.items() if c in by_code),
        "visibility_codes_missing": sorted(c for c in wanted if c not in by_code),
    }
    for course in courses:
        flags = wanted.get(course.get("course_code"), set())
        for flag in VISIBILITY_RULES.values():
            if flag in flags:
                course[flag] = True
            else:
                course.pop(flag, None)
    return stats


def validate_rule_buckets(rules: list[_RuleBucket], doc: dict) -> None:
    """Checks across sections: a rule id is not also an overlay id, and every
    rule bucket is a bucket of catalog_buckets (when the file has that section)."""
    overlay_ids = {o.get("id") for o in doc.get("overlays") or [] if isinstance(o, dict)}
    clash = sorted({r.id for r in rules} & overlay_ids)
    if clash:
        raise OverlayError(f"rule_buckets: id(s) {clash} are also overlay ids")
    listed = _catalog_buckets(doc)
    if not listed:
        return
    for rule in rules:
        if rule.path not in listed.get(rule.program, []):
            raise OverlayError(f"rule bucket {rule.id}: {rule.path!r} is not in catalog_buckets {rule.program}")


def apply_overlay_document(courses: list[dict], doc: dict) -> dict:
    """Apply every section of mapping_overlays.json in the documented order.

    Raises OverlayError, before any requirement or flag changes, when the file
    is invalid.
    """
    removed = removed_programs_by_code(doc.get("remove_mappings") or [])
    _visibility_flags(doc.get("qatar_visibility") or [])
    rules = compile_rule_buckets(doc.get("rule_buckets"))
    validate_rule_buckets(rules, doc)

    stats: dict = {"codes_normalized": normalize_catalog_codes(courses)}
    by_code = _by_code(courses)
    stats.update(_apply_additive_overlays(courses, by_code, doc.get("overlays") or [], removed))
    stats.update(apply_rule_buckets(courses, rules, removed))
    stats.update(apply_remove_mappings(by_code, removed))
    stats.update(apply_qatar_visibility(courses, by_code, doc.get("qatar_visibility") or []))
    return stats


def requirement_buckets_path(catalog_path: Path) -> Path:
    """requirement_buckets.json lives next to the catalog it describes."""
    return Path(catalog_path).with_name(REQUIREMENT_BUCKETS_NAME)


def apply_file(catalog_path: Path, doc) -> dict:
    """Apply the overlay document (or a bare "overlays" list) to one catalog
    file, and write requirement_buckets.json beside it."""
    if isinstance(doc, list):
        doc = {"overlays": doc}
    data = load_json(catalog_path)
    if isinstance(data, list):
        courses = data
        wrapper = None
    else:
        courses = data["courses"]
        wrapper = data
    stats = apply_overlay_document(courses, doc)
    buckets = requirement_buckets(courses, doc)
    save_json(catalog_path, wrapper if wrapper is not None else courses)
    save_json(requirement_buckets_path(catalog_path), buckets)
    stats["catalog"] = str(catalog_path)
    stats["bucket_paths"] = sum(len(v) for v in buckets.values())
    return stats


def query_is_igi_courses(courses: list[dict]) -> list[str]:
    codes = []
    for course in courses:
        for req in (course.get("requirements") or {}).get("IS") or []:
            if (
                isinstance(req, dict)
                and req.get("requirement") == IS_IGI_PATH
                and req.get("type") is True
            ):
                codes.append(course["course_code"])
                break
    return sorted(codes)


def verify_modern_languages(catalog_path: Path) -> dict:
    data = load_json(catalog_path)
    courses = data["courses"] if isinstance(data, dict) else data
    igi_codes = query_is_igi_courses(courses)
    missing = sorted(set(MODERN_LANGUAGE_CODES) - set(igi_codes))
    return {
        "catalog": str(catalog_path),
        "igi_total": len(igi_codes),
        "modern_language_missing": missing,
        "ok": not missing,
    }


def _course_paths_by_major(course: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for major, reqs in (course.get("requirements") or {}).items():
        paths = set()
        for req in reqs or []:
            if isinstance(req, dict) and req.get("type") is True and req.get("requirement"):
                paths.add(req["requirement"])
        if paths:
            out[major] = paths
    return out


def verify_expected_geneds(catalog_path: Path) -> dict:
    """Verify spreadsheet audit mappings are present (additive overlays may add extras)."""
    data = load_json(catalog_path)
    courses = data["courses"] if isinstance(data, dict) else data
    by_code = {c.get("course_code"): c for c in courses if c.get("course_code")}
    missing: list[str] = []
    for code, expected in EXPECTED_GENED_MAPPINGS.items():
        course = by_code.get(code)
        if not course:
            missing.append(f"{code}: course missing")
            continue
        actual = _course_paths_by_major(course)
        for major, paths in expected.items():
            have = actual.get(major, set())
            for path in paths:
                if path not in have:
                    missing.append(f"{code} {major}: {path}")
    return {
        "catalog": str(catalog_path),
        "checked": len(EXPECTED_GENED_MAPPINGS),
        "missing": missing,
        "ok": not missing,
    }


def main() -> int:
    overlays_doc = load_json(OVERLAYS_PATH)
    catalogs = [Path(p) for p in os.environ.get("CATALOG_PATHS", "").split(";") if p.strip()]
    if not catalogs:
        catalogs = DEFAULT_CATALOGS

    failed = False
    for path in catalogs:
        if not path.exists():
            print(f"skip missing catalog: {path}")
            continue
        try:
            stats = apply_file(path, overlays_doc)
        except OverlayError as exc:
            print(f"ERROR {path.name}: {exc} (catalog not saved)")
            failed = True
            continue
        print(
            f"{path.name}: normalized={stats['codes_normalized']} "
            f"created={stats['courses_created']} reqs_added={stats['requirements_added']} "
            f"rule_rows_added={stats['rule_rows_added']} rule_rows_removed={stats['rule_rows_removed']} "
            f"mappings_removed={stats['mappings_removed']} visibility_flags={stats['visibility_flags']} "
            f"bucket_paths={stats['bucket_paths']}"
        )
        for rule_id, counts in stats["rule_buckets"].items():
            print(f"  rule {rule_id}: matched={counts['matched']} added={counts['added']}")
        for item in stats["rule_includes_missing"]:
            print(f"  NOTE rule bucket include: course not in the catalog: {item}")
        for item in stats["overlay_codes_missing"]:
            print(f"  WARNING overlay: course not in the catalog, not created: {item}")
        for code in stats["remove_codes_missing"]:
            print(f"  WARNING remove_mappings: course not in the catalog: {code}")
        for code in stats["visibility_codes_missing"]:
            print(f"  WARNING qatar_visibility: course not in the catalog: {code}")

    for path in catalogs:
        if not path.exists():
            continue
        result = verify_modern_languages(path)
        status = "OK" if result["ok"] else "FAIL"
        print(f"verify {path.name}: {status} IGI={result['igi_total']} missing={result['modern_language_missing']}")
        if not result["ok"]:
            failed = True

        audit = verify_expected_geneds(path)
        audit_status = "OK" if audit["ok"] else "FAIL"
        print(f"audit {path.name}: {audit_status} checked={audit['checked']} gaps={len(audit['missing'])}")
        if not audit["ok"]:
            for gap in audit["missing"][:20]:
                print(f"  - {gap}")
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
