#!/usr/bin/env python3
"""Verify every SOC course (PIT + Qatar) exists in courses.json with offerings."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from soc_parse import course_number_to_code, is_cancelled_course  # noqa: E402

SOC_PATH = os.environ.get("SOC_JSON_PATH", str(ROOT / "data" / "soc.json"))
COURSES_PATH = os.environ.get("COURSES_JSON_PATH", str(ROOT / "data" / "courses.json"))


def soc_course_codes(soc: dict) -> dict[str, set[str]]:
    """Return {semester_code: set(course_code)} from scraped SOC data.

    Courses whose sections are all cancelled are left out: reconcile does not
    add a catalog row for a course that has no running section.
    """
    by_sem: dict[str, set[str]] = {}
    for sem_code, sem_data in (soc.get("semesters") or {}).items():
        codes = set()
        for course in sem_data.get("courses") or []:
            num = course.get("course_number") or ""
            if num and not is_cancelled_course(course):
                codes.add(course_number_to_code(num))
        by_sem[sem_code] = codes
    return by_sem


def catalog_codes(courses: list[dict]) -> set[str]:
    return {c.get("course_code") for c in courses if c.get("course_code")}


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

    all_missing: set[str] = set()
    print("SOC coverage check (PIT + Qatar)")
    print("=" * 50)
    for sem_code, codes in sorted(soc_course_codes(soc).items()):
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

    if all_missing:
        print(f"\nFAIL: {len(all_missing)} SOC course(s) not in CountsFor catalog:")
        for code in sorted(all_missing)[:30]:
            print(f"  - {code}")
        if len(all_missing) > 30:
            print(f"  ... and {len(all_missing) - 30} more")
        return 1

    print("\nOK: every SOC course is present in courses.json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
