#!/usr/bin/env python3
"""Verify every SOC course (PIT + Qatar) exists in courses.json with offerings.

Also warns (without failing) about possible renumberings: two rows of the same
department with the same cleaned title, one in the SOC and one not, that
data/mapping_overlays.json "renumbered" does not link. Nothing is linked
automatically; a person decides and adds the pair to the overlay file.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from soc_parse import (  # noqa: E402
    clean_soc_title,
    course_number_to_code,
    is_cancelled_course,
    is_ignored_course,
    malformed_counts,
    normalize_course_code,
    normalize_title,
)

SOC_PATH = os.environ.get("SOC_JSON_PATH", str(ROOT / "data" / "soc.json"))
COURSES_PATH = os.environ.get("COURSES_JSON_PATH", str(ROOT / "data" / "courses.json"))
OVERLAYS_PATH = os.environ.get(
    "MAPPING_OVERLAYS_PATH", str(ROOT / "data" / "mapping_overlays.json")
)


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


def catalog_codes(courses: list[dict]) -> set[str]:
    """Codes the catalog covers: every row (superseded rows included) plus
    the retired codes a current row lists in previous_codes."""
    codes = {c.get("course_code") for c in courses if c.get("course_code")}
    for c in courses:
        codes.update(p for p in c.get("previous_codes") or [] if p)
    return codes


def all_soc_codes(soc: dict) -> set[str]:
    """Every course code in soc.json, cancelled-only courses included."""
    return {
        course_number_to_code(course.get("course_number"))
        for sem_data in (soc.get("semesters") or {}).values()
        for course in sem_data.get("courses") or []
        if course.get("course_number")
    }


def linked_pairs(courses: list[dict], overlays_doc: dict | None) -> set[frozenset]:
    """Old/current pairs linked by the overlay file or by superseded_by."""
    pairs = set()
    for entry in (overlays_doc or {}).get("renumbered") or []:
        old = normalize_course_code(entry.get("old"))
        cur = normalize_course_code(entry.get("current"))
        if old and cur:
            pairs.add(frozenset((old, cur)))
    for c in courses:
        if c.get("superseded_by") and c.get("course_code"):
            pairs.add(frozenset((c["course_code"], c["superseded_by"])))
    return pairs


def _title_key(course: dict) -> str:
    name = course.get("course_name") or ""
    return normalize_title(clean_soc_title(name) or name)


def unlinked_title_pairs(
    courses: list[dict], soc_codes: set[str], linked: set[frozenset]
) -> list[dict]:
    """Same department, same cleaned title, one row in the SOC and one not,
    and not linked in "renumbered". A row that is already superseded has its
    successor and is not reported again. Sorted by department, title, codes."""
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
        outside = sorted(
            r["course_code"]
            for r in rows
            if r["course_code"] not in soc_codes and not r.get("superseded_by")
        )
        for old in outside:
            for cur in inside:
                if frozenset((old, cur)) in linked:
                    continue
                title = next(r.get("course_name") for r in rows if r["course_code"] == cur)
                out.append({"department": dept, "outside_soc": old, "in_soc": cur, "title": title})
    return out


def print_unlinked_pairs(pairs: list[dict]) -> None:
    if not pairs:
        return
    print(
        f"\nWARNING: {len(pairs)} same-title pair(s) where one row is outside the SOC and "
        "the pair is not linked in mapping_overlays.json \"renumbered\" (possible renumberings; "
        "confirm before linking):"
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

    fresh_bad = fresh_malformed(soc)
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

    overlays_doc = None
    if os.path.exists(OVERLAYS_PATH):
        with open(OVERLAYS_PATH, encoding="utf-8") as f:
            overlays_doc = json.load(f)
    print_unlinked_pairs(
        unlinked_title_pairs(courses, all_soc_codes(soc), linked_pairs(courses, overlays_doc))
    )

    if fresh_bad:
        print("\nFAIL: the newest scrape has malformed SOC data, which the pipeline ignores "
              "(units cell not units, or section cell not a section id). Check the SOC "
              "page format and the parser before adopting this soc.json:")
        for sem, n in sorted(fresh_bad.items()):
            print(f"  - {sem}: {n['courses']} course(s), {n['sections']} section(s)")

    if all_missing:
        print(f"\nFAIL: {len(all_missing)} SOC course(s) not in CountsFor catalog:")
        for code in sorted(all_missing)[:30]:
            print(f"  - {code}")
        if len(all_missing) > 30:
            print(f"  ... and {len(all_missing) - 30} more")
        return 1
    if fresh_bad:
        return 1

    print("\nOK: every SOC course is present in courses.json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
