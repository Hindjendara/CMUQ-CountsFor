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
    clean_soc_title,
    code_to_course_number,
    course_number_to_code,
    is_cancelled_section,
    is_malformed_course,
    is_placeholder_title,
    malformed_counts,
    normalize_course_code,
    parse_soc_units,
    titles_match,
    usable_sections,
)

SOC_PATH = os.environ.get("SOC_JSON_PATH", str(ROOT / "data" / "soc.json"))
COURSES_PATH = os.environ.get("COURSES_JSON_PATH", str(ROOT / "data" / "courses.json"))



def _semester_sort_key(code: str) -> tuple[int, int]:
    if not code or len(code) < 3:
        return (0, 0)
    # Within a year: spring (S), then summer (M), then fall (F), as in
    # sortSemesters in js/data.js.
    season_rank = {"S": 1, "M": 2, "F": 3, "N": 0}
    try:
        year = 2000 + int(code[1:3])
    except ValueError:
        year = 0
    return (year, season_rank.get(code[0].upper(), 0))


def offerings_from_soc(soc: dict) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """course_code -> offerings and course_code -> SOC metadata across all semesters."""
    by_code: dict[str, list[dict]] = {}
    meta_by_code: dict[str, dict] = {}
    placeholders: dict[str, str] = {}
    semesters = soc.get("semesters") or {}

    for sem_code in sorted(semesters.keys(), key=_semester_sort_key, reverse=True):
        sem_data = semesters[sem_code]
        for course in sem_data.get("courses") or []:
            if is_malformed_course(course):
                # Shifted summer row from the old fixed-column parser: kept in
                # soc.json, ignored here (see soc_parse.is_malformed_course).
                continue
            num = course.get("course_number") or ""
            code = course_number_to_code(num)
            title = course.get("title") or ""
            units = course.get("units")
            dept = course.get("department") or course.get("department_code")
            # Semesters are walked newest first, so the first value seen wins:
            # an older semester only fills a field the newer ones left empty.
            # "title" is the cleaned title (clean_soc_title), None if no
            # semester has a usable one. A "TBA" placeholder title is kept
            # aside and used only when no semester has another title.
            prev = meta_by_code.setdefault(
                code, {"title": None, "units": None, "department": None}
            )
            cleaned = clean_soc_title(title)
            if is_placeholder_title(cleaned):
                placeholders.setdefault(code, cleaned)
            elif prev["title"] is None:
                prev["title"] = cleaned
            if prev["units"] is None and parse_soc_units(units) is not None:
                prev["units"] = units
            if prev["department"] is None and dept:
                prev["department"] = dept
            # Cancelled sections are not offerings: they must not set campus
            # flags or the `offered` list of a new stub course. Malformed
            # sections (section cell not a section id) are skipped too.
            for section in usable_sections(course):
                off = build_offering(
                    semester_code=sem_code,
                    section=section,
                    units=units,
                )
                off["campus"] = apply_campus_fix(num, title, off.get("campus"))
                if off["campus"]:
                    by_code.setdefault(code, []).append(off)
    for code, title in placeholders.items():
        if meta_by_code[code]["title"] is None:
            meta_by_code[code]["title"] = title
    return by_code, meta_by_code


def soc_presence(soc: dict) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """(present, ignored_only): course_code -> semester codes.

    present: semesters where soc.json lists the course in a usable form
    (cancelled-only included). ignored_only: semesters where it appears only
    as malformed rows, which the pipeline ignores.
    """
    present: dict[str, set[str]] = {}
    seen: dict[str, set[str]] = {}
    for sem_code, sem_data in (soc.get("semesters") or {}).items():
        for course in sem_data.get("courses") or []:
            code = course_number_to_code(course.get("course_number") or "")
            seen.setdefault(code, set()).add(sem_code)
            if not is_malformed_course(course):
                present.setdefault(code, set()).add(sem_code)
    ignored_only = {code: sems - present.get(code, set()) for code, sems in seen.items()}
    return present, {code: sems for code, sems in ignored_only.items() if sems}


def campus_flags_from_offerings(offerings: list[dict]) -> tuple[bool, bool]:
    running = [o for o in offerings if not is_cancelled_section(o)]
    qatar = any(o.get("campus") == "Qatar" for o in running)
    pitts = any(o.get("campus") == "Pittsburgh" for o in running)
    return qatar, pitts


def adopt_soc_title(course: dict, meta: dict | None) -> dict:
    """Set course_name to the newest cleaned SOC title.

    The SOC is the rule for names. When cleaning leaves nothing usable (for
    example "tba This Section Cancelled") the catalog name is kept.
    titles_match only detects a reused number: the old name goes into
    previous_course_name for review, unless the row already has one (the
    first recorded name is kept). A SOC title that matches the stored
    previous_course_name is a return to that name, not a reuse.
    Requirement mappings are never touched.

    Returns {"changed": bool, "reused": bool, "replaced": str}.
    """
    soc_title = clean_soc_title((meta or {}).get("title"))
    if not soc_title:
        return {"changed": False, "reused": False, "replaced": ""}
    catalog_name = (course.get("course_name") or "").strip()
    previous = (course.get("previous_course_name") or "").strip()
    reused = (
        bool(catalog_name)
        and not titles_match(catalog_name, soc_title)
        and not (previous and titles_match(previous, soc_title))
    )
    if reused:
        if not previous:
            course["previous_course_name"] = catalog_name
        course.pop("soc_title", None)
        parsed_units = parse_soc_units((meta or {}).get("units"))
        if parsed_units is not None:
            course["units"] = parsed_units
    elif "soc_title" in course:
        course["soc_title"] = soc_title
    changed = course.get("course_name") != soc_title
    course["course_name"] = soc_title
    return {"changed": changed, "reused": reused, "replaced": catalog_name}


def resolve_catalog_soc_offerings(
    course: dict,
    offerings: list[dict],
    meta: dict | None,
) -> list[dict]:
    """Adopt the SOC title (see adopt_soc_title) and return the offerings to attach."""
    adopt_soc_title(course, meta)
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


def offered_semesters(offerings: list[dict]) -> list[str]:
    """Semester codes with a running offering, oldest first."""
    codes = {
        o.get("semester_code")
        for o in offerings
        if o.get("semester_code") and not is_cancelled_section(o)
    }
    return sorted(codes, key=_semester_sort_key)


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
    title = clean_soc_title((meta or {}).get("title")) or code
    sem_codes = offered_semesters(offerings)
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
    soc_semesters = set(soc.get("semesters") or {})
    present, ignored_only = soc_presence(soc)
    updated = 0
    added = 0
    titles_changed = 0
    reused: list[str] = []

    for course in courses:
        code = normalize_course_code(course.get("course_code"))
        if code and code != course.get("course_code"):
            course["course_code"] = code
        offs = by_code.get(code, [])
        meta = meta_by_code.get(code)
        title = adopt_soc_title(course, meta)
        if title["changed"]:
            titles_changed += 1
        if title["reused"]:
            reused.append(f"{code}: {title['replaced']} -> {course.get('course_name')}")
        before = (course.get("offerings"), course.get("offered_qatar"), course.get("offered_pitts"))
        reconcile_course(course, offs, meta)
        if course.get("soc_ingested") and code in present:
            # Rows the SOC created follow the SOC for every semester soc.json
            # holds (cancelled-only semesters drop out). Semesters soc.json
            # does not hold, and semesters where the row appears only as
            # ignored malformed data, are kept. A row soc.json no longer lists
            # at all keeps its `offered` unchanged (rows are never emptied).
            # Catalog rows keep their history.
            skip = ignored_only.get(code, set())
            kept = [s for s in course.get("offered") or []
                    if s not in soc_semesters or s in skip]
            course["offered"] = sorted(
                set(offered_semesters(offs)) | set(kept), key=_semester_sort_key
            )
        if before != (course.get("offerings"), course.get("offered_qatar"), course.get("offered_pitts")):
            updated += 1

    # Built after normalizing, so a row stored as "85211" is not added again as "85-211".
    existing_codes = {c.get("course_code") for c in courses}
    for code, offs in sorted(by_code.items()):
        if code in existing_codes:
            continue
        courses.append(stub_course_from_soc(code, offs, meta_by_code.get(code)))
        existing_codes.add(code)
        added += 1

    save_json(courses_path, wrapper if wrapper is not None else courses)
    ignored = {sem: n for sem, n in malformed_counts(soc).items() if n["courses"] or n["sections"]}
    return {
        "malformed_ignored": ignored,
        "courses_updated": updated,
        "courses_added": added,
        "offerings_courses": len(by_code),
        "titles_changed": titles_changed,
        "reused_numbers": reused,
    }


def main():
    if not os.path.exists(SOC_PATH):
        print(f"ERROR: {SOC_PATH} not found")
        sys.exit(1)
    if not os.path.exists(COURSES_PATH):
        print(f"ERROR: {COURSES_PATH} not found")
        sys.exit(1)

    stats = reconcile_file(COURSES_PATH, SOC_PATH)
    reused = stats.pop("reused_numbers")
    ignored = stats.pop("malformed_ignored")
    print(f"Reconciled {COURSES_PATH}: {stats}")
    for sem, n in sorted(ignored.items()):
        print(f"IGNORED malformed SOC data in {sem}: {n['courses']} course(s), {n['sections']} section(s)")
    if reused:
        # Mappings are kept; someone should check whether they still apply.
        print(f"REVIEW: {len(reused)} course number(s) whose SOC title no longer matches the catalog name:")
        for line in reused:
            print(f"  - {line}")


if __name__ == "__main__":
    main()
