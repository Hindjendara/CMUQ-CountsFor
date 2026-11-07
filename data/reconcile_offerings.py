#!/usr/bin/env python3
"""Merge SOC scrape output into data/courses.json offerings and campus flags."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from json_io import load_json, save_json  # noqa: E402
from soc_parse import (  # noqa: E402
    apply_campus_fix,
    build_offering,
    code_to_course_number,
    course_number_to_code,
    normalize_course_code,
    parse_soc_units,
    titles_match,
)

SOC_PATH = os.environ.get("SOC_JSON_PATH", str(ROOT / "data" / "soc.json"))
COURSES_PATH = os.environ.get("COURSES_JSON_PATH", str(ROOT / "data" / "courses.json"))
ALL_COURSES_PATH = os.environ.get("ALL_COURSES_PATH", str(ROOT / "data_all_courses.json"))



def _semester_sort_key(code: str) -> tuple[int, int]:
    if not code or len(code) < 3:
        return (0, 0)
    season_rank = {"F": 3, "S": 2, "M": 1, "N": 0}
    try:
        year = 2000 + int(code[1:3])
    except ValueError:
        year = 0
    return (year, season_rank.get(code[0].upper(), 0))


def offerings_from_soc(soc: dict) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """course_code -> offerings and course_code -> SOC metadata across all semesters."""
    by_code: dict[str, list[dict]] = {}
    meta_by_code: dict[str, dict] = {}
    semesters = soc.get("semesters") or {}

    for sem_code in sorted(semesters.keys(), key=_semester_sort_key, reverse=True):
        sem_data = semesters[sem_code]
        for course in sem_data.get("courses") or []:
            num = course.get("course_number") or ""
            code = course_number_to_code(num)
            title = course.get("title") or ""
            units = course.get("units")
            parsed_units = parse_soc_units(units)
            prev = meta_by_code.get(code)
            if prev is None:
                meta_by_code[code] = {
                    "title": title,
                    "units": units,
                    "department": course.get("department") or course.get("department_code"),
                }
            else:
                if title:
                    prev["title"] = title
                if parsed_units is not None:
                    prev["units"] = units
                dept = course.get("department") or course.get("department_code")
                if dept:
                    prev["department"] = dept
            for section in course.get("sections") or []:
                off = build_offering(
                    semester_code=sem_code,
                    section=section,
                    units=units,
                )
                off["campus"] = apply_campus_fix(num, title, off.get("campus"))
                if off["campus"]:
                    by_code.setdefault(code, []).append(off)
    return by_code, meta_by_code


def campus_flags_from_offerings(offerings: list[dict]) -> tuple[bool, bool]:
    qatar = any(o.get("campus") == "Qatar" for o in offerings)
    pitts = any(o.get("campus") == "Pittsburgh" for o in offerings)
    return qatar, pitts


def resolve_catalog_soc_offerings(
    course: dict,
    offerings: list[dict],
    meta: dict | None,
) -> list[dict]:
    """Attach SOC offerings only when titles align; handle reused course numbers."""
    if not offerings:
        return []

    soc_title = ((meta or {}).get("title") or "").strip()
    catalog_name = (course.get("course_name") or "").strip()
    if not soc_title or titles_match(catalog_name, soc_title):
        return offerings

    # CMU reused this number for a different course — drop stale catalog title.
    if catalog_name and catalog_name != soc_title:
        course["previous_course_name"] = catalog_name
    course["course_name"] = soc_title
    course.pop("soc_title", None)
    units_raw = (meta or {}).get("units")
    parsed_units = parse_soc_units(units_raw)
    if parsed_units is not None:
        course["units"] = parsed_units
    elif units_raw is not None:
        try:
            course["units"] = int(units_raw) if str(units_raw).isdigit() else course.get("units")
        except (TypeError, ValueError):
            pass
    return offerings


def reconcile_course(course: dict, offerings: list[dict], meta: dict | None = None) -> None:
    qatar, pitts = campus_flags_from_offerings(offerings)
    forced = apply_campus_fix(
        code_to_course_number(course.get("course_code", "")),
        course.get("course_name"),
        None,
    )
    if forced == "Qatar":
        qatar, pitts = True, False
    elif forced == "Pittsburgh":
        qatar, pitts = False, True

    if meta:
        parsed_units = parse_soc_units(meta.get("units"))
        if parsed_units is not None:
            course["units"] = parsed_units

    course["offerings"] = offerings
    course["offered_qatar"] = qatar
    course["offered_pitts"] = pitts
    # Legacy single-semester sections for older UI paths
    course["soc_sections"] = [
        {
            "section": o.get("section"),
            "days": (o.get("days_times") or "").split(" ")[0] if o.get("days_times") else "",
            "begin_time": "",
            "end_time": "",
            "location": o.get("location") or (
                "Doha, Qatar" if o.get("campus") == "Qatar" else "Pittsburgh, Pennsylvania"
            ),
            "delivery_mode": o.get("delivery_mode_raw") or o.get("modality"),
            "campus": o.get("campus"),
            "modality": o.get("modality"),
            "semester_code": o.get("semester_code"),
            "semester": o.get("semester"),
        }
        for o in offerings
    ]


def stub_course_from_soc(code: str, offerings: list[dict], meta: dict | None = None) -> dict:
    """Minimal course row for SOC-only courses not yet in the catalog."""
    prefix = code.split("-")[0]
    units_raw = (meta or {}).get("units") or (offerings[0].get("units") if offerings else "")
    units = parse_soc_units(units_raw)
    if units is None:
        try:
            units = int(units_raw) if str(units_raw).isdigit() else 0
        except (TypeError, ValueError):
            units = 0
    title = (meta or {}).get("title") or code
    sem_codes = sorted({o.get("semester_code") for o in offerings if o.get("semester_code")})
    course = {
        "course_code": code,
        "course_name": title,
        "department": prefix.lstrip("0") or prefix,
        "units": units,
        "description": "",
        "prerequisites": "",
        "offered": sem_codes,
        "offered_qatar": False,
        "offered_pitts": False,
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
        "soc_sections": [],
        "offerings": [],
        "soc_title": title,
        "soc_department": (meta or {}).get("department"),
        "soc_ingested": True,
    }
    reconcile_course(course, offerings, meta)
    return course


def reconcile_file(courses_path: str, soc_path: str) -> dict:
    soc = load_json(soc_path)
    data = load_json(courses_path)
    if isinstance(data, list):
        courses = data
        wrapper = None
    else:
        courses = data["courses"]
        wrapper = data

    by_code, meta_by_code = offerings_from_soc(soc)
    existing_codes = {c.get("course_code") for c in courses}
    updated = 0
    added = 0

    for course in courses:
        code = normalize_course_code(course.get("course_code"))
        if code and code != course.get("course_code"):
            course["course_code"] = code
        offs = by_code.get(code, [])
        meta = meta_by_code.get(code)
        resolved_offs = resolve_catalog_soc_offerings(course, offs, meta)
        old_q, old_p = course.get("offered_qatar"), course.get("offered_pitts")
        reconcile_course(course, resolved_offs, meta)
        if (
            course.get("offerings") != resolved_offs
            or course.get("offered_qatar") != old_q
            or course.get("offered_pitts") != old_p
        ):
            updated += 1

    for code, offs in sorted(by_code.items()):
        if code in existing_codes:
            continue
        courses.append(stub_course_from_soc(code, offs, meta_by_code.get(code)))
        existing_codes.add(code)
        added += 1

    save_json(courses_path, wrapper if wrapper is not None else courses)
    return {
        "courses_updated": updated,
        "courses_added": added,
        "offerings_courses": len(by_code),
    }


def main():
    if not os.path.exists(SOC_PATH):
        print(f"ERROR: {SOC_PATH} not found")
        sys.exit(1)
    if not os.path.exists(COURSES_PATH):
        print(f"ERROR: {COURSES_PATH} not found")
        sys.exit(1)

    stats = reconcile_file(COURSES_PATH, SOC_PATH)
    print(f"Reconciled {COURSES_PATH}: {stats}")

    if os.path.exists(ALL_COURSES_PATH):
        stats2 = reconcile_file(ALL_COURSES_PATH, SOC_PATH)
        print(f"Reconciled {ALL_COURSES_PATH}: {stats2}")


if __name__ == "__main__":
    main()
