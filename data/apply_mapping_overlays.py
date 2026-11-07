#!/usr/bin/env python3
"""Apply manual requirement overlays to bundled course catalogs.

Mappings live in course records inside JSON catalogs — not in Postgres.
Run after reconcile_offerings.py so overlays survive daily SOC scrapes.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from json_io import load_json, save_json  # noqa: E402
from soc_parse import normalize_course_code  # noqa: E402

OVERLAYS_PATH = Path(__file__).resolve().parent / "mapping_overlays.json"
DEFAULT_CATALOGS = [
    ROOT / "data" / "courses.json",
    ROOT / "data_all_courses.json",
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


def apply_overlays_to_courses(courses: list[dict], overlays: list[dict]) -> dict:
    by_code = {c.get("course_code"): c for c in courses if c.get("course_code")}
    stats = {"codes_normalized": 0, "courses_created": 0, "requirements_added": 0}

    stats["codes_normalized"] = normalize_catalog_codes(courses)
    by_code = {c.get("course_code"): c for c in courses if c.get("course_code")}

    for overlay in overlays:
        overlay_reqs = overlay.get("requirements") or {}
        defaults = overlay.get("ensure_course_defaults") or {}
        for code in overlay.get("course_codes") or []:
            canonical = normalize_course_code(code)
            if not canonical:
                continue
            course = by_code.get(canonical)
            if course is None:
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
            for field, value in defaults.items():
                if field == "department" and not course.get("department"):
                    course["department"] = str(value)
                elif field == "offered_qatar" and value:
                    course["offered_qatar"] = True
            stats["requirements_added"] += _merge_requirements(course, overlay_reqs)

    return stats


def apply_file(catalog_path: Path, overlays: list[dict]) -> dict:
    data = load_json(catalog_path)
    if isinstance(data, list):
        courses = data
        wrapper = None
    else:
        courses = data["courses"]
        wrapper = data
    stats = apply_overlays_to_courses(courses, overlays)
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
    overlays = overlays_doc.get("overlays") or []
    catalogs = [Path(p) for p in os.environ.get("CATALOG_PATHS", "").split(";") if p.strip()]
    if not catalogs:
        catalogs = DEFAULT_CATALOGS

    for path in catalogs:
        if not path.exists():
            print(f"skip missing catalog: {path}")
            continue
        stats = apply_file(path, overlays)
        print(f"{path.name}: normalized={stats['codes_normalized']} created={stats['courses_created']} reqs_added={stats['requirements_added']}")

    failed = False
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
