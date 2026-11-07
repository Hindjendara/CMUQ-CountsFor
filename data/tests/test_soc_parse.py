"""Unit tests for SOC campus and modality parsing."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from soc_parse import (  # noqa: E402
    apply_campus_fix,
    normalize_modality,
    parse_campus_from_location,
    expected_campus_for_course,
)


def test_82289_fixture_is_qatar():
    assert expected_campus_for_course("82289") == "Qatar"
    assert apply_campus_fix("82289", "Tutoring for Community Outreach - CMUQ", "Pittsburgh") == "Qatar"


def test_doha_location_is_qatar():
    assert parse_campus_from_location("Doha, Qatar") == "Qatar"


def test_pittsburgh_location():
    assert parse_campus_from_location("Pittsburgh, Pennsylvania") == "Pittsburgh"


def test_prg_location_fallback():
    assert parse_campus_from_location("Unknown Location", "Qatar") == "Qatar"


def test_modality_remote_only():
    assert normalize_modality("Remote only") == "Remote"


def test_modality_hybrid():
    assert normalize_modality("In-person + remote") == "Hybrid"


def test_modality_in_person():
    assert normalize_modality("In-person Expectation") == "In Person"


def test_normalize_course_code_compact_and_float():
    from soc_parse import normalize_course_code

    assert normalize_course_code("82101") == "82-101"
    assert normalize_course_code("82101.0") == "82-101"
    assert normalize_course_code("82-101") == "82-101"


def test_course_number_to_code_uses_normalizer():
    from soc_parse import course_number_to_code

    assert course_number_to_code("82101.0") == "82-101"


def test_titles_match_same_course():
    from soc_parse import titles_match

    assert titles_match("Arranged Marriage", "Arranged Marriage")
    assert titles_match("Topics in Rhetoric: Language", "Topics in Rhetoric: Language")


def test_titles_mismatch_reused_number():
    from soc_parse import titles_match

    assert not titles_match(
        "Gender and Sexuality in Performance",
        "Arranged Marriage",
    )


def test_parse_soc_units_variants():
    from soc_parse import parse_soc_units

    assert parse_soc_units("10") == 10
    assert parse_soc_units("12.0") == 12
    assert parse_soc_units("9.00") == 9
    assert parse_soc_units("1-3") == 1
    assert parse_soc_units("var") is None
    assert parse_soc_units("") is None


def test_titles_match_soc_subtitle_suffix():
    from soc_parse import titles_match

    assert titles_match(
        "Biology for Life Special Topics Micro",
        "Biology for Life Special Topics Micro : Understanding the Demented and Delusional Brain",
    )
    assert titles_match(
        "Special Topics: Nanotechnology in Context",
        "Special Topics: Nanotechnology in Context : Nanotechnology in Context",
    )


def test_department_list_parses_soc_form():
    from soc_departments import parse_department_list

    html = """
    <select name="DEPT">
      <option value="All">All Departments</option>
      <option value="BUS">Business Administration (70XXX)</option>
      <option value="S3D">Software & Societal Systems (17XXX)</option>
    </select>
    """
    depts = parse_department_list(html)
    assert depts == [("BUS", "Business Administration"), ("S3D", "Software & Societal Systems")]


def test_semester_list_parses_soc_form():
    from soc_departments import parse_semester_list

    html = """
    <select name="SEMESTER" class="form-control">
      <option value="F26">Fall 2026</option>
      <option value="M26">Summer 2026</option>
      <option value="S26">Spring 2026</option>
    </select>
    """
    sems = parse_semester_list(html)
    assert sems == [("F26", "Fall 2026"), ("M26", "Summer 2026"), ("S26", "Spring 2026")]


def test_clean_soc_title_strips_cancelled_note():
    from soc_parse import clean_soc_title

    assert clean_soc_title("Psychology of Aging This Section Cancelled") == "Psychology of Aging"
    assert clean_soc_title("Proseminar  This Section Cancelled ") == "Proseminar"


def test_clean_soc_title_strips_subtitle_and_tba():
    from soc_parse import clean_soc_title

    assert clean_soc_title(
        "Research Methods in Cognitive Psychology : Rearch Methods in Cognitive Psychology"
    ) == "Research Methods in Cognitive Psychology"
    assert clean_soc_title("M.Arch Studio: Praxis II : Praxis 2:") == "M.Arch Studio: Praxis II"
    assert clean_soc_title(
        "Domains in dialogue: Interactions shaping child development : TBAThis Section Cancelled"
    ) == "Domains in dialogue: Interactions shaping child development"
    assert clean_soc_title("Production Prep SOM: TBA : Directing") == "Production Prep SOM"
    assert clean_soc_title("Production Prep: TBA 5 : Directing") == "Production Prep: TBA 5"
    assert clean_soc_title("Graduate Research Communication :") == "Graduate Research Communication"


def test_clean_soc_title_keeps_clean_titles():
    from soc_parse import clean_soc_title

    assert clean_soc_title("Cognition in the Age of AI") == "Cognition in the Age of AI"
    assert clean_soc_title("Influence: From Social Media to IRL") == "Influence: From Social Media to IRL"


def test_clean_soc_title_never_returns_empty_or_tba():
    from soc_parse import clean_soc_title

    for raw in (None, "", "   ", "TBA", "tba", ": TBA", " : TBA", "This Section Cancelled", ": Directing"):
        assert clean_soc_title(raw) is None, raw


def test_build_offering_marks_cancelled_section():
    from soc_parse import build_offering, is_cancelled_course

    live = {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh"}
    dead = dict(live, section="B", cancelled=True)
    assert "cancelled" not in build_offering(semester_code="F26", section=live)
    assert build_offering(semester_code="F26", section=dead)["cancelled"] is True
    assert is_cancelled_course({"sections": [dead]})
    assert not is_cancelled_course({"sections": [dead, live]})
    assert not is_cancelled_course({"sections": []})


def _soc_with_sections(*courses):
    return {"semesters": {"S27": {"courses": list(courses)}}}


def test_reconcile_ignores_cancelled_sections_for_offerings_and_flags():
    from reconcile_offerings import campus_flags_from_offerings, offerings_from_soc

    soc = _soc_with_sections(
        {
            "course_number": "85110",
            "title": "Cognitive Psychology",
            "units": "9",
            "sections": [
                {"section": "W", "location": "Doha, Qatar", "campus": "Qatar", "cancelled": True},
                {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh"},
            ],
        },
        {
            "course_number": "85270",
            "title": "Computational Approaches for Neuroscience Questions",
            "units": "9",
            "sections": [
                {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh", "cancelled": True},
            ],
        },
    )
    by_code, meta = offerings_from_soc(soc)
    assert [o["section"] for o in by_code["85-110"]] == ["A"]
    assert campus_flags_from_offerings(by_code["85-110"]) == (False, True)
    assert "85-270" not in by_code
    assert meta["85-270"]["title"] == "Computational Approaches for Neuroscience Questions"
    assert campus_flags_from_offerings([{"campus": "Qatar", "cancelled": True}]) == (False, False)


def test_reconcile_file_with_cancelled_qatar_section(tmp_path):
    import json

    from reconcile_offerings import reconcile_file
    from validate_soc_coverage import soc_course_codes

    soc = _soc_with_sections(
        {
            "course_number": "85110",
            "title": "Cognitive Psychology",
            "units": "9",
            "sections": [
                {"section": "W", "location": "Doha, Qatar", "campus": "Qatar", "cancelled": True},
                {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh"},
            ],
        },
        {
            "course_number": "85270",
            "title": "Computational Approaches for Neuroscience Questions",
            "units": "9",
            "sections": [
                {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh", "cancelled": True},
            ],
        },
    )
    courses = [
        {
            "course_code": "85-110",
            "course_name": "Cognitive Psychology",
            "units": 9,
            "offered": [],
            "offered_qatar": True,
            "offered_pitts": False,
            "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
            "offerings": [],
            "soc_sections": [],
        }
    ]
    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps(courses), encoding="utf-8")

    stats = reconcile_file(str(courses_path), str(soc_path))
    updated = json.loads(courses_path.read_text(encoding="utf-8"))

    assert stats["courses_added"] == 0
    assert [c["course_code"] for c in updated] == ["85-110"]
    cog = updated[0]
    assert cog["offered_qatar"] is False
    assert cog["offered_pitts"] is True
    assert [o["section"] for o in cog["offerings"]] == ["A"]
    # The validator does not require a catalog row for an all-cancelled course.
    assert soc_course_codes(soc) == {"S27": {"85-110"}}


def test_reconcile_from_real_cancelled_fixture(tmp_path):
    """Parse the saved F26 page, then reconcile: 85-103 is cancelled."""
    import json

    from reconcile_offerings import reconcile_file
    from scrape_soc import attach_offerings, parse_courses

    html = (Path(__file__).resolve().parent / "fixtures" / "soc_psy_F26_PIT.html").read_text(
        encoding="utf-8", errors="replace"
    )
    parsed = parse_courses(html, "PSY", "Psychology")
    for course in parsed:
        for sec in course["sections"]:
            sec["campus"] = "Pittsburgh"
        attach_offerings(course, "F26")
    soc = {"semesters": {"F26": {"courses": parsed}}}
    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps({"courses": []}), encoding="utf-8")

    reconcile_file(str(courses_path), str(soc_path))
    by_code = {c["course_code"]: c for c in json.loads(courses_path.read_text(encoding="utf-8"))["courses"]}

    assert "85-103" not in by_code
    assert by_code["85-105"]["course_name"] == "Hack Your Life"
    assert by_code["85-105"]["offered"] == ["F26"]
    assert by_code["85-105"]["offered_pitts"] is True
