"""The Psychology renumbering list: its file, the daily step and the one-time migration.

The file tests check backend/data/psychology_renumbering.json itself. The daily
step tests run reconcile, the overlay step and the coverage validator on small
fixtures: a reused number (85-370, old Perception, now Cognitive Neuroscience
Research Methods) and a retired old number the SOC lists again (85-102, now
85-100). The migration tests use a small provenance catalog in the old paths.
The last tests check the committed catalog.
"""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

import migrate_psychology_numbers as mpn  # noqa: E402
import validate_soc_coverage as vsc  # noqa: E402
from apply_mapping_overlays import OverlayError, apply_file, apply_overlay_document, include_note  # noqa: E402
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON, PSYCHOLOGY_RENUMBERING_JSON, ROOT  # noqa: E402
from psychology_renumbering import (  # noqa: E402
    SOURCE_LABEL,
    Renumbering,
    RenumberingError,
    apply_renumbering,
    code_now,
    covered_by_new_number,
    history_before,
    load_renumbering,
    retired_codes_named,
)
from reconcile_offerings import reconcile_file  # noqa: E402

CAT1 = "GenEd---Humanities and Arts---B. Breadth Requirement---Category 1: Cognition, Choice and Behavior"
CAT1A = "GenEd---Humanities and Arts---B. Breadth Requirement---Category 1A: Cognitive Studies"
HAC = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
SE = "GenEd---Science and Engineering"
LAB = "GenEd---Science and Engineering---Laboratory Requirement"
SR = "GenEd---University Core---Scientific Reasoning"
NTE = "GenEd---Nontechnical Breadth Requirements---E. Nontechnical Elective Courses"
SS = "GenEd---Disciplinary Perspectives---Social Sciences"

# The same buckets in the old (79e29ec) paths, as the old audits named them.
OLD_CAT1 = "GenEd---Category 1: Cognition---Cognition, Choice, and Behavior (CS, CB, & HCI)"
OLD_COG_AI = "GenEd---Category 1: Cognition---Cognitive Studies (AI)"
OLD_HAC = "GenEd---Humanities/Arts Electives"
OLD_SR = "EY2022 Qatar Business Administration - University Core Requirements---Scientific Reasoning"
OLD_NTB = "GenEd---Non-Technical Breadth Electives"
OLD_SS = "GenEd---GenEd---Disciplinary Perspectives---Social Sciences"
RENAMES = json.loads(mpn.RENAMES_JSON.read_text(encoding="utf-8"))

REAL_DOC = json.loads(PSYCHOLOGY_RENUMBERING_JSON.read_text(encoding="utf-8"))
REAL = Renumbering(REAL_DOC)


def entry(old, new, title, units=9):
    return {"Old Course #": old, "New Course #": new, "Long Title": title, "Units": units}


def small_list():
    """Reused 85-370, retired 85-314, 85-102 and 85-294, discontinued 85-426, new 85-459."""
    return {"source": "test list", "courses": [
        entry("85-102", "85-100", "Introduction to Psychology"),
        entry("85-294", "85-501", "Teaching Assistantship", "VAR"),
        entry("85-314", "85-370", "Cognitive Neuroscience Research Methods"),
        entry("85-370", "85-413", "Perception"),
        entry("85-426", "x", "Learning in Humans and Machines"),
        entry("CMUQ", "85-459", "Emotion and Motivation", None),
    ]}


def req(major, path, **extra):
    return {"requirement": path, "type": path.startswith("GenEd"), "major": major, **extra}


def row(code, name, reqs=(), **extra):
    out = {
        "course_code": code, "course_name": name, "department": "85", "units": 9,
        "description": "", "prerequisites": "", "offered": [], "offered_qatar": False,
        "offered_pitts": False, "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
        "offerings": [],
    }
    for r in reqs:
        out["requirements"].setdefault(r["major"], []).append(dict(r))
    out.update(extra)
    return out


def keys(course, with_source=False):
    out = set()
    for program, reqs in course["requirements"].items():
        for r in reqs:
            k = (program, r["requirement"])
            out.add(k + (r.get("source"),) if with_source else k)
    return out


def plain_rows(courses):
    """True when every requirement row is {requirement, type, major}, plus "source" on a rule row."""
    return all(set(r) <= {"requirement", "type", "major", "source"}
               for c in courses for reqs in c["requirements"].values() for r in reqs)


def by_code(courses):
    return {c["course_code"]: c for c in courses}


def section(campus="Pittsburgh"):
    loc = "Doha, Qatar" if campus == "Qatar" else "Pittsburgh, Pennsylvania"
    return {"section": "A", "days": "MW", "begin_time": "10:00AM", "end_time": "11:20AM",
            "location": loc, "delivery_mode": "In Person", "campus": campus}


def soc_course(num, title):
    return {"course_number": num, "title": title, "units": "9", "department": "Psychology",
            "sections": [section()]}


# ---------- The file ----------

def test_file_holds_the_department_list_verbatim():
    assert set(REAL_DOC) == {"source", "courses"}
    assert REAL_DOC["source"].endswith("provided by the CountsFor maintainer on 2026-11-10")
    assert len(REAL_DOC["courses"]) == 93
    for e in REAL_DOC["courses"]:
        assert list(e) == ["Old Course #", "New Course #", "Long Title", "Units"], e
    assert REAL_DOC["courses"][0] == entry("85-101", "85-030", "Research Requirement", None)


def test_list_terms():
    assert sorted(REAL.reused) == ["85-104", "85-330", "85-350", "85-370", "85-409", "85-414",
                                   "85-418", "85-432"]
    for code in REAL.reused:  # old number of one course and new number of another
        assert REAL.new_number[code] not in (code, "x") and code in REAL.new_codes
    assert len(REAL.retired) == 38 and not set(REAL.retired) & set(REAL.new_codes)
    assert REAL.new_number["85-102"] == "85-100"
    assert REAL.new_number["85-414"] == "85-472" and REAL.old_number["85-414"] == "85-372"
    assert REAL.new_number["85-314"] == "85-370" and REAL.new_number["85-370"] == "85-413"
    assert REAL.new_number["85-350"] == "85-450" and REAL.old_number["85-350"] == "85-340"
    assert REAL.new_number["85-426"] == "x" and "85-426" in REAL.discontinued
    assert {c for c, o in REAL.old_number.items() if o is None} == {"85-458", "85-459", "85-473"}


@pytest.mark.parametrize("bad, message", [
    ({"courses": []}, "source"),
    ({"source": "s", "courses": [{"Old Course #": "85-101"}]}, "exactly the fields"),
    ({"source": "s", "courses": [entry("85-1010", "85-030", "T")]}, "Old Course #"),
    ({"source": "s", "courses": [entry("85-101", "X", "T")]}, "New Course #"),
    ({"source": "s", "courses": [entry("85-101", "85-030", "")]}, "Long Title"),
    ({"source": "s", "courses": [entry("85-101", "85-030", "T", "9")]}, "Units"),
    ({"source": "s", "courses": [entry("CMUQ", "x", "T")]}, "cannot be discontinued"),
    ({"source": "s", "courses": [entry("85-101", "85-030", "T"), entry("85-101", "85-031", "T")]},
     "listed twice"),
    ({"source": "s", "courses": [entry("85-101", "85-030", "T"), entry("85-102", "85-030", "T")]},
     "listed twice"),
])
def test_schema_errors(bad, message):
    with pytest.raises(RenumberingError, match=message):
        Renumbering(bad)


def test_history_before_fall_2025():
    assert history_before(["F25", "S24", "M25", "F20", "S24", "S27"]) == ["F20", "S24", "M25"]


# ---------- The daily step ----------

@pytest.fixture
def ren():
    return Renumbering(small_list())


@pytest.fixture
def catalog():
    """85-370 is the reused number; 85-314 and 85-102 are retired numbers with rows."""
    return [
        row("85-370", "Cognitive Neuropsychology Research Methods",
            [req("CS", SE), req("CS", CAT1), req("BA", SR), req("CS", HAC, source="rule")],
            description="Lab course."),
        row("85-413", "Perception", [req("CS", CAT1)]),
        row("85-314", "Cognitive Neuroscience Research Methods", [req("BA", SR), req("BS", NTE)],
            offered=["S21", "S25"]),
        row("85-100", "Introduction to Psychology", [req("BA", SR)], qatar_only=True),
        row("85-102", "Introduction to Psychology",
            [req("IS", SS), req("BA", SR), req("CS", CAT1), req("CS", HAC, source="rule")],
            description="The world is a crazy, confusing place.", offered=["S18", "M25"]),
        row("85-426", "Reverse Engineering Brains and Machines"),
        row("85-294", "Teaching Assistantship", [req("AI", HAC, source="rule")], offered=["S24", "F25"]),
    ]


def test_retired_number_moves_to_its_new_number_and_is_deleted(ren, catalog):
    stats = apply_renumbering(catalog, ren)
    rows = by_code(catalog)
    assert "85-102" not in rows and "85-314" not in rows and "85-294" not in rows
    assert stats["renumbering_removed"] == ["85-102", "85-294", "85-314"]
    # 85-102's rows are 85-100's now, as plain rows that count like the rest; the
    # rule row is left to the rule step.
    assert keys(rows["85-100"], True) == {("BA", SR, None), ("IS", SS, None), ("CS", CAT1, None)}
    assert plain_rows(catalog)
    assert rows["85-100"]["description"] == "The world is a crazy, confusing place."
    assert rows["85-100"]["qatar_only"] is True


def test_reused_number_is_never_deleted(ren, catalog):
    apply_renumbering(catalog, ren)
    rows = by_code(catalog)
    assert rows["85-370"]["course_name"] == "Cognitive Neuropsychology Research Methods"
    # The daily step only adds: 85-314's rows join, nothing leaves.
    assert keys(rows["85-370"]) == {("CS", SE), ("CS", CAT1), ("BA", SR), ("CS", HAC), ("BS", NTE)}
    assert rows["85-370"]["description"] == "Lab course."
    assert keys(rows["85-413"]) == {("CS", CAT1)}


def test_missing_new_number_rows_come_from_the_list(ren, catalog):
    stats = apply_renumbering(catalog, ren)
    rows = by_code(catalog)
    assert stats["renumbering_created"] == ["85-501", "85-459"]
    # The list gives 85-501 85-294's history before Fall 2025 (S24); deleting 85-294
    # gives it the rest of 85-294's offered semesters (F25).
    assert rows["85-501"] == {
        "course_code": "85-501", "course_name": "Teaching Assistantship", "department": "85",
        "units": 0, "description": "", "prerequisites": "", "offered": ["S24", "F25"],
        "offered_qatar": False, "offered_pitts": False,
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []}, 
        "offerings": [], "source": SOURCE_LABEL,
    }
    # 85-294 had only an AI rule row: it is not moved, and 85-501 gets no empty AI list.
    assert "AI" not in rows["85-501"]["requirements"]
    assert rows["85-459"]["course_name"] == "Emotion and Motivation" and rows["85-459"]["units"] == 0
    assert rows["85-459"]["offered"] == []
    assert keys(rows["85-426"]) == set()  # discontinued: kept as it is


def test_daily_step_twice_changes_nothing(ren, catalog):
    apply_renumbering(catalog, ren)
    once = copy.deepcopy(catalog)
    stats = apply_renumbering(catalog, ren)
    assert catalog == once
    assert stats == {"renumbering_created": [], "renumbering_removed": [], "renumbering_rows_moved": 0,
                     "renumbering_sections_moved": 0}


def offering(sem, sec, campus="Pittsburgh", days="MW 10:00AM-11:20AM", units="9"):
    return {"semester": sem, "semester_code": sem, "campus": campus, "section": sec, "modality": "in_person",
            "units": units, "days_times": days, "instructor": "", "location": "", "delivery_mode_raw": ""}


def sections(course):
    return [(o["semester_code"], o["campus"], o["section"], o["days_times"]) for o in course["offerings"]]


def test_a_retired_row_gives_its_sections_and_semesters_to_its_new_number(ren, catalog):
    """The SOC still lists 85-294 next to 85-501 (A in F25 and F26, and S26 under
    85-294 only): the sections the new number lacks join it, once each, newest
    semester first, each next to its own lecture; the campus flags and offered follow."""
    rows = by_code(catalog)
    rows["85-294"]["offerings"] = [offering("S26", "A"), offering("F25", "A"), offering("F25", "A", days="F 01:00PM-01:50PM"),
                                   offering("F25", "W", "Qatar")]
    rows["85-294"]["offered"] = ["S24", "F25", "S26"]
    target = row("85-501", "Teaching Assistantship", offered=["F25", "F26"], soc_ingested=True,
                 offerings=[offering("F26", "Lec 1"), offering("F26", "B"), offering("F25", "Lec 1"), offering("F25", "A")])
    catalog.append(target)
    stats = apply_renumbering(catalog, ren)
    assert stats["renumbering_sections_moved"] == 2  # S26 A and F25 W; 85-501 has F25 A already
    got = by_code(catalog)["85-501"]
    assert sections(got) == [
        ("F26", "Pittsburgh", "Lec 1", "MW 10:00AM-11:20AM"),
        ("F26", "Pittsburgh", "B", "MW 10:00AM-11:20AM"),
        ("S26", "Pittsburgh", "A", "MW 10:00AM-11:20AM"),
        ("F25", "Pittsburgh", "Lec 1", "MW 10:00AM-11:20AM"),
        ("F25", "Pittsburgh", "A", "MW 10:00AM-11:20AM"),
        ("F25", "Qatar", "W", "MW 10:00AM-11:20AM"),
    ]
    assert got["offered_qatar"] is True and got["offered_pitts"] is True
    assert "soc_sections" not in got
    assert got["offered"] == ["S24", "F25", "S26", "F26"]
    once = copy.deepcopy(catalog)
    apply_renumbering(catalog, ren)
    assert catalog == once


def test_merged_sections_keep_each_section_with_its_own_lecture():
    from psychology_renumbering import merge_offerings
    # A lone section of the old number must not join the new number's lecture.
    target = row("85-503", "Internship", offerings=[offering("M26", "Lec 1"), offering("M26", "A")])
    assert merge_offerings(target, {"offerings": [offering("M26", "I")]}) == 1
    assert [o["section"] for o in target["offerings"]] == ["I", "Lec 1", "A"]
    # The old number's lecture keeps its own sections after the new number's lone section.
    target = row("85-503", "Internship", offerings=[offering("M26", "B")])
    merge_offerings(target, {"offerings": [offering("M26", "Lec 2"), offering("M26", "C")]})
    assert [o["section"] for o in target["offerings"]] == ["B", "Lec 2", "C"]
    # Nothing new: nothing changes.
    before = copy.deepcopy(target)
    assert merge_offerings(target, {"offerings": [offering("M26", "C")]}) == 0
    assert target == before


def test_overlay_file_may_not_name_a_retired_number(ren, catalog):
    doc = {"overlays": [{"id": "sheet", "course_codes": ["85-102"], "create_missing": False,
                         "requirements": {"BA": [req("BA", SR)]}}],
           "qatar_visibility": [{"course_code": "85-294", "rule": "show_only_if_offered_qatar"}]}
    assert retired_codes_named(doc, ren) == ["sheet: 85-102 (now 85-100)",
                                             "qatar_visibility: 85-294 (now 85-501)"]
    before = copy.deepcopy(catalog)
    with pytest.raises(OverlayError, match="85-102"):
        apply_overlay_document(catalog, doc, ren)
    assert catalog == before


def test_a_rule_naming_a_retired_number_says_where_the_course_is(ren):
    # The 2026-27 SCS lists name 85-314 next to 85-370, its new number; the daily
    # step deletes the 85-314 row, so the rule's note points at 85-370.
    assert include_note("cs-science-engineering: 85-314", ren) == (
        "cs-science-engineering: 85-314 (a retired Psychology number, now 85-370)")
    assert include_note("cs-science-engineering: 19-440", ren) == "cs-science-engineering: 19-440"
    assert include_note("cs-science-engineering: 85-314") == "cs-science-engineering: 85-314"


def test_covered_by_new_number(ren):
    known = {"85-100", "85-370"}
    assert covered_by_new_number(["85-102", "85-294", "85-370", "85-999"], known, ren) == {"85-102": "85-100"}


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def test_pipeline_on_a_reappearing_old_number(tmp_path, monkeypatch, capsys, ren, catalog):
    """Reconcile creates 85-102 again because the SOC lists it; the overlay step
    moves it to 85-100; the validator counts it as covered; a second run gives
    the same bytes."""
    soc = {"metadata": {"last_scrape": "2026-11-07T00:00:00+00:00"}, "semesters": {
        "M25": {"scraped_at": "2026-11-01T00:00:00+00:00",
                "courses": [soc_course("85102", "Introduction to Psychology")]},
        "S27": {"scraped_at": "2026-11-07T00:00:00+00:00",
                "courses": [soc_course("85370", "Cognitive Neuropsychology Research Methods"),
                            soc_course("85413", "Perception"),
                            soc_course("85100", "Introduction to Psychology")]},
    }}
    courses = [c for c in catalog if c["course_code"] != "85-102"]
    soc_path, courses_path, list_path = tmp_path / "soc.json", tmp_path / "courses.json", tmp_path / "list.json"
    write(soc_path, soc)
    write(courses_path, {"_meta": {}, "courses": courses})
    write(list_path, small_list())
    monkeypatch.setenv("PSYCHOLOGY_RENUMBERING_PATH", str(list_path))
    monkeypatch.setattr(vsc, "SOC_PATH", str(soc_path))
    monkeypatch.setattr(vsc, "COURSES_PATH", str(courses_path))

    outputs = []
    for run in range(2):
        assert reconcile_file(str(courses_path), str(soc_path))["courses_added"] == 1  # 85-102 again
        stats = apply_file(courses_path, {}, load_renumbering())
        assert stats["renumbering_removed"] == (["85-102", "85-294", "85-314"] if run == 0 else ["85-102"])
        assert vsc.main() == 0
        outputs.append(courses_path.read_bytes())
    assert outputs[0] == outputs[1]
    out = capsys.readouterr().out
    assert "1 SOC course(s) under an old Psychology number count as their new number: 85-102 (85-100)" in out
    rows = by_code(json.loads(outputs[1])["courses"])
    assert "85-102" not in rows and "85-314" not in rows
    assert rows["85-100"]["offerings"] and rows["85-370"]["offerings"]


def test_validator_still_fails_when_the_new_number_has_no_row(tmp_path, monkeypatch, ren):
    soc = {"semesters": {"S27": {"courses": [soc_course("85102", "Introduction to Psychology")]}}}
    soc_path, courses_path, list_path = tmp_path / "soc.json", tmp_path / "courses.json", tmp_path / "list.json"
    write(soc_path, soc)
    write(courses_path, {"courses": [row("85-413", "Perception")]})
    write(list_path, small_list())
    monkeypatch.setenv("PSYCHOLOGY_RENUMBERING_PATH", str(list_path))
    monkeypatch.setattr(vsc, "SOC_PATH", str(soc_path))
    monkeypatch.setattr(vsc, "COURSES_PATH", str(courses_path))
    assert vsc.main() == 1


# ---------- code_now (minor files) ----------

def test_code_now_follows_the_course():
    assert code_now("85-251", REAL) == "85-151"  # retired: always the old course
    assert code_now("85-251", REAL, era="new") == "85-151"
    assert code_now("85-352", REAL) == "85-352"  # discontinued
    assert code_now("85-213", REAL) == "85-213"  # same number
    assert code_now("85-350", REAL, title="Psychology of Prejudice") == "85-450"
    assert code_now("85-104", REAL, era="old") == "85-190"
    assert code_now("85-414", REAL, title="Cognition in the Age of AI") == "85-414"
    assert code_now("85-370", REAL, title="Cognitive Neuropsychology Research Methods",
                    current_titles=["Cognitive Neuropsychology Research Methods"]) == "85-370"
    with pytest.raises(RenumberingError, match="85-370"):
        code_now("85-370", REAL)


# ---------- The migration ----------

def old_row(code, name, reqs):
    return {"course_code": code, "course_name": name,
            "requirements": {p: [{"requirement": path, "type": path.startswith("GenEd"), "major": p}
                                 for path in paths] for p, paths in reqs.items()}}


def provenance():
    """The old audit rows: 85-370 was Perception, 85-314 Cognitive Neuroscience Research Methods."""
    old = [
        old_row("85-370", "Perception", {"CS": [OLD_CAT1, OLD_COG_AI, OLD_HAC], "BA": [OLD_SR], "BS": [OLD_NTB]}),
        old_row("85-314", "Cognitive Neuroscience Research Methods", {"BA": [OLD_SR], "BS": [OLD_NTB]}),
        old_row("85-102", "Introduction to Psychology", {"CS": [OLD_CAT1, OLD_HAC], "IS": [OLD_SS], "BA": [OLD_SR]}),
    ]
    return mpn.provenance_rows(old, RENAMES, {"85-370", "85-314", "85-102", "85-413", "85-100"})


def migration_catalog():
    """As the 2026-27 bucket work left it: 85-370 still has Perception's rows (from
    the older audits) next to the rows the 2026-27 lists give it."""
    return [
        row("85-370", "Cognitive Neuropsychology Research Methods", [
            req("CS", CAT1), req("CS", HAC), req("CS", SE), req("CS", LAB), req("BA", SR), req("BS", NTE),
            req("AI", HAC), req("AI", SE), req("AI", CAT1A),
        ]),
        row("85-413", "Perception", [req("CS", CAT1), req("BA", SR)]),
        row("85-314", "Cognitive Neuroscience Research Methods", [req("BA", SR), req("BS", NTE), req("CS", SE)],
            offered=["S21", "S25"], description="Lab course."),
        row("85-100", "Introduction to Psychology", [req("CS", CAT1), req("CS", HAC), req("BA", SR)]),
        row("85-102", "Introduction to Psychology", [
            req("CS", CAT1), req("CS", HAC), req("IS", SS), req("BA", SR), req("AI", HAC)]),
    ]


MIGRATED = {
    "85-370": {("CS", SE), ("CS", LAB), ("BA", SR), ("BS", NTE), ("AI", SE)},
    "85-413": {("CS", CAT1), ("CS", HAC), ("BA", SR), ("BS", NTE), ("AI", HAC), ("AI", CAT1A)},
    "85-100": {("CS", CAT1), ("CS", HAC), ("IS", SS), ("BA", SR), ("AI", HAC)},
}


def test_migration_moves_rows_by_course(ren):
    courses = migration_catalog()
    log = mpn.migrate(courses, ren, provenance())
    rows = by_code(courses)
    for code, expected in MIGRATED.items():
        assert keys(rows[code]) == expected, code
    assert "85-314" not in rows and "85-102" not in rows
    assert rows["85-370"]["description"] == "Lab course."  # from 85-314: the same course
    assert rows["85-413"]["description"] == ""  # a reused number's text stays with its number
    assert {(p, path) for p, path, _ in log["reused"]["85-370"]["moved"]} == {
        ("CS", CAT1), ("CS", HAC), ("AI", HAC), ("AI", CAT1A)}
    # Moved rows are plain rows: they count like the rest.
    assert ("BA", SR, None) in keys(rows["85-100"], True)
    assert plain_rows(courses)
    assert log["created"] == ["85-501", "85-459"]
    assert rows["85-501"]["source"] == SOURCE_LABEL


def test_migration_twice_and_on_a_reshaped_catalog(ren):
    courses = migration_catalog()
    mpn.migrate(courses, ren, provenance())
    once = copy.deepcopy(courses)
    log = mpn.migrate(courses, ren, provenance())
    assert courses == once
    assert log["created"] == [] and log["removed"] == []

    # A catalog with rule rows (the rule step's): same rows, and rule rows stay
    # where they are.
    reshaped = migration_catalog()
    by_code(reshaped)["85-370"]["requirements"]["BS"].append(req("BS", "GenEd---Rule Bucket", source="rule"))
    mpn.migrate(reshaped, ren, provenance())
    rows = by_code(reshaped)
    assert keys(rows["85-370"]) == MIGRATED["85-370"] | {("BS", "GenEd---Rule Bucket")}
    assert keys(rows["85-413"]) == MIGRATED["85-413"]


def test_migration_stops_on_a_clash(ren):
    courses = migration_catalog()
    # 85-314 (the new course's old number) has a row that is also one of Perception's.
    by_code(courses)["85-314"]["requirements"]["CS"].append(req("CS", CAT1))
    with pytest.raises(mpn.MigrationError, match="85-370"):
        mpn.migrate(courses, ren, provenance())


def test_migration_needs_a_reconciled_catalog(ren):
    with pytest.raises(mpn.MigrationError, match="85-459"):
        mpn.migrate(migration_catalog(), ren, provenance(), soc_running={"85-459"})


def test_history_follows_the_course(ren):
    """Before Fall 2025 the history of 85-370 is Perception's (now 85-413) and the
    history of 85-314 is Cognitive Neuroscience Research Methods' (now 85-370)."""
    history = {"85-314": ["S21", "S25"], "85-370": ["F20", "F24"], "85-102": ["S18", "M25"]}
    courses = [
        row("85-370", "Cognitive Neuroscience Research Methods", offered=["F20", "F24", "F20", "S26"]),
        row("85-413", "Perception", offered=["F25", "S26"], soc_ingested=True),
        row("85-100", "Introduction to Psychology", offered=["F25"], soc_ingested=True),
        row("85-501", "Teaching Assistantship", offered=["S24", "F25"]),
    ]
    changed = mpn.correct_history(courses, ren, history, soc_held={"85-100": {"M25", "F25"}})
    rows = by_code(courses)
    assert rows["85-370"]["offered"] == ["S21", "S25", "S26"]  # a reused number: its own history is the old course's
    assert rows["85-413"]["offered"] == ["F20", "F24", "F25", "S26"]
    # On a row the SOC created, reconcile rebuilds the semesters soc.json holds: M25 stays out.
    assert rows["85-100"]["offered"] == ["S18", "F25"]
    assert rows["85-501"]["offered"] == ["S24", "F25"]  # no history to add: the list keeps its order
    assert sorted(changed) == ["85-100", "85-370", "85-413"]
    once = copy.deepcopy(courses)
    assert mpn.correct_history(courses, ren, history, soc_held={"85-100": {"M25", "F25"}}) == {}
    assert courses == once


def test_history_sources_name_the_old_numbers():
    sources = mpn.history_sources(REAL)
    assert sources["85-370"] == ["85-314"] and sources["85-413"] == ["85-370"]
    assert sources["85-100"] == ["85-102"] and sources["85-472"] == ["85-414"]
    assert sources["85-190"] == ["85-104", "85-253", "85-261"]  # with the 2026-11-09 merges
    assert "85-105" not in sources  # same number: its history is its own


def test_migration_dry_run_writes_nothing_and_apply_writes(tmp_path):
    catalog_path, prov_path, list_path = tmp_path / "courses.json", tmp_path / "prov.json", tmp_path / "list.json"
    write(catalog_path, {"_meta": {}, "courses": migration_catalog()})
    old = [old_row("85-370", "Perception", {"CS": [OLD_CAT1, OLD_COG_AI, OLD_HAC], "BA": [OLD_SR], "BS": [OLD_NTB]}),
           old_row("85-314", "Cognitive Neuroscience Research Methods", {"BA": [OLD_SR], "BS": [OLD_NTB]})]
    write(prov_path, {"courses": old})
    write(list_path, small_list())
    original = catalog_path.read_bytes()
    common = ["--catalog", str(catalog_path), "--provenance", str(prov_path), "--renumbering", str(list_path),
              "--soc", str(tmp_path / "none.json"), "--overlays", str(tmp_path / "none.json")]
    assert mpn.main(common + ["--report", str(tmp_path / "report.md")]) == 0
    assert catalog_path.read_bytes() == original
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "| 85-370 | 85-413 | Perception |" in report and "### 85-370" in report
    assert mpn.main(common + ["--apply"]) == 0
    rows = by_code(json.loads(catalog_path.read_text(encoding="utf-8"))["courses"])
    assert keys(rows["85-370"]) == MIGRATED["85-370"]
    applied = catalog_path.read_bytes()
    assert mpn.main(common + ["--apply"]) == 0
    assert catalog_path.read_bytes() == applied


# ---------- The committed data ----------

@pytest.fixture(scope="module")
def real_rows():
    data = json.loads(COURSES_JSON.read_text(encoding="utf-8"))
    return by_code(data["courses"] if isinstance(data, dict) else data)


def test_catalog_follows_the_list(real_rows):
    assert not set(REAL.retired) & set(real_rows)
    assert set(REAL.new_codes) <= set(real_rows)
    for code in REAL.new_codes:
        r = real_rows[code]
        if r.get("source") == SOURCE_LABEL:
            # A row from the list has no SOC sections of its own; 85-151 has the ones the
            # SOC lists under its old number 85-251.
            assert r["course_name"] == REAL.title[code], code
            assert not r["offerings"] or REAL.old_number[code] in REAL.retired, code
    assert real_rows["85-104"]["course_name"] == "Psychology and Society - Inside Out Program"
    # 85-151 Personality has 85-251's history, and the M26 section the SOC still lists under 85-251.
    assert real_rows["85-151"]["offered"] == ["F20", "F21", "M23", "S24", "M24", "M25", "M26"]
    assert [(o["semester_code"], o["section"]) for o in real_rows["85-151"]["offerings"]] == [("M26", "A6")]
    assert real_rows["85-100"]["qatar_only"] is True
    # 85-414's old course's rows are 85-472's; it has only the rows the rule step owns.
    assert {s for *_, s in keys(real_rows["85-414"], True)} == {"rule"}
    assert {("BA", SR), ("BS", NTE)} <= keys(real_rows["85-472"])
    assert keys(real_rows["85-426"]) == set()
    # A course has an AI list only when it has AI rows, also where the renumbering moved rows.
    assert not [c for c, r in real_rows.items() if "AI" in r["requirements"] and not r["requirements"]["AI"]]


def test_overlay_file_names_no_retired_number():
    doc = json.loads(MAPPING_OVERLAYS_JSON.read_text(encoding="utf-8"))
    assert retired_codes_named(doc, REAL) == []
    assert not {e["course_code"] for e in doc["remove_mappings"]} & set(REAL.reused)


def _git_has_provenance() -> bool:
    try:
        return subprocess.run(["git", "-C", str(ROOT), "cat-file", "-e",
                               f"{mpn.PROVENANCE_COMMIT}:{mpn.PROVENANCE_FILE}"],
                              capture_output=True).returncode == 0
    except OSError:
        return False


@pytest.fixture(scope="module")
def provenance_courses():
    return mpn.load_provenance(None)


@pytest.mark.skipif(not _git_has_provenance(), reason="needs the git history (commit 79e29ec)")
def test_migration_on_the_committed_catalog_changes_nothing(provenance_courses):
    data = json.loads(COURSES_JSON.read_text(encoding="utf-8"))
    courses = data["courses"]
    before = copy.deepcopy(courses)
    codes = set(REAL.new_number) | set(REAL.new_codes)
    prov = mpn.provenance_rows(provenance_courses, RENAMES, codes)
    history = mpn.provenance_history(provenance_courses, mpn.history_codes(REAL))
    soc = json.loads((ROOT / "backend" / "data" / "soc.json").read_text(encoding="utf-8"))
    log = mpn.migrate(courses, REAL, prov, history=history, soc_held=mpn.soc_held_semesters(soc, courses))
    assert courses == before
    assert log["created"] == [] and log["removed"] == [] and log["history"] == {}


@pytest.mark.skipif(not _git_has_provenance(), reason="needs the git history (commit 79e29ec)")
def test_committed_history_follows_the_course(real_rows, provenance_courses):
    """The offered history before Fall 2025 is the history of the course that has the number now."""
    old = mpn.provenance_history(provenance_courses, mpn.history_codes(REAL) | set(REAL.reused))

    def early(code):
        return history_before(real_rows[code]["offered"])

    assert early("85-370") == old["85-314"] == ["S21", "S22", "S23", "S24", "S25"]
    assert early("85-413") == old["85-370"] == ["F20", "F21", "F22", "F23", "F24"]  # Perception
    assert early("85-350") == old["85-340"] and early("85-414") == []
    assert set(old["85-350"]) - {"M25"} == set(early("85-450"))  # M25: soc.json holds it, 85-450 is a SOC row
    assert set(old["85-414"]) <= set(early("85-472"))
    assert set(old["85-102"]) <= set(early("85-100"))
    assert set(old["85-104"]) | set(old["85-253"]) | set(old["85-261"]) <= set(early("85-190"))
