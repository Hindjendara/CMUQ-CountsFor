"""Reconcile title rules and the coverage validator's renumbering checks."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "data"))

import validate_soc_coverage as vsc  # noqa: E402
from reconcile_offerings import offerings_from_soc, reconcile_file  # noqa: E402


def section(campus="Pittsburgh", **extra):
    loc = "Doha, Qatar" if campus == "Qatar" else "Pittsburgh, Pennsylvania"
    return {"section": "A", "days": "MW", "begin_time": "10:00AM", "end_time": "11:20AM",
            "location": loc, "delivery_mode": "In Person", "campus": campus, **extra}


def soc_course(num, title, units="9", dept="Psychology", sections=None):
    return {"course_number": num, "title": title, "units": units, "department": dept,
            "sections": sections if sections is not None else [section()]}


def catalog_row(code, name, reqs=None, **extra):
    row = {
        "course_code": code, "course_name": name, "units": 9, "offered": ["S20"],
        "offered_qatar": False, "offered_pitts": False,
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
        "offerings": [], "soc_sections": [], "description": "", "prerequisites": "",
    }
    if reqs:
        row["requirements"].update(reqs)
    row.update(extra)
    return row


def run_reconcile(tmp_path, soc, courses):
    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps({"_meta": {}, "courses": courses}), encoding="utf-8")
    stats = reconcile_file(str(courses_path), str(soc_path))
    rows = json.loads(courses_path.read_text(encoding="utf-8"))["courses"]
    return stats, {r["course_code"]: r for r in rows}, rows


# ── reconcile_offerings ──────────────────────────────────────

def test_newest_semester_title_units_and_department_win():
    soc = {"semesters": {
        "F25": {"courses": [soc_course("85770", "Foundations and Frontiers in Brain and Behavior", "12", "Old Dept")]},
        "S27": {"courses": [soc_course("85770", "Frontiers in Brain and Behavior", "9", "Psychology")]},
        "S26": {"courses": [soc_course("85770", "Middle Title", "6", "Middle Dept")]},
    }}
    _, meta = offerings_from_soc(soc)
    assert meta["85-770"] == {"title": "Frontiers in Brain and Behavior", "units": "9", "department": "Psychology"}


def test_older_semester_fills_only_missing_values():
    soc = {"semesters": {
        "S27": {"courses": [soc_course("85372", "tba This Section Cancelled", "VAR")]},
        "F25": {"courses": [soc_course("85372", "Real Title", "9")]},
    }}
    _, meta = offerings_from_soc(soc)
    assert meta["85-372"]["title"] == "Real Title"
    assert meta["85-372"]["units"] == "9"


def test_course_name_follows_cleaned_soc_title(tmp_path):
    soc = {"semesters": {"S27": {"courses": [
        soc_course("85490", "Clinical Psychology Science and Practice"),
        soc_course("85401", "Psychology of Aging This Section Cancelled"),
        soc_course("85310", "Research Methods in Cognitive Psychology : Rearch Methods in Cognitive Psychology"),
    ]}}}
    courses = [
        catalog_row("85-490", "Clincial Science and Practice"),
        catalog_row("85-401", "Psychology of Aging This Section Cancelled"),
        catalog_row("85-310", "Research Methods in Cognitive Psychology"),
    ]
    stats, rows, _ = run_reconcile(tmp_path, soc, courses)
    assert rows["85-490"]["course_name"] == "Clinical Psychology Science and Practice"
    assert rows["85-401"]["course_name"] == "Psychology of Aging"
    assert rows["85-310"]["course_name"] == "Research Methods in Cognitive Psychology"
    assert stats["titles_changed"] == 2
    # Titles that still match are not reported as reused numbers.
    assert stats["reused_numbers"] == []
    assert all("previous_course_name" not in r for r in rows.values())


def test_uncleanable_soc_title_keeps_catalog_name(tmp_path):
    soc = {"semesters": {"S26": {"courses": [soc_course("85372", "tba This Section Cancelled")]}}}
    stats, rows, _ = run_reconcile(tmp_path, soc, [catalog_row("85-372", "Special Topics")])
    assert rows["85-372"]["course_name"] == "Special Topics"
    assert stats["titles_changed"] == 0


def test_reused_number_is_flagged_and_keeps_mappings(tmp_path):
    reqs = {"BA": [{"requirement": "BA---X", "type": True, "major": "BA"}]}
    soc = {"semesters": {"F26": {"courses": [soc_course("76322", "Arranged Marriage", "3")]}}}
    stats, rows, _ = run_reconcile(
        tmp_path, soc, [catalog_row("76-322", "Gender and Sexuality in Performance", reqs)]
    )
    row = rows["76-322"]
    assert row["course_name"] == "Arranged Marriage"
    assert row["previous_course_name"] == "Gender and Sexuality in Performance"
    assert row["requirements"]["BA"] == reqs["BA"]
    assert stats["reused_numbers"] == ["76-322: Gender and Sexuality in Performance -> Arranged Marriage"]


def test_compact_catalog_code_is_not_added_twice(tmp_path):
    soc = {"semesters": {"F26": {"courses": [soc_course("85211", "Cognitive Psychology")]}}}
    stats, rows, all_rows = run_reconcile(tmp_path, soc, [catalog_row("85211", "Cognitive Psychology")])
    assert [r["course_code"] for r in all_rows] == ["85-211"]
    assert stats["courses_added"] == 0


def test_soc_ingested_offered_follows_offerings(tmp_path):
    soc = {"semesters": {
        "S26": {"courses": [soc_course("85110", "Cognitive Psychology", sections=[section("Qatar")])]},
        "F26": {"courses": [soc_course("85110", "Cognitive Psychology")]},
        "S27": {"courses": [soc_course("85110", "Cognitive Psychology", sections=[section(cancelled=True)])]},
    }}
    stub = catalog_row("85-110", "Cognitive Psychology", offered=["F26", "S27"], soc_ingested=True)
    old = catalog_row("85-211", "Cognitive Psychology", offered=["S25"])
    _, rows, _ = run_reconcile(tmp_path, soc, [stub, old])
    assert rows["85-110"]["offered"] == ["S26", "F26"]
    assert rows["85-211"]["offered"] == ["S25"], "catalog rows keep their history"


def test_new_stub_uses_cleaned_title(tmp_path):
    soc = {"semesters": {"S27": {"courses": [soc_course("85716", "Graduate Research Communication : research presentation")]}}}
    _, rows, _ = run_reconcile(tmp_path, soc, [])
    assert rows["85-716"]["course_name"] == "Graduate Research Communication"
    assert rows["85-716"]["offered"] == ["S27"]


# ── validate_soc_coverage ────────────────────────────────────

def run_validator(tmp_path, monkeypatch, soc, courses, overlays=None):
    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    overlays_path = tmp_path / "overlays.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps({"courses": courses}), encoding="utf-8")
    overlays_path.write_text(json.dumps(overlays or {}), encoding="utf-8")
    monkeypatch.setattr(vsc, "SOC_PATH", str(soc_path))
    monkeypatch.setattr(vsc, "COURSES_PATH", str(courses_path))
    monkeypatch.setattr(vsc, "OVERLAYS_PATH", str(overlays_path))
    return vsc.main()


def test_validator_accepts_superseded_rows(tmp_path, monkeypatch, capsys):
    soc = {"semesters": {
        "M25": {"courses": [soc_course("85211", "Cognitive Psychology")]},
        "F26": {"courses": [soc_course("85110", "Cognitive Psychology")]},
    }}
    courses = [
        catalog_row("85-211", "Cognitive Psychology", superseded_by="85-110"),
        catalog_row("85-110", "Cognitive Psychology", previous_codes=["85-211"]),
    ]
    assert run_validator(tmp_path, monkeypatch, soc, courses) == 0
    assert "OK: every SOC course" in capsys.readouterr().out


def test_previous_codes_count_as_covered():
    courses = [catalog_row("85-190", "Psychopathology", previous_codes=["85-104"])]
    assert vsc.catalog_codes(courses) == {"85-190", "85-104"}


def test_validator_warns_about_unlinked_same_title_pairs(tmp_path, monkeypatch, capsys):
    soc = {"semesters": {"S27": {"courses": [
        soc_course("85190", "Psychopathology"),
        soc_course("85110", "Cognitive Psychology"),
        soc_course("85452", "Attitudes and Persuasion"),
        soc_course("85852", "Attitudes and Persuasion"),
        soc_course("76190", "Psychopathology", dept="English"),
    ]}}}
    courses = [
        catalog_row("85-190", "Psychopathology"),
        catalog_row("85-253", "Psychopathology"),
        catalog_row("85-261", "Psychopathology This Section Cancelled"),
        catalog_row("85-110", "Cognitive Psychology"),
        catalog_row("85-211", "Cognitive Psychology"),
        catalog_row("85-452", "Attitudes and Persuasion"),
        catalog_row("85-852", "Attitudes and Persuasion"),
        catalog_row("85-377", "Attitudes and Persuasion", superseded_by="85-452"),
        catalog_row("76-190", "Psychopathology"),
    ]
    overlays = {"renumbered": [{"old": "85-211", "current": "85-110"}]}
    assert run_validator(tmp_path, monkeypatch, soc, courses, overlays) == 0
    out = capsys.readouterr().out
    assert "WARNING: 2 same-title pair(s)" in out
    assert "[85] 85-253 (not in SOC) / 85-190 (in SOC): Psychopathology" in out
    assert "[85] 85-261 (not in SOC) / 85-190 (in SOC): Psychopathology" in out
    assert "85-211" not in out.split("WARNING")[1], "a linked pair is not reported"
    assert "85-377" not in out, "a superseded row already has its successor"
    assert "76-190" not in out.split("WARNING")[1], "pairs are within one department"


def test_validator_prints_no_warning_without_pairs(tmp_path, monkeypatch, capsys):
    soc = {"semesters": {"S27": {"courses": [soc_course("85190", "Psychopathology")]}}}
    assert run_validator(tmp_path, monkeypatch, soc, [catalog_row("85-190", "Psychopathology")]) == 0
    assert "WARNING" not in capsys.readouterr().out
