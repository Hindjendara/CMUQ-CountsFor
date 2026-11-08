#!/usr/bin/env python3
"""Apply backend/data/mapping_overlays.json to the served course catalog.

Mappings live in course records inside JSON catalogs, not in Postgres.
Run after reconcile_offerings.py so overlays survive daily SOC scrapes.

The SOC scrape stays the rule; the overlay file is the one place for manual
complements on top of it. One run applies its sections in this order, and
running it again changes nothing:

1. "renumbered": copy the retired code's requirement rows (and an empty
   description or prerequisites) onto the current code, set "previous_codes"
   on the current row and "superseded_by" on the retired row. The retired row
   is kept, because validate_soc_coverage needs every code soc.json lists.
   A retired code missing from the catalog is skipped with a warning; a
   current code missing from the catalog fails the run (nothing is saved).
2. "overlays": additive requirement mappings.
3. "remove_mappings": drop requirement rows per program. Runs after 1 and 2
   so nothing re-adds them; steps 1 and 2 also skip those programs.
4. "qatar_visibility": set "qatar_only" on courses the frontend shows only
   when their SOC offerings include the Qatar campus.

"previous_codes", "superseded_by" and "qatar_only" belong to this step: a row
not listed in the file loses them. Copied requirement rows stay.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from json_io import load_json, save_json  # noqa: E402
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON  # noqa: E402
from soc_parse import normalize_course_code  # noqa: E402

OVERLAYS_PATH = Path(
    os.environ.get("MAPPING_OVERLAYS_PATH")
    or MAPPING_OVERLAYS_JSON
)
PROGRAMS = ("CS", "IS", "BA", "BS")
# qatar_visibility rule -> course flag the frontend reads
VISIBILITY_RULES = {"show_only_if_offered_qatar": "qatar_only"}
DEFAULT_CATALOGS = [
    COURSES_JSON,
]

IS_IGI_PATH = "GenEd---GenEd---Foundations---Intercultural and Global Inquiry"
IS_CONTEXTUAL_PATH = "GenEd---GenEd---Foundations---Contextual Thinking"
BA_GLOBAL_PATH = (
    "EY2022 Qatar Business Administration - University Core Requirements"
    "---Global, Cultural, and Diverse Perspectives"
)
BS_ML_PATH = "GenEd---Cultural/Global Understanding---Modern Languages Course"
BS_NTB_PATH = "GenEd---Non-Technical Breadth Electives"
CS_HUMANITIES_PATH = "GenEd---Humanities/Arts Electives"
CS_CAT3_PATH = "GenEd---Category 3: Cultural Analysis"

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
    """Add overlay requirements without removing or overwriting existing rows."""
    if "requirements" not in course or not isinstance(course["requirements"], dict):
        course["requirements"] = {"CS": [], "IS": [], "BA": [], "BS": []}
    added = 0
    for major, reqs in overlay_reqs.items():
        bucket = course["requirements"].setdefault(major, [])
        existing = {_req_key(r) for r in bucket if isinstance(r, dict)}
        for req in reqs:
            if not isinstance(req, dict):
                continue
            key = _req_key(req)
            if key in existing:
                continue
            bucket.append(dict(req))
            existing.add(key)
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
    """Section 2. An overlay may set:

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


def renumbered_pairs(renumbered: list[dict]) -> list[tuple[str, str]]:
    """(old, current) pairs. Rejects missing fields, self links, conflicts and chains."""
    pairs: list[tuple[str, str]] = []
    olds: dict[str, str] = {}
    for entry in renumbered:
        old = normalize_course_code(entry.get("old"))
        current = normalize_course_code(entry.get("current"))
        if not old or not current:
            raise OverlayError(f"renumbered entry needs old and current: {entry}")
        if old == current:
            raise OverlayError(f"renumbered {old}: old and current are the same code")
        if olds.get(old, current) != current:
            raise OverlayError(f"renumbered {old}: listed with two current codes ({olds[old]}, {current})")
        olds[old] = current
        pairs.append((old, current))
    for old, current in pairs:
        if current in olds:
            raise OverlayError(
                f"renumbered {old} -> {current}: {current} is itself renumbered to {olds[current]}; "
                "link the old code to the final code instead"
            )
    return pairs


def apply_renumbered(
    courses: list[dict],
    by_code: dict[str, dict],
    renumbered: list[dict],
    removed: dict[str, set[str]] | None = None,
) -> dict:
    """Section 1: link retired codes to their current code (see the module docstring)."""
    removed = removed or {}
    pairs = renumbered_pairs(renumbered)
    missing_current = sorted({cur for _, cur in pairs if cur not in by_code})
    if missing_current:
        raise OverlayError(
            "renumbered: current code(s) missing from the catalog: " + ", ".join(missing_current)
        )

    stats = {"renumbered_linked": 0, "renumbered_old_missing": [], "requirements_copied": 0}
    superseded: dict[str, str] = {}
    previous: dict[str, list[str]] = {}
    for old, current in pairs:
        old_row = by_code.get(old)
        if old_row is None:
            stats["renumbered_old_missing"].append(f"{old} -> {current}")
            continue
        cur_row = by_code[current]
        blocked = removed.get(current, set())
        copy = {
            major: [r for r in reqs or [] if isinstance(r, dict)]
            for major, reqs in (old_row.get("requirements") or {}).items()
            if major not in blocked
        }
        stats["requirements_copied"] += _merge_requirements(cur_row, copy)
        for field in ("description", "prerequisites"):
            if not str(cur_row.get(field) or "").strip() and str(old_row.get(field) or "").strip():
                cur_row[field] = old_row[field]
        superseded[old] = current
        previous.setdefault(current, []).append(old)
        stats["renumbered_linked"] += 1

    for course in courses:
        code = course.get("course_code")
        if code in superseded:
            course["superseded_by"] = superseded[code]
        else:
            course.pop("superseded_by", None)
        if code in previous:
            course["previous_codes"] = previous[code]
        else:
            course.pop("previous_codes", None)
    return stats


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


def apply_overlay_document(courses: list[dict], doc: dict) -> dict:
    """Apply every section of mapping_overlays.json in the documented order.

    Raises OverlayError, before any requirement or flag changes, when the file
    is invalid or a renumbered current code is missing from the catalog.
    """
    removed = removed_programs_by_code(doc.get("remove_mappings") or [])
    renumbered_pairs(doc.get("renumbered") or [])
    _visibility_flags(doc.get("qatar_visibility") or [])

    stats: dict = {"codes_normalized": normalize_catalog_codes(courses)}
    by_code = _by_code(courses)
    stats.update(apply_renumbered(courses, by_code, doc.get("renumbered") or [], removed))
    stats.update(_apply_additive_overlays(courses, by_code, doc.get("overlays") or [], removed))
    stats.update(apply_remove_mappings(by_code, removed))
    stats.update(apply_qatar_visibility(courses, by_code, doc.get("qatar_visibility") or []))
    return stats


def apply_file(catalog_path: Path, doc) -> dict:
    """Apply the overlay document (or a bare "overlays" list) to one catalog file."""
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
    save_json(catalog_path, wrapper if wrapper is not None else courses)
    stats["catalog"] = str(catalog_path)
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
            f"renumbered={stats['renumbered_linked']} reqs_copied={stats['requirements_copied']} "
            f"created={stats['courses_created']} reqs_added={stats['requirements_added']} "
            f"mappings_removed={stats['mappings_removed']} visibility_flags={stats['visibility_flags']}"
        )
        for item in stats["renumbered_old_missing"]:
            print(f"  WARNING renumbered: old code not in the catalog, skipped: {item}")
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
