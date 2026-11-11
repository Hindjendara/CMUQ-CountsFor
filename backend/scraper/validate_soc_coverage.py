#!/usr/bin/env python3
"""Verify every SOC course (PIT + Qatar) exists in courses.json with offerings.

A SOC course under an old Psychology number that the renumbering list retires
(backend/data/psychology_renumbering.json) counts as present when its new
number has a row: the overlay step moves such a row to the new number and
deletes it.

Also fails when the catalog's semester list ("soc_semesters", the app's
semester picker) is not the list of the SOC search form in soc.json
(metadata.semesters_on_form), and warns (without failing) about possible
renumberings: two rows of the same department with the same cleaned title, one
in the SOC and one not. Nothing is changed automatically; a person decides what
to do with the older row.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_paths import COURSES_JSON, SOC_JSON  # noqa: E402
from psychology_renumbering import covered_by_new_number, load_renumbering  # noqa: E402
from soc_parse import (  # noqa: E402
    clean_soc_title,
    course_number_to_code,
    is_cancelled_course,
    is_ignored_course,
    malformed_counts,
    normalize_title,
    soc_form_semesters,
)

SOC_PATH = os.environ.get("SOC_JSON_PATH", str(SOC_JSON))
COURSES_PATH = os.environ.get("COURSES_JSON_PATH", str(COURSES_JSON))


def soc_course_codes(soc: dict) -> dict[str, set[str]]:
    """Return {semester_code: set(course_code)} from scraped SOC data.

    Courses whose sections are all cancelled are left out: reconcile does not
    add a catalog row for a course that has no running section. Courses the
    pipeline ignores as malformed are left out for the same reason (see
    soc_parse.is_ignored_course, which reconcile uses too).
    """
    by_sem: dict[str, set[str]] = {}
    for sem_code, sem_data in (soc.get("semesters") or {}).items():
        codes = set()
        for course in sem_data.get("courses") or []:
            num = course.get("course_number") or ""
            if not num or is_cancelled_course(course) or is_ignored_course(course):
                continue
            codes.add(course_number_to_code(num))
        by_sem[sem_code] = codes
    return by_sem


def fresh_malformed(soc: dict) -> dict[str, dict[str, int]]:
    """Malformed data in semesters the newest scrape wrote.

    Those are the semesters whose scraped_at equals metadata.last_scrape.
    The current parser should never produce malformed data, so any here
    means the SOC format changed and courses would be dropped silently.
    Semesters carried forward from older scrapes (M25) are not counted.
    """
    last = (soc.get("metadata") or {}).get("last_scrape")
    if not last:
        return {}
    fresh = {s for s, d in (soc.get("semesters") or {}).items() if d.get("scraped_at") == last}
    return {s: n for s, n in malformed_counts(soc).items()
            if s in fresh and (n["courses"] or n["sections"])}


def semester_list_problem(catalog, soc: dict) -> str | None:
    """Why the catalog's "soc_semesters" is not the SOC form's semester list, or None.

    reconcile_offerings.py copies the list; a soc.json without one (only
    hand-made test files) has nothing to compare.
    """
    form = soc_form_semesters(soc)
    if form is None:
        return None
    listed = catalog.get("soc_semesters") if isinstance(catalog, dict) else None
    if listed != form:
        return f"courses.json soc_semesters is {listed}, but the SOC form lists {form}"
    return None


def catalog_codes(courses: list[dict]) -> set[str]:
    """Codes the catalog has a row for."""
    return {c.get("course_code") for c in courses if c.get("course_code")}


def all_soc_codes(soc: dict) -> set[str]:
    """Every course code in soc.json, cancelled-only courses included."""
    return {
        course_number_to_code(course.get("course_number"))
        for sem_data in (soc.get("semesters") or {}).values()
        for course in sem_data.get("courses") or []
        if course.get("course_number")
    }


def _title_key(course: dict) -> str:
    name = course.get("course_name") or ""
    return normalize_title(clean_soc_title(name) or name)


def unlinked_title_pairs(courses: list[dict], soc_codes: set[str]) -> list[dict]:
    """Same department, same cleaned title, one row in the SOC and one not.
    Sorted by department, title, codes."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for c in courses:
        code = c.get("course_code") or ""
        key = _title_key(c)
        if "-" not in code or not key:
            continue
        groups.setdefault((code.split("-")[0], key), []).append(c)
    out = []
    for (dept, _), rows in sorted(groups.items()):
        inside = sorted(r["course_code"] for r in rows if r["course_code"] in soc_codes)
        outside = sorted(r["course_code"] for r in rows if r["course_code"] not in soc_codes)
        for old in outside:
            for cur in inside:
                title = next(r.get("course_name") for r in rows if r["course_code"] == cur)
                out.append({"department": dept, "outside_soc": old, "in_soc": cur, "title": title})
    return out


def print_unlinked_pairs(pairs: list[dict]) -> None:
    if not pairs:
        return
    print(
        f"\nWARNING: {len(pairs)} same-title pair(s) where one row is outside the SOC "
        "(possible renumberings; confirm before changing anything):"
    )
    for p in pairs:
        print(f"  - [{p['department']}] {p['outside_soc']} (not in SOC) / {p['in_soc']} (in SOC): {p['title']}")


def main() -> int:
    if not os.path.exists(SOC_PATH):
        print(f"ERROR: {SOC_PATH} not found — run scrape_soc.py first.")
        return 1
    if not os.path.exists(COURSES_PATH):
        print(f"ERROR: {COURSES_PATH} not found.")
        return 1

    with open(SOC_PATH, encoding="utf-8") as f:
        soc = json.load(f)
    with open(COURSES_PATH, encoding="utf-8") as f:
        data = json.load(f)
    courses = data["courses"] if isinstance(data, dict) else data
    known = catalog_codes(courses)
    by_sem = soc_course_codes(soc)
    renumbered = covered_by_new_number(set().union(*by_sem.values()), known, load_renumbering())
    known |= set(renumbered)

    fresh_bad = fresh_malformed(soc)
    semesters_bad = semester_list_problem(data, soc)
    all_missing: set[str] = set()
    print("SOC coverage check (PIT + Qatar)")
    print("=" * 50)
    if not semesters_bad and isinstance(data, dict) and data.get("soc_semesters"):
        print(f"  Semester picker (soc_semesters): {', '.join(data['soc_semesters'])}, as on the SOC form")
    if renumbered:
        print(f"  {len(renumbered)} SOC course(s) under an old Psychology number count as their new number: "
              + ", ".join(f"{old} ({new})" for old, new in renumbered.items()))
    for sem_code, codes in sorted(by_sem.items()):
        missing = sorted(codes - known)
        qatar_count = sum(
            1
            for c in courses
            if c.get("course_code") in codes
            and any(
                o.get("semester_code") == sem_code and o.get("campus") == "Qatar"
                for o in (c.get("offerings") or [])
            )
        )
        print(f"  {sem_code}: {len(codes)} SOC courses, {len(missing)} missing from catalog, {qatar_count} with Qatar offerings")
        all_missing.update(missing)

    print_unlinked_pairs(unlinked_title_pairs(courses, all_soc_codes(soc)))

    if fresh_bad:
        print("\nFAIL: the newest scrape has malformed SOC data, which the pipeline ignores "
              "(units cell not units, or section cell not a section id). Check the SOC "
              "page format and the parser before adopting this soc.json:")
        for sem, n in sorted(fresh_bad.items()):
            print(f"  - {sem}: {n['courses']} course(s), {n['sections']} section(s)")

    if semesters_bad:
        print(f"\nFAIL: {semesters_bad}. Run reconcile_offerings.py.")

    if all_missing:
        print(f"\nFAIL: {len(all_missing)} SOC course(s) not in CountsFor catalog:")
        for code in sorted(all_missing)[:30]:
            print(f"  - {code}")
        if len(all_missing) > 30:
            print(f"  ... and {len(all_missing) - 30} more")
        return 1
    if fresh_bad or semesters_bad:
        return 1

    print("\nOK: every SOC course is present in courses.json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
