"""Sections of backend/data/mapping_overlays.json: overlays, remove_mappings, qatar_visibility.

Small synthetic catalogs check each section, the order they run in and that a
second run changes nothing. The last tests check the real overlay file against
frontend/data/courses.json. The rule_buckets section has its own tests in
test_rule_buckets.py.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

import apply_mapping_overlays as amo  # noqa: E402
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON  # noqa: E402
from psychology_renumbering import load_renumbering  # noqa: E402
from apply_mapping_overlays import (  # noqa: E402
    OverlayError,
    apply_file,
    apply_overlay_document,
)

SR = "GenEd---University Core---Scientific Reasoning"
NT = "GenEd---Nontechnical Breadth Requirements---E. Nontechnical Elective Courses"
HA = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
SS = "GenEd---Disciplinary Perspectives---Social Sciences"
IEG = (
    "BS in Biological Sciences---Biological Sciences---Biological Sciences Electives"
    "---Interdisciplinary Electives Group"
)


def req(major, path, gened=True):
    return {"requirement": path, "type": gened, "major": major}


def course(code, name="Course", reqs=None, **extra):
    row = {
        "course_code": code,
        "course_name": name,
        "description": "",
        "prerequisites": "",
        "offerings": [],
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
    }
    for r in reqs or []:
        row["requirements"][r["major"]].append(dict(r))
    row.update(extra)
    return row


def by_code(courses):
    return {c["course_code"]: c for c in courses}


def req_keys(row, major=None):
    out = set()
    for m, reqs in row["requirements"].items():
        if major and m != major:
            continue
        out.update((r["major"], r["requirement"], r["type"]) for r in reqs)
    return out


def catalog():
    return [
        course("85-110", "Cognitive Psychology", [req("CS", HA), req("IS", SS)]),
        course("85-170", "Foundations of Brain and Behavior", [req("BS", IEG, False)]),
        course("85-414", "Cognition in the Age of AI", [req("BA", SR), req("BS", NT)]),
        course("85-100", "Introduction to Psychology", [req("CS", HA)]),
    ]


# ── remove_mappings and ordering ─────────────────────────────

def test_remove_mappings_by_program_and_all():
    courses = catalog()
    doc = {"remove_mappings": [
        {"course_code": "85-414", "programs": ["BA"]},
        {"course_code": "85-100", "programs": "all"},
    ]}
    stats = apply_overlay_document(courses, doc)
    rows = by_code(courses)
    assert req_keys(rows["85-414"]) == {("BS", NT, True)}
    assert req_keys(rows["85-100"]) == set()
    assert set(rows["85-100"]["requirements"]) == {"CS", "IS", "BA", "BS"}
    assert stats["mappings_removed"] == 2


def test_removing_the_ai_rows_leaves_no_empty_ai_list():
    courses = catalog()
    rows = by_code(courses)
    rows["85-110"]["requirements"]["AI"] = [req("AI", HA)]
    rows["85-170"]["requirements"]["AI"] = []
    doc = {"remove_mappings": [{"course_code": "85-110", "programs": ["AI"]},
                               {"course_code": "85-170", "programs": "all"}]}
    stats = apply_overlay_document(courses, doc)
    assert set(rows["85-110"]["requirements"]) == {"CS", "IS", "BA", "BS"}
    assert req_keys(rows["85-110"]) == {("CS", HA, True), ("IS", SS, True)}
    assert set(rows["85-170"]["requirements"]) == {"CS", "IS", "BA", "BS"}
    assert stats["mappings_removed"] == 2


def test_remove_mappings_wins_over_overlays():
    courses = catalog()
    doc = {
        "overlays": [{
            "id": "sheet", "course_codes": ["85-110", "85-414"], "create_missing": False,
            "requirements": {"BA": [req("BA", SR)], "BS": [req("BS", NT)]},
        }],
        "remove_mappings": [
            {"course_code": "85-110", "programs": ["BA"]},
            {"course_code": "85-414", "programs": "all"},
        ],
    }
    apply_overlay_document(courses, doc)
    rows = by_code(courses)
    assert req_keys(rows["85-110"], "BA") == set()
    assert req_keys(rows["85-110"]) == {("CS", HA, True), ("IS", SS, True), ("BS", NT, True)}
    assert req_keys(rows["85-414"]) == set()


def test_remove_mappings_rejects_unknown_program():
    with pytest.raises(OverlayError):
        apply_overlay_document(catalog(), {"remove_mappings": [{"course_code": "85-414", "programs": ["XX"]}]})


def test_invalid_file_fails_without_saving(tmp_path, monkeypatch, capsys):
    path = tmp_path / "courses.json"
    original = json.dumps({"courses": catalog()})
    path.write_text(original, encoding="utf-8")
    overlays = tmp_path / "overlays.json"
    overlays.write_text(json.dumps({"remove_mappings": [{"course_code": "85-414", "programs": ["XX"]}]}),
                        encoding="utf-8")
    monkeypatch.setattr(amo, "OVERLAYS_PATH", overlays)
    monkeypatch.setenv("CATALOG_PATHS", str(path))
    assert amo.main() == 1
    assert "catalog not saved" in capsys.readouterr().out
    assert path.read_text(encoding="utf-8") == original


# ── qatar_visibility ─────────────────────────────────────────

def test_qatar_visibility_sets_and_clears_flag():
    courses = catalog()
    doc = {"qatar_visibility": [{"course_code": "85-100", "rule": "show_only_if_offered_qatar"}]}
    stats = apply_overlay_document(courses, doc)
    assert by_code(courses)["85-100"]["qatar_only"] is True
    assert stats["visibility_flags"] == 1
    assert not any(c.get("qatar_only") for c in courses if c["course_code"] != "85-100")
    apply_overlay_document(courses, {})
    assert "qatar_only" not in by_code(courses)["85-100"]


def test_qatar_visibility_rejects_unknown_rule():
    with pytest.raises(OverlayError):
        apply_overlay_document(catalog(), {"qatar_visibility": [{"course_code": "85-100", "rule": "hide"}]})


# ── additive overlay options ─────────────────────────────────

def test_create_missing_false_does_not_create_course():
    courses = catalog()
    stats = apply_overlay_document(courses, {"overlays": [{
        "id": "hss-sheet-85-459", "course_codes": ["85-459"], "create_missing": False,
        "requirements": {"BA": [req("BA", SR)]},
    }]})
    assert "85-459" not in by_code(courses)
    assert stats["overlay_codes_missing"] == ["hss-sheet-85-459: 85-459"]


def test_ensure_course_defaults_codes_limits_defaults():
    courses = [course("82-101", offered_qatar=False), course("76-386", offered_qatar=False)]
    apply_overlay_document(courses, {"overlays": [{
        "id": "igi", "course_codes": ["82-101", "76-386", "82-999"],
        "requirements": {"IS": [req("IS", "GenEd---Foundations---Intercultural and Global Inquiry")]},
        "ensure_course_defaults": {"department": "82", "offered_qatar": True},
        "ensure_course_defaults_codes": ["82-101", "82-999"],
    }]})
    rows = by_code(courses)
    assert rows["82-101"]["offered_qatar"] is True
    assert rows["76-386"]["offered_qatar"] is False
    assert rows["82-999"]["manual_seed"] is True  # created: it is a defaults code
    assert all(len(r["requirements"]["IS"]) == 1 for r in rows.values())


# ── idempotence ──────────────────────────────────────────────

def full_doc():
    return {
        "overlays": [{
            "id": "sheet", "course_codes": ["85-110", "85-414"], "create_missing": False,
            "requirements": {"BS": [req("BS", NT)]},
        }],
        "remove_mappings": [{"course_code": "85-414", "programs": "all"}],
        "qatar_visibility": [{"course_code": "85-100", "rule": "show_only_if_offered_qatar"}],
    }


def test_second_run_changes_nothing():
    courses = catalog()
    apply_overlay_document(courses, full_doc())
    once = copy.deepcopy(courses)
    stats = apply_overlay_document(courses, full_doc())
    assert courses == once
    assert stats["requirements_added"] == 0
    assert stats["mappings_removed"] == 0


def test_apply_file_twice_gives_identical_file(tmp_path):
    path = tmp_path / "courses.json"
    path.write_text(json.dumps({"_meta": {}, "courses": catalog()}), encoding="utf-8")
    apply_file(path, full_doc())
    first = path.read_bytes()
    apply_file(path, full_doc())
    assert path.read_bytes() == first


# ── the real overlay file ────────────────────────────────────

OVERLAY_DOC = json.loads(MAPPING_OVERLAYS_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def real_courses():
    data = json.loads(COURSES_JSON.read_text(encoding="utf-8"))
    return data["courses"] if isinstance(data, dict) else data


def test_overlay_paths_exist_in_catalog(real_courses):
    known = set()
    for c in real_courses:
        for major, reqs in (c.get("requirements") or {}).items():
            for r in reqs or []:
                known.add((major, r["requirement"], bool(r.get("type"))))
    missing = []
    for overlay in OVERLAY_DOC["overlays"]:
        for major, reqs in overlay["requirements"].items():
            for r in reqs:
                assert r["major"] == major, overlay["id"]
                if (major, r["requirement"], r["type"]) not in known:
                    missing.append(f"{overlay['id']}: {major} {r['requirement']} type={r['type']}")
    assert not missing, missing


def test_overlay_file_lists_only_settled_entries():
    assert set(OVERLAY_DOC) == {"description", "overlays", "rule_buckets", "remove_mappings",
                                "qatar_visibility", "catalog_buckets"}
    assert set(OVERLAY_DOC["catalog_buckets"]) == {"CS", "IS", "BA", "BS", "AI"}
    removals = {e["course_code"]: e["programs"] for e in OVERLAY_DOC["remove_mappings"]}
    # 85-414 needs no entry since the renumbering migration: its old course's rows are 85-472's.
    # 03-351 is cross-listed with 02-262: the SCS Science and Engineering rule rules it out,
    # and AI keeps only what its own lists state (its CS, BA and BS rows stay).
    assert removals == {"85-426": "all", "03-351": ["AI"]}
    assert [(e["course_code"], e["rule"]) for e in OVERLAY_DOC["qatar_visibility"]] == [
        ("85-100", "show_only_if_offered_qatar"),
    ]
    sheet = [o for o in OVERLAY_DOC["overlays"] if o["id"].startswith("hss-sheet-")]
    codes = [c for o in sheet for c in o["course_codes"]]
    # The sheet lists Personality as 85-251, which the renumbering list makes 85-151.
    assert sorted(codes) == sorted([
        "85-170", "85-364", "85-413", "85-130", "85-150", "85-310", "85-300",
        "85-452", "85-190", "85-110", "85-151", "85-450",
    ])
    assert all(o["id"] == f"hss-sheet-{o['course_codes'][0]}" for o in sheet)
    assert all(o["create_missing"] is False for o in sheet)
    assert all(o["note"] == "H&SS Course Offerings sheet (Qatar), approved 2026-11-07" for o in sheet)


def test_real_overlay_merge_result(real_courses):
    courses = copy.deepcopy(real_courses)
    stats = apply_overlay_document(courses, OVERLAY_DOC)
    rows = by_code(courses)
    assert stats["overlay_codes_missing"] == []
    assert stats["courses_created"] == 0
    # 85-459 Emotion and Motivation, a new CMU-Q course, has its row from the renumbering list.
    assert rows["85-459"]["source"] == "Psychology renumbering list"

    def leaves(code):
        return {(m, r["requirement"].split("---")[-1], r["type"])
                for m, reqs in rows[code]["requirements"].items() for r in reqs}

    # 85-190 has the sheet's IS Social Sciences and the mappings moved from its old numbers.
    assert leaves("85-190") == {
        ("IS", "Social Sciences", True),
        ("CS", "Category 1: Cognition, Choice and Behavior", True),
        ("CS", "C. Humanities and Arts Electives", True),
        ("BA", "Scientific Reasoning", True),
        ("BS", "E. Nontechnical Elective Courses", True),
        ("AI", "C. Humanities and Arts Electives", True),
    }
    assert leaves("85-170") == {
        ("CS", "Science and Engineering", True),
        ("IS", "Scientific Inquiry", True),
        ("BA", "Scientific Reasoning", True),
        ("BS", "Interdisciplinary Electives Group", False),
        ("BS", "And TWO (2) or THREE (3) of the following for a total of FIVE (5) courses", False),
        ("BS", "A. Life Sciences", True),
        ("BS", "D. STEM Course", True),
        ("AI", "Science and Engineering", True),
    }
    # 85-414 is Cognition in the Age of AI now: its old course's rows are 85-472's, and
    # only the 2026-27 rules give it rows (its remove_mappings entry is gone). 85-426
    # keeps none: remove_mappings wins over every rule.
    assert leaves("85-414") == {
        ("BA", "Scientific Reasoning", True),
        ("BS", "E. Nontechnical Elective Courses", True),
    }
    assert all(r.get("source") == "rule" for reqs in rows["85-414"]["requirements"].values() for r in reqs)
    assert leaves("85-426") == set()
    assert "AI" not in rows["03-351"]["requirements"] and rows["03-351"]["requirements"]["CS"]
    assert leaves("85-151") == {
        ("CS", "Category 1: Cognition, Choice and Behavior", True),
        ("CS", "C. Humanities and Arts Electives", True),
        ("BA", "Scientific Reasoning", True),
        ("BS", "E. Nontechnical Elective Courses", True),
        ("AI", "C. Humanities and Arts Electives", True),
    }
    assert rows["85-100"]["qatar_only"] is True


# Removed on 2026-11-09 and not on the department's renumbering list.
OLD_PSYCHOPATHOLOGY_NUMBERS = {"85-253": "85-190", "85-261": "85-190"}


def test_old_psychology_numbers_stay_removed(real_courses):
    ren = load_renumbering()
    codes = {c["course_code"] for c in real_courses}
    assert not codes & (set(ren.retired) | set(OLD_PSYCHOPATHOLOGY_NUMBERS))
    assert set(ren.new_codes) | set(OLD_PSYCHOPATHOLOGY_NUMBERS.values()) <= codes
    rows = by_code(real_courses)
    for current in ("85-454", "85-411", "85-151", "85-418"):
        assert any(rows[current]["requirements"][m] for m in ("CS", "IS", "BA", "BS")), current
    # 85-104 (Psychopathology until Fall 2025, now 85-190) is reused for a new course: none
    # of Psychopathology's rows stay, only the rows the 2026-27 rules give the new course.
    assert rows["85-104"]["course_name"] == "Psychology and Society - Inside Out Program"
    assert all(r.get("source") == "rule" for reqs in rows["85-104"]["requirements"].values() for r in reqs)
