"""Sections of data/mapping_overlays.json: renumbered, remove_mappings, qatar_visibility.

Small synthetic catalogs check each section, the order they run in and that a
second run changes nothing. The last tests check the real overlay file against
data/courses.json.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "data"))

import apply_mapping_overlays as amo  # noqa: E402
from apply_mapping_overlays import (  # noqa: E402
    OverlayError,
    apply_file,
    apply_overlay_document,
)

SR = "EY2022 Qatar Business Administration - University Core Requirements---Scientific Reasoning"
NT = "GenEd---Non-Technical Breadth Electives"
HA = "GenEd---Humanities/Arts Electives"
SS = "GenEd---GenEd---Disciplinary Perspectives---Social Sciences"
IEG = (
    "BS in Biological Sciences---Biological Sciences---Biological Sciences Electives"
    "---Biological Sciences Electives---Interdisciplinary Electives Group"
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
        course(
            "85-211", "Cognitive Psychology",
            [req("CS", HA), req("BA", SR), req("IS", SS)],
            description="Old description", prerequisites="None",
        ),
        course("85-110", "Cognitive Psychology", [req("CS", HA)]),
        course("85-219", "Foundations of Brain and Behavior", [req("BS", IEG, False)],
               description="Brain course"),
        course("85-170", "Foundations of Brain and Behavior", description="Kept"),
        course("85-414", "Cognition in the Age of AI", [req("BA", SR), req("BS", NT)]),
        course("85-100", "Introduction to Psychology", [req("CS", HA)]),
    ]


# ── renumbered ───────────────────────────────────────────────

def test_renumbered_copies_rows_and_links_codes():
    courses = catalog()
    doc = {"renumbered": [
        {"old": "85-211", "current": "85-110"},
        {"old": "85-219", "current": "85-170"},
    ]}
    stats = apply_overlay_document(courses, doc)
    rows = by_code(courses)

    assert req_keys(rows["85-110"]) == {("CS", HA, True), ("BA", SR, True), ("IS", SS, True)}
    # Copied verbatim, the core (type false) flag included.
    assert rows["85-170"]["requirements"]["BS"] == [req("BS", IEG, False)]
    assert rows["85-110"]["description"] == "Old description"
    assert rows["85-110"]["prerequisites"] == "None"
    assert rows["85-170"]["description"] == "Kept", "a non-empty description is not replaced"
    assert rows["85-110"]["previous_codes"] == ["85-211"]
    assert rows["85-211"]["superseded_by"] == "85-110"
    # The retired row stays, with its own mappings.
    assert req_keys(rows["85-211"]) == {("CS", HA, True), ("BA", SR, True), ("IS", SS, True)}
    assert stats["renumbered_linked"] == 2
    assert stats["requirements_copied"] == 3  # CS HA was already on 85-110


def test_renumbered_missing_old_code_warns_and_skips(capsys, tmp_path, monkeypatch):
    courses = catalog()
    doc = {"renumbered": [{"old": "85-151", "current": "85-110"}]}
    stats = apply_overlay_document(courses, doc)
    assert stats["renumbered_old_missing"] == ["85-151 -> 85-110"]
    assert stats["renumbered_linked"] == 0
    assert "previous_codes" not in by_code(courses)["85-110"]

    path = tmp_path / "courses.json"
    path.write_text(json.dumps({"courses": catalog()}), encoding="utf-8")
    overlays = tmp_path / "overlays.json"
    overlays.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(amo, "OVERLAYS_PATH", overlays)
    monkeypatch.setattr(amo, "DEFAULT_CATALOGS", [path])
    monkeypatch.delenv("CATALOG_PATHS", raising=False)
    amo.main()
    out = capsys.readouterr().out
    assert "WARNING renumbered: old code not in the catalog, skipped: 85-151 -> 85-110" in out


def test_renumbered_missing_current_code_fails_without_saving(tmp_path, monkeypatch, capsys):
    path = tmp_path / "courses.json"
    original = json.dumps({"courses": catalog()})
    path.write_text(original, encoding="utf-8")
    doc = {"renumbered": [{"old": "85-211", "current": "85-999"}]}

    with pytest.raises(OverlayError, match="85-999"):
        apply_file(path, doc)
    assert path.read_text(encoding="utf-8") == original

    overlays = tmp_path / "overlays.json"
    overlays.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(amo, "OVERLAYS_PATH", overlays)
    monkeypatch.setenv("CATALOG_PATHS", str(path))
    assert amo.main() == 1
    assert "85-999" in capsys.readouterr().out
    assert path.read_text(encoding="utf-8") == original


@pytest.mark.parametrize("entries", [
    [{"old": "85-211", "current": "85-211"}],
    [{"old": "85-211", "current": "85-110"}, {"old": "85-211", "current": "85-170"}],
    [{"old": "85-211", "current": "85-110"}, {"old": "85-110", "current": "85-170"}],
    [{"old": "85-211"}],
])
def test_renumbered_rejects_bad_entries(entries):
    with pytest.raises(OverlayError):
        apply_overlay_document(catalog(), {"renumbered": entries})


def test_renumbered_links_are_owned_by_the_file():
    courses = catalog()
    apply_overlay_document(courses, {"renumbered": [{"old": "85-211", "current": "85-110"}]})
    apply_overlay_document(courses, {"renumbered": []})
    rows = by_code(courses)
    assert "superseded_by" not in rows["85-211"]
    assert "previous_codes" not in rows["85-110"]


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


def test_remove_mappings_wins_over_overlays_and_renumbering():
    courses = catalog()
    doc = {
        "renumbered": [{"old": "85-211", "current": "85-110"}],
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
    # The retired row keeps its BA mapping: only the current code is listed.
    assert ("BA", SR, True) in req_keys(rows["85-211"])


def test_renumbering_never_copies_into_removed_programs():
    courses = catalog()
    stats = apply_overlay_document(courses, {
        "renumbered": [{"old": "85-211", "current": "85-110"}],
        "remove_mappings": [{"course_code": "85-110", "programs": ["IS", "BA"]}],
    })
    assert stats["requirements_copied"] == 0
    assert stats["mappings_removed"] == 0


def test_remove_mappings_rejects_unknown_program():
    with pytest.raises(OverlayError):
        apply_overlay_document(catalog(), {"remove_mappings": [{"course_code": "85-414", "programs": ["XX"]}]})


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
        "requirements": {"IS": [req("IS", "GenEd---GenEd---Foundations---Intercultural and Global Inquiry")]},
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
        "renumbered": [
            {"old": "85-211", "current": "85-110"},
            {"old": "85-219", "current": "85-170"},
            {"old": "85-151", "current": "85-110"},
        ],
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
    assert stats["requirements_copied"] == 0
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

OVERLAY_DOC = json.loads((ROOT / "data" / "mapping_overlays.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def real_courses():
    data = json.loads((ROOT / "data" / "courses.json").read_text(encoding="utf-8"))
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
    pairs = {(e["old"], e["current"]) for e in OVERLAY_DOC["renumbered"]}
    assert pairs == {
        ("85-211", "85-110"), ("85-219", "85-170"), ("85-221", "85-130"),
        ("85-241", "85-150"), ("85-377", "85-452"), ("85-104", "85-190"),
    }
    removals = {e["course_code"]: e["programs"] for e in OVERLAY_DOC["remove_mappings"]}
    assert removals == {"85-414": "all", "85-426": "all"}
    assert [(e["course_code"], e["rule"]) for e in OVERLAY_DOC["qatar_visibility"]] == [
        ("85-100", "show_only_if_offered_qatar"),
    ]
    sheet = [o for o in OVERLAY_DOC["overlays"] if o["id"].startswith("hss-sheet-")]
    codes = [c for o in sheet for c in o["course_codes"]]
    assert sorted(codes) == sorted([
        "85-170", "85-364", "85-413", "85-130", "85-150", "85-310", "85-300",
        "85-452", "85-190", "85-110", "85-251", "85-450",
    ])
    assert all(o["create_missing"] is False for o in sheet)
    assert all(o["note"] == "H&SS Course Offerings sheet (Qatar), approved 2026-11-07" for o in sheet)


def test_real_overlay_merge_result(real_courses):
    courses = copy.deepcopy(real_courses)
    stats = apply_overlay_document(courses, OVERLAY_DOC)
    rows = by_code(courses)
    assert stats["renumbered_old_missing"] == []
    assert stats["overlay_codes_missing"] == []
    assert "85-459" not in rows

    def leaves(code):
        return {(m, r["requirement"].split("---")[-1], r["type"])
                for m, reqs in rows[code]["requirements"].items() for r in reqs}

    # 85-190 gets the sheet's IS Social Sciences and keeps 85-104's mappings.
    assert leaves("85-190") == {
        ("IS", "Social Sciences", True),
        ("CS", "Cognition, Choice, and Behavior (CS, CB, & HCI)", True),
        ("CS", "Humanities/Arts Electives", True),
        ("BA", "Scientific Reasoning", True),
        ("BS", "Non-Technical Breadth Electives", True),
    }
    assert leaves("85-170") == {
        ("IS", "Scientific Inquiry", True),
        ("BA", "Scientific Reasoning", True),
        ("BS", "Interdisciplinary Electives Group", False),
        ("BS", "Any ONE of the following courses", False),
    }
    assert leaves("85-414") == set()
    assert leaves("85-426") == set()
    for old in ("85-211", "85-219", "85-221", "85-241", "85-377", "85-104"):
        assert rows[old].get("superseded_by"), old
    for kept in ("85-253", "85-261"):
        assert "superseded_by" not in rows[kept]
    assert rows["85-100"]["qatar_only"] is True
