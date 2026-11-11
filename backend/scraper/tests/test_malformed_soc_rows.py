"""Malformed summer rows (old fixed-column parser) are kept in soc.json but ignored.

The fixture holds two real courses copied from backend/data/soc.json: 79-234 from M25
(units "qatar summer", one Qatar row) and 85-150 from the old M26 scrape
(units "summer", 8 rows, most shifted by one or more columns).
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

from reconcile_offerings import offerings_from_soc, reconcile_file  # noqa: E402
from soc_parse import (  # noqa: E402
    is_ignored_course,
    is_malformed_course,
    is_malformed_section,
    is_section_id,
    is_valid_units,
    malformed_counts,
    usable_sections,
)
from validate_soc_coverage import soc_course_codes  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "soc_malformed_summer.json"


def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _course(sem, num):
    return next(c for c in _fixture()["semesters"][sem]["courses"] if c["course_number"] == num)


def _good_79234(sem="S26"):
    return {
        "course_number": "79234", "title": "Technology and Society", "units": "9",
        "department": "History",
        "sections": [{"section": "A", "days": "TR", "begin_time": "11:00AM", "end_time": "12:20PM",
                      "location": "Pittsburgh, Pennsylvania", "delivery_mode": "In Person",
                      "campus": "Pittsburgh"}],
    }


def _catalog_row(code, name, **extra):
    row = {"course_code": code, "course_name": name, "units": 9, "offered": [],
           "offered_qatar": False, "offered_pitts": False,
           "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
           "offerings": [], "description": "", "prerequisites": ""}
    row.update(extra)
    return row


def _reconcile(tmp_path, soc, rows):
    soc_path, courses_path = tmp_path / "soc.json", tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps({"courses": rows}), encoding="utf-8")
    stats = reconcile_file(str(courses_path), str(soc_path))
    out = json.loads(courses_path.read_text(encoding="utf-8"))["courses"]
    return stats, {r["course_code"]: r for r in out}


def test_real_units_and_section_ids_are_well_formed():
    for units in ("9", "12", "1.5", "VAR", "3-12", "0,36-48", "1.0 - 12.0", "9-48 4", "9, 12", "0"):
        assert is_valid_units(units), units
    for sec in ("A", "1", "W2", "AA", "Lec 14", "R"):
        assert is_section_id(sec), sec


def test_session_text_is_not_units_and_shifted_cells_are_not_section_ids():
    for units in ("summer", "qatar summer", "summer one", "summer all", "", None):
        assert not is_valid_units(units), units
    for sec in ("summer", "qatar summer", "Psychology of Prejudice", "85482", "TBA",
                "In-person Expectation", "Pittsburgh, Pennsylvania", "12:20PM", "MTWRF", "", None):
        assert not is_section_id(sec), sec


def test_real_m25_and_old_m26_courses_are_malformed():
    c79 = _course("M25", "79234")
    c85 = _course("M26", "85150")
    assert c79["units"] == "qatar summer" and c85["units"] == "summer"
    assert is_malformed_course(c79) and is_malformed_course(c85)
    assert usable_sections(c79) == [] and usable_sections(c85) == []
    # Section-level check on the same rows, as if the units cell were fine.
    shifted = [s["section"] for s in c85["sections"] if is_malformed_section(s)]
    assert shifted == ["summer", "Psychology of Prejudice", "85482", "In-person Expectation",
                       "Pittsburgh, Pennsylvania", "TBA"]


def test_malformed_counts_per_semester():
    soc = _fixture()
    soc["semesters"]["S26"] = {"courses": [_good_79234()]}
    assert malformed_counts(soc) == {
        "M25": {"courses": 1, "sections": 2},
        "M26": {"courses": 1, "sections": 8},
        "S26": {"courses": 0, "sections": 0},
    }


def test_malformed_sections_of_a_good_course_are_skipped():
    course = _good_79234()
    bad = copy.deepcopy(course["sections"][0])
    bad.update(section="Psychology of Prejudice", campus="Qatar", location="Doha, Qatar")
    course["sections"].append(bad)
    assert [s["section"] for s in usable_sections(course)] == ["A"]
    by_code, _ = offerings_from_soc({"semesters": {"S26": {"courses": [course]}}})
    assert [(o["section"], o["campus"]) for o in by_code["79-234"]] == [("A", "Pittsburgh")]


def test_bad_m25_row_gives_no_qatar_offering(tmp_path):
    soc = _fixture()
    soc["semesters"]["S26"] = {"courses": [_good_79234()]}
    by_code, meta = offerings_from_soc(soc)
    assert {o["semester_code"] for o in by_code["79-234"]} == {"S26"}
    assert meta["79-234"]["units"] == "9"
    assert "85-150" not in by_code and "85-150" not in meta

    row = _catalog_row("79-234", "Technology and Society", offered_qatar=True, offered_pitts=True)
    stats, rows = _reconcile(tmp_path, soc, [row])
    assert rows["79-234"]["offered_qatar"] is False
    assert rows["79-234"]["offered_pitts"] is True
    assert stats["courses_added"] == 0, "a malformed-only course gets no stub row"
    assert stats["malformed_ignored"] == {"M25": {"courses": 1, "sections": 2},
                                          "M26": {"courses": 1, "sections": 8}}


def test_malformed_data_is_left_in_soc_json(tmp_path):
    soc = _fixture()
    before = json.dumps(soc, sort_keys=True)
    _reconcile(tmp_path, soc, [])
    after = json.loads((tmp_path / "soc.json").read_text(encoding="utf-8"))
    assert json.dumps(after, sort_keys=True) == before


def test_validator_does_not_require_malformed_courses():
    soc = _fixture()
    soc["semesters"]["S26"] = {"courses": [_good_79234()]}
    assert soc_course_codes(soc) == {"M25": set(), "M26": set(), "S26": {"79-234"}}


def test_soc_ingested_offered_keeps_semesters_seen_only_as_malformed(tmp_path):
    soc = _fixture()
    soc["semesters"]["S26"] = {"courses": [_good_79234()]}
    stub = _catalog_row("79-234", "Technology and Society", offered=["M25"], soc_ingested=True)
    gone = _catalog_row("85-150", "Social Psychology", offered=["M26"], soc_ingested=True)
    _, rows = _reconcile(tmp_path, soc, [stub, gone])
    assert rows["79-234"]["offered"] == ["M25", "S26"], "M25 is ignored, not removed"
    assert rows["85-150"]["offered"] == ["M26"]


def _all_sections_malformed(num="62318"):
    """Units cell fine, but every section cell is not a section id."""
    secs = [dict(_good_79234()["sections"][0], section="summer"),
            dict(_good_79234()["sections"][0], section="TBA", cancelled=True)]
    return {"course_number": num, "title": "Spatial Practice", "units": "9",
            "department": "Design", "sections": secs}


def test_all_sections_malformed_but_units_ok_is_ignored(tmp_path):
    course = _all_sections_malformed()
    assert not is_malformed_course(course) and is_ignored_course(course)
    cancelled_only = dict(_good_79234(), sections=[dict(_good_79234()["sections"][0], cancelled=True)])
    assert not is_ignored_course(cancelled_only), "a cancelled-only course is listed, not ignored"
    assert not is_ignored_course(_good_79234())

    soc = {"semesters": {"F26": {"courses": [course]}, "S26": {"courses": [_good_79234()]}}}
    by_code, meta = offerings_from_soc(soc)
    assert "62-318" not in by_code and "62-318" not in meta, "no offerings or title from it"
    assert soc_course_codes(soc)["F26"] == set()
    assert malformed_counts(soc)["F26"] == {"courses": 1, "sections": 2}

    # Reconcile and the validator agree: F26 is ignored data, so a SOC-created
    # row keeps it (as with a malformed course) instead of losing it.
    soc["semesters"]["S26"]["courses"].append(dict(_all_sections_malformed(), sections=[
        dict(_good_79234()["sections"][0], section="A")]))
    stub = _catalog_row("62-318", "Spatial Practice", offered=["F26"], soc_ingested=True)
    _, rows = _reconcile(tmp_path, soc, [stub])
    assert rows["62-318"]["offered"] == ["S26", "F26"]
