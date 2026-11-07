"""Unit tests for SOC scrape thresholds and HTML parsing.

The soc_psy_*.html fixtures are real SOC result pages for Psychology saved on
November 7, 2026 (F26 and S27 trimmed to a few rows):
  F26 PIT: fall layout, cancelled 85-103
  S27 PIT: "<br />: subtitle" on 85-310 and 85-716, cancelled 85-270 and 85-473
  S26 DOH: Qatar sections
  M26 PIT: summer layout with the extra "Session" column
"""
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DATA))

from scrape_soc import attach_offerings, parse_courses, parse_title_cell, scrape_threshold  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"

HEADER = (
    '<table><thead><tr>'
    '<th class="col-course">Course</th><th class="col-title">Course Title</th>'
    '<th class="col-units">Units</th><th class="col-section">Sec</th>'
    '<th class="col-mini">Mini</th><th class="col-days">Days</th>'
    '<th class="col-begin">Begin</th><th class="col-end">End</th>'
    '<th class="col-location">Teaching Location</th>'
    '<th class="col-deliverymode">Delivery Mode</th>'
    '</tr></thead><tbody>'
)


def _fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


def _parse_fixture(name):
    return {c["course_number"]: c for c in parse_courses(_fixture(name), "PSY", "Psychology")}


def _row(*values):
    return "<tr>" + "".join(f"<td>{v}</td>" for v in values) + "</tr>"


def _table(*rows):
    return HEADER + "".join(rows) + "</tbody></table>"


def test_summer_semester_uses_lower_threshold():
    assert scrape_threshold("M26") < scrape_threshold("F26")
    assert scrape_threshold("M25") < scrape_threshold("S26")


def test_fall_and_spring_share_default_threshold():
    assert scrape_threshold("F26") == scrape_threshold("S26")


def test_parse_courses_keeps_continuation_rows_for_same_section():
    """SOC lists extra meeting times on rows with a blank section cell."""
    html = _table(
        _row("21259", "Calculus in Three Dimensions", "10", "W", "", "MW", "10:00AM", "10:50AM", "Doha, Qatar", "In-person only"),
        _row("", "", "", "", "", "UT", "10:00AM", "11:15AM", "Doha, Qatar", "In-person only"),
    )
    courses = parse_courses(html, "MSC", "Mathematical Sciences")
    assert len(courses) == 1
    sections = courses[0]["sections"]
    assert len(sections) == 2
    assert sections[0]["section"] == "W"
    assert sections[0]["days"] == "MW"
    assert sections[1]["section"] == "W"
    assert sections[1]["days"] == "UT"


def test_parse_courses_still_adds_section_only_rows():
    html = _table(_row("15122", "Principles of Imperative Computation", "10", "A", "", "", "", "", "Doha, Qatar", "In-person only"))
    courses = parse_courses(html, "CS", "Computer Science")
    assert len(courses[0]["sections"]) == 1
    assert courses[0]["sections"][0]["section"] == "A"


def test_parse_courses_skips_tables_without_header():
    """Without a header the columns are unknown, so nothing is guessed."""
    html = "<table>" + _row("15122", "Principles of Imperative Computation", "10", "A", "", "", "", "", "Doha, Qatar", "In-person only") + "</table>"
    assert parse_courses(html, "CS", "Computer Science") == []


def test_summer_session_column_does_not_shift_cells():
    """M26 pages have 11 columns; each course keeps its own row."""
    courses = _parse_fixture("soc_psy_M26_PIT.html")
    assert list(courses) == ["85150", "85251", "85450", "85482", "85506", "85781", "85798"]
    social = courses["85150"]
    assert social["title"] == "Social Psychology"
    assert social["units"] == "9"
    assert len(social["sections"]) == 1
    sec = social["sections"][0]
    assert sec["section"] == "A6"
    assert sec["session"] == "summer"
    assert sec["mini"] == "Y"
    assert (sec["days"], sec["begin_time"], sec["end_time"]) == ("MTWRF", "12:30PM", "01:50PM")
    assert sec["location"] == "Pittsburgh, Pennsylvania"
    assert sec["delivery_mode"] == "In-person Expectation"
    assert courses["85450"]["title"] == "Psychology of Prejudice"
    assert courses["85482"]["units"] == "3-12"
    for course in courses.values():
        assert len(course["sections"]) == 1
        assert course["units"] != "summer"


def test_fall_page_columns_and_no_session_field():
    courses = _parse_fixture("soc_psy_F26_PIT.html")
    assert len(courses) == 7
    intro = courses["85100"]
    assert intro["title"] == "Introduction to Psychology"
    assert intro["units"] == "9"
    assert intro["sections"][0]["section"] == "Lec 1"
    assert "session" not in intro["sections"][0]
    assert courses["85030"]["sections"][0]["days"] == "TBA"


def test_qatar_page_parses_doha_sections():
    courses = _parse_fixture("soc_psy_S26_DOH.html")
    assert list(courses) == ["85110", "85150", "85310", "85413", "85458", "85506"]
    sleep = courses["85458"]
    assert sleep["title"] == "Psychology of Sleep"
    sec = sleep["sections"][0]
    assert (sec["section"], sec["days"], sec["location"]) == ("W", "UT", "Doha, Qatar")


def test_cancelled_section_is_flagged_and_note_stripped_from_title():
    courses = _parse_fixture("soc_psy_F26_PIT.html")
    minds = courses["85103"]
    assert minds["title"] == "Possible Minds: Exploring Intelligence in Science Fiction"
    assert minds["sections"][0]["section"] == "A"
    assert minds["sections"][0]["cancelled"] is True
    assert "cancelled" not in courses["85105"]["sections"][0]
    for course in courses.values():
        assert "Cancelled" not in course["title"]

    s27 = _parse_fixture("soc_psy_S27_PIT.html")
    assert s27["85270"]["title"] == "Computational Approaches for Neuroscience Questions"
    assert s27["85270"]["sections"][0]["cancelled"] is True
    assert s27["85473"]["title"] == "Biologically Intelligent Exploration"
    assert s27["85473"]["sections"][0]["cancelled"] is True


def test_subtitle_goes_to_section_title():
    courses = _parse_fixture("soc_psy_S27_PIT.html")
    methods = courses["85310"]
    assert methods["title"] == "Research Methods in Cognitive Psychology"
    assert methods["sections"][0]["section_title"] == "Rearch Methods in Cognitive Psychology"
    comm = courses["85716"]
    assert comm["title"] == "Graduate Research Communication"
    assert comm["sections"][0]["section_title"] == "research presentation"
    assert "section_title" not in courses["85110"]["sections"][0]


def test_parse_title_cell_variants():
    assert parse_title_cell(" Perception ") == ("Perception", "", False)
    assert parse_title_cell(
        'Proseminar <div class="cancelled"><small>This Section Cancelled</small></div>'
    ) == ("Proseminar", "", True)
    assert parse_title_cell("Topics <br />: Film &amp; Media") == ("Topics", "Film & Media", False)
    assert parse_title_cell("<br />: Only a subtitle") == ("", "Only a subtitle", False)


def test_continuation_row_inherits_cancelled_and_section_title():
    html = _table(
        _row("21259", 'Calculus <br />: Honors <div class="cancelled"><small>This Section Cancelled</small></div>',
             "10", '<div class="cancelled">W</div>', "", "MW", "10:00AM", "10:50AM", "Doha, Qatar", "In-person only"),
        _row("", "", "", "", "", "UT", "10:00AM", "11:15AM", "Doha, Qatar", "In-person only"),
        _row("", "", "", "X", "", "TR", "09:00AM", "09:50AM", "Doha, Qatar", "In-person only"),
    )
    course = parse_courses(html, "MSC", "Mathematical Sciences")[0]
    assert course["title"] == "Calculus"
    first, cont, other = course["sections"]
    assert first["cancelled"] is True and first["section_title"] == "Honors"
    assert cont["section"] == "W" and cont["cancelled"] is True and cont["section_title"] == "Honors"
    assert other["section"] == "X" and "cancelled" not in other and "section_title" not in other


def test_attach_offerings_skips_cancelled_sections():
    courses = _parse_fixture("soc_psy_F26_PIT.html")
    for course in courses.values():
        for sec in course["sections"]:
            sec["campus"] = "Pittsburgh"
        course["campus"] = ["Pittsburgh"]
        attach_offerings(course, "F26")

    minds = courses["85103"]
    assert minds["offerings"] == []
    assert minds["campus"] == []
    assert minds["cancelled"] is True
    assert minds["sections"][0]["cancelled"] is True

    hack = courses["85105"]
    assert len(hack["offerings"]) == 1
    assert hack["offerings"][0]["campus"] == "Pittsburgh"
    assert hack["campus"] == ["Pittsburgh"]
    assert "cancelled" not in hack
    assert hack["semester"] == "Fall 2026"


def test_attach_offerings_drops_campus_with_only_cancelled_sections():
    course = {
        "course_number": "85110",
        "title": "Cognitive Psychology",
        "units": "9",
        "campus": ["Qatar", "Pittsburgh"],
        "sections": [
            {"section": "W", "location": "Doha, Qatar", "campus": "Qatar", "cancelled": True},
            {"section": "A", "location": "Pittsburgh, Pennsylvania", "campus": "Pittsburgh"},
        ],
    }
    attach_offerings(course, "S27")
    assert course["campus"] == ["Pittsburgh"]
    assert [o["section"] for o in course["offerings"]] == ["A"]
    assert "cancelled" not in course
