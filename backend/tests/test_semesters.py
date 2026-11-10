"""Semester codes and the default semester (backend/semesters.py)."""
import json
import os

import pytest

from backend.semesters import (
    default_semester, normalize_semester, pick_default_semester, semester_rank, soc_campuses,
)


def write_soc(path, sections_by_semester, mtime=None):
    """A small soc.json: {semester: [(campus, cancelled), ...] or [campus, ...]}."""
    def section(spec):
        campus, cancelled = spec if isinstance(spec, tuple) else (spec, False)
        row = {"section": "A", "campus": campus}
        if cancelled:
            row["cancelled"] = True
        return row
    data = {"metadata": {"last_scrape": "2026-11-07T22:10:04+00:00"}, "semesters": {
        sem: {"courses": [{"course_number": "15122", "sections": [section(s) for s in specs]}]}
        for sem, specs in sections_by_semester.items()
    }}
    path.write_text(json.dumps(data), encoding="utf-8")
    if mtime is not None:  # a distinct mtime, so a rewrite within one clock tick is still seen
        os.utime(path, ns=(mtime, mtime))
    return path


@pytest.mark.parametrize("raw,expected", [
    ("S27", "S27"), (" s27 ", "S27"), ("M26", "M26"), ("F31", "F31"), ("N20", "N20"),
    ("all", None), ("ALL", None), ("", None), (None, None), (27, None), ("F2026", None),
    ("Spring 2027", None), ("X27", None),
])
def test_normalize_semester_accepts_any_code(raw, expected):
    assert normalize_semester(raw) == expected


def test_semester_rank_orders_spring_summer_fall():
    codes = ["F25", "S27", "M26", "F26", "S26", "all"]
    assert sorted(codes, key=semester_rank, reverse=True) == ["S27", "F26", "M26", "S26", "F25", "all"]


def test_default_is_the_newest_fall_or_spring_with_a_qatar_section():
    campuses = {"F25": {"Qatar"}, "S26": {"Qatar"}, "M26": {"Pittsburgh", "Qatar"},
                "F26": {"Pittsburgh", "Qatar"}, "S27": {"Pittsburgh", "Qatar"}}
    assert pick_default_semester(campuses) == "S27"
    # A new semester needs no code change: Pittsburgh alone does not move the default...
    assert pick_default_semester({**campuses, "F27": {"Pittsburgh"}}) == "S27"
    # ...Qatar sections do. Summer never is the default while there is a fall or spring.
    assert pick_default_semester({**campuses, "F27": {"Qatar"}}) == "F27"
    assert pick_default_semester({**campuses, "M27": {"Qatar"}}) == "S27"
    assert pick_default_semester({"S27": {"Pittsburgh"}, "F26": {"Pittsburgh"}}) == "S27"
    assert pick_default_semester({"M27": {"Qatar"}}) == "M27"
    assert pick_default_semester({}) is None


def test_soc_campuses_skips_cancelled_sections(tmp_path):
    soc = json.loads(write_soc(tmp_path / "soc.json", {
        "S27": ["Pittsburgh", ("Qatar", True)], "F26": ["Qatar"],
    }).read_text(encoding="utf-8"))
    assert soc_campuses(soc) == {"S27": {"Pittsburgh"}, "F26": {"Qatar"}}
    assert soc_campuses({}) == {}


def test_default_semester_reads_soc_json_again_when_it_changes(tmp_path):
    soc = write_soc(tmp_path / "soc.json", {"F26": ["Qatar"], "S27": ["Qatar"]}, mtime=1_000_000_000)
    assert default_semester(soc) == "S27"
    write_soc(soc, {"F26": ["Qatar"], "S27": ["Qatar"], "F27": ["Pittsburgh", "Qatar"]}, mtime=2_000_000_000)
    assert default_semester(soc) == "F27"
    assert default_semester(tmp_path / "missing.json") is None
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    assert default_semester(tmp_path / "bad.json") is None
