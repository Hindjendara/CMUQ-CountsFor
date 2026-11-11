"""backend/migrate_override_paths.py: old whole-list course edits become changes in the new names."""
import io
import json
from pathlib import Path

import pytest

from backend.db import db
from backend.migrate_override_paths import (
    PRODUCTION_ONLY_CODES, BaselineError, check_baseline, load_catalog, load_renames, main,
    migrate_requirements, migrate_value, rename, run,
)
from backend.models import AdminAuditEvent, CourseOverride

REPO = Path(__file__).resolve().parents[2]
REAL_RENAMES = REPO / "backend" / "data" / "requirement_path_renames.json"
TODAY = REPO / "frontend" / "data" / "courses.json"
# Production's rows (79e29ec:data/courses.json) of the 24 Psychology numbers whose rows
# differ from the cleanup catalog of 2026-11-09 (174e856). The other two of the 26 below,
# 85-482 and 85-798, are only in the cleanup catalog (with no rows): no production rows.
PRODUCTION = Path(__file__).resolve().parent / "data" / "production_psychology_rows.json"
PSYCHOLOGY_CODES = (
    "85-104", "85-110", "85-130", "85-150", "85-170", "85-190", "85-211", "85-219", "85-221",
    "85-241", "85-253", "85-261", "85-300", "85-340", "85-359", "85-377", "85-411", "85-413",
    "85-414", "85-426", "85-442", "85-450", "85-452", "85-454", "85-482", "85-798",
)
# Production's editor sent every one of these lists on each save, empty ones included.
OLD_EDITOR_PROGRAMS = ("CS", "IS", "BA", "BS")

OLD_CORE = "BS in Computer Science---Computer Science"
NEW_CORE = "BS in Computer Science---Computer Science---Computer Science Core"
OLD_CALC = "BS in Computer Science---Mathematics and Probability---Calculus"
NEW_CALC = "BS in Computer Science---Mathematics---Calculus in Three Dimensions"
GENED = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
BA_OLD_CALC = "BS in Business Administration---Business Foundations---Mathematics---Calculus"
BA_NEW_CALC = "BS in Business Administration---Business Foundations---Mathematics---Calculus"
BA_SPECIAL = "BS in Business Administration---Business Foundations---Mathematics---Differential and Integral Calculus---21-111 & 21-112"


def _rows(program, *paths, earlier=False):
    out = []
    for p in paths:
        row = {"requirement": p, "type": p.startswith("GenEd"), "major": program}
        if earlier:
            row.update(earlier=True, earlier_reason="older degree version")
        out.append(row)
    return out


def _production_markers():
    """The old Psychology numbers only production's catalog has, so a test baseline passes the check."""
    return {code: {"CS": ["GenEd---Humanities/Arts Electives"]} for code in PRODUCTION_ONLY_CODES}


def _catalog(tmp_path, name, courses):
    path = tmp_path / name
    path.write_text(json.dumps({"courses": [
        {"course_code": code, "requirements": {p: _rows(p, *paths) for p, paths in reqs.items()}}
        for code, reqs in courses.items()
    ]}), encoding="utf-8")
    return path


def _files(tmp_path):
    renames = tmp_path / "renames.json"
    renames.write_text(json.dumps({
        "description": "test",
        "programs": {"CS": {OLD_CORE: NEW_CORE, OLD_CALC: NEW_CALC}},
        "per_course": {"note": "exceptions", "BA": {BA_OLD_CALC: {"21-112": BA_SPECIAL}}},
    }), encoding="utf-8")
    baseline = _catalog(tmp_path, "baseline.json", {
        **_production_markers(),
        "15-122": {"CS": [OLD_CORE], "IS": [GENED]},
        "21-112": {"BA": [BA_OLD_CALC]},
    })
    today = _catalog(tmp_path, "today.json", {
        "15-122": {"CS": [NEW_CORE], "IS": [GENED], "AI": []},
        "21-112": {"BA": [BA_SPECIAL]},
        "21-120": {"CS": [NEW_CALC]},
    })
    return renames, baseline, today


def _add(app, code, requirements, **kw):
    with app.app_context():
        db.session.add(CourseOverride(course_code=code, requirements=json.dumps(requirements), **kw))
        db.session.commit()


def _stored(app):
    with app.app_context():
        return {r.course_code: (json.loads(r.requirements) if r.requirements else None)
                for r in db.session.query(CourseOverride).all()}


def test_rename_uses_the_course_exception_first():
    programs = {"BA": {BA_OLD_CALC: BA_NEW_CALC}}
    per_course = {"BA": {BA_OLD_CALC: {"21-112": BA_SPECIAL}}}
    assert migrate_value("BA", "21-112", _rows("BA", BA_OLD_CALC), programs, per_course, None) == _rows("BA", BA_SPECIAL)
    assert migrate_value("BA", "21-111", _rows("BA", BA_OLD_CALC), programs, per_course, None) == _rows("BA", BA_NEW_CALC)


def test_dry_run_writes_nothing(app, tmp_path):
    renames, baseline, today = _files(tmp_path)
    _add(app, "15-122", {"CS": _rows("CS", OLD_CORE, OLD_CALC), "IS": _rows("IS", GENED)})
    out = io.StringIO()
    with app.app_context():
        summary = run(renames=renames, catalog=today, baseline=baseline, apply=False, out=out)
    assert summary == {"rows": 1, "changed": 1, "deleted": 0, "unknown_paths": 0}
    text = out.getvalue()
    # The report first says which database it reads (README 15.8: the scratch database rehearsal).
    assert text.splitlines()[0].startswith("Database target: sqlite")
    assert text.splitlines()[1] == f"Baseline: {baseline} ({len(_production_markers()) + 2} courses)"
    assert "CS: whole list of 2 -> add 1, remove 0" in text
    assert f"add     {NEW_CALC}" in text
    assert "IS: whole list of 1 -> back to the catalog" in text
    assert "Dry run: nothing was written." in text
    assert _stored(app)["15-122"]["CS"] == _rows("CS", OLD_CORE, OLD_CALC)


def test_apply_with_baseline_keeps_only_the_difference(app, tmp_path):
    renames, baseline, today = _files(tmp_path)
    # CS: the admin added Calculus (old name) and kept the core row; IS saved untouched;
    # an earlier flag is dropped; a change already in the new shape is left alone.
    _add(app, "15-122", {
        "CS": _rows("CS", OLD_CORE, OLD_CALC, earlier=True),
        "IS": _rows("IS", GENED),
        "AI": {"add": [], "remove": ["BS in Artificial Intelligence---Computer Science"]},
    }, fields=json.dumps({"units": 10}))
    # Saved untouched and nothing else edited: the row goes away.
    _add(app, "21-112", {"BA": _rows("BA", BA_OLD_CALC)})
    # An added course has no baseline rows: everything is an addition.
    _add(app, "76-999", {"IS": _rows("IS", GENED)}, is_new=True, fields=json.dumps({"course_code": "76-999", "course_name": "New"}))
    with app.app_context():
        summary = run(renames=renames, catalog=today, baseline=baseline, apply=True, out=io.StringIO())
    assert summary["rows"] == 3 and summary["changed"] == 3 and summary["deleted"] == 1
    stored = _stored(app)
    assert stored["15-122"] == {
        "CS": {"add": _rows("CS", NEW_CALC), "remove": []},
        "AI": {"add": [], "remove": ["BS in Artificial Intelligence---Computer Science"]},
    }
    assert "21-112" not in stored
    assert stored["76-999"] == {"IS": {"add": _rows("IS", GENED), "remove": []}}
    with app.app_context():
        events = db.session.query(AdminAuditEvent).filter_by(action="course.migrate").order_by(AdminAuditEvent.target).all()
        assert [e.target for e in events] == ["15-122", "21-112", "76-999"]
        assert events[0].actor_email == "system: migrate_override_paths"
        details = json.loads(events[1].details)
        assert details["before"] == {"BA": _rows("BA", BA_OLD_CALC)} and details["after"] is None and details["deleted"]
    # A second run finds nothing left to do.
    with app.app_context():
        assert run(renames=renames, catalog=today, baseline=baseline, apply=True, out=io.StringIO())["rows"] == 0


def test_without_baseline_renames_in_place_and_reports_unknown_paths(app, tmp_path):
    renames, _baseline, today = _files(tmp_path)
    _add(app, "15-122", {"CS": _rows("CS", OLD_CORE, NEW_CORE, "BS in Computer Science---Typo Bucket", earlier=True)})
    out = io.StringIO()
    with app.app_context():
        summary = run(renames=renames, catalog=today, baseline=None, apply=True, out=out)
    assert summary["unknown_paths"] == 1
    assert "not in today's catalog: CS BS in Computer Science---Typo Bucket" in out.getvalue()
    assert _stored(app)["15-122"] == {"CS": _rows("CS", NEW_CORE, "BS in Computer Science---Typo Bucket")}


def test_command_line_is_a_dry_run_by_default(app, tmp_path, monkeypatch, capsys):
    renames, baseline, today = _files(tmp_path)
    _add(app, "15-122", {"CS": _rows("CS", OLD_CORE)})
    monkeypatch.setattr("backend.app.create_app", lambda **kw: app)
    assert main(["--renames", str(renames), "--catalog", str(today), "--baseline", str(baseline)]) == 0
    assert "Dry run" in capsys.readouterr().out
    assert _stored(app)["15-122"] == {"CS": _rows("CS", OLD_CORE)}


# ── Production's Psychology edits (README 15.8 step 8) ──────

def _production_rows():
    """{code: {program: [rows]}} as production's catalog has them (the fixture)."""
    data = json.loads(PRODUCTION.read_text(encoding="utf-8"))
    return {c["course_code"]: c["requirements"] for c in data["courses"]}


def _saved(rows_by_program):
    """What production's editor stored: the whole list of every program, empty ones included."""
    return {p: [dict(r) for r in rows_by_program.get(p) or []] for p in OLD_EDITOR_PROGRAMS}


def _new_row(program, path):
    return {"requirement": path, "type": path.startswith("GenEd---"), "major": program}


def _renamed(program, code, rows, programs, per_course):
    return list(dict.fromkeys(rename(program, r["requirement"], code, programs, per_course) for r in rows))


def _old_path_to_add(program, code, rows, programs, per_course):
    """An old path of the program whose new name the course does not have yet (what an admin added)."""
    have = set(_renamed(program, code, rows, programs, per_course))
    return next(old for old in programs[program] if rename(program, old, code, programs, per_course) not in have)


def test_production_edits_on_the_26_psychology_numbers_keep_only_the_admins_change():
    """Against production's catalog, a save on any of the 26 numbers converts to exactly what the admin changed.

    The cleanup catalog of 2026-11-09 gives these numbers other rows (the old numbers' rows moved to
    the new ones), so as a baseline it turned an edit on 85-150 into removals of rows the admin never saw.
    """
    programs, per_course = load_renames(REAL_RENAMES)
    baseline = load_catalog(PRODUCTION)
    production = _production_rows()
    assert sorted(set(production) | {"85-482", "85-798"}) == sorted(PSYCHOLOGY_CODES)

    # The case from the review: 85-150 had no rows in production; the admin added one BA row.
    saved = _saved({"BA": [{"requirement": "EY2022 Qatar Business Administration - University Core "
                                           "Requirements---Scientific Reasoning", "type": True, "major": "BA"}]})
    assert migrate_requirements("85-150", saved, programs, per_course, baseline) == {
        "BA": {"add": [_new_row("BA", "GenEd---University Core---Scientific Reasoning")], "remove": []},
    }

    checked = 0
    for code in PSYCHOLOGY_CODES:
        rows = production.get(code, {})
        # Saved without a change to what it counts for: every program follows the catalog again.
        assert migrate_requirements(code, _saved(rows), programs, per_course, baseline) == {}, code
        for program in OLD_EDITOR_PROGRAMS:
            own = rows.get(program) or []
            # The admin added one category to this program.
            old = _old_path_to_add(program, code, own, programs, per_course)
            added = dict(rows, **{program: own + [{"requirement": old, "type": True, "major": program}]})
            assert migrate_requirements(code, _saved(added), programs, per_course, baseline) == {
                program: {"add": [_new_row(program, rename(program, old, code, programs, per_course))], "remove": []},
            }, (code, program)
            checked += 1
            if own:
                # The admin removed every category of this program.
                cleared = dict(rows, **{program: []})
                assert migrate_requirements(code, _saved(cleared), programs, per_course, baseline) == {
                    program: {"add": [], "remove": _renamed(program, code, own, programs, per_course)},
                }, (code, program)
                checked += 1
    assert checked > 26 * 4


def test_production_psychology_edits_end_to_end(app):
    """One saved edit per Psychology number, converted against production's catalog and written."""
    programs, per_course = load_renames(REAL_RENAMES)
    production = _production_rows()
    expected = {}
    for code in PSYCHOLOGY_CODES:
        rows = production.get(code, {})
        own = rows.get("BA") or []
        old = _old_path_to_add("BA", code, own, programs, per_course)
        saved = _saved(dict(rows, BA=own + [{"requirement": old, "type": True, "major": "BA"}]))
        _add(app, code, saved, updated_by_email="admin@andrew.cmu.edu")
        expected[code] = {"BA": {"add": [_new_row("BA", rename("BA", old, code, programs, per_course))], "remove": []}}
    out = io.StringIO()
    with app.app_context():
        summary = run(renames=REAL_RENAMES, catalog=TODAY, baseline=PRODUCTION, apply=True, out=out)
    # Every converted path is a category of today's catalog.
    assert summary == {"rows": 26, "changed": 26, "deleted": 0, "unknown_paths": 0}, out.getvalue()
    assert " remove  " not in out.getvalue()
    assert _stored(app) == expected


def test_a_cleanup_catalog_is_refused_as_baseline(app, tmp_path, capsys, monkeypatch):
    """A catalog without the old numbers only production has (any cleanup catalog) stops before the database."""
    check_baseline(load_catalog(PRODUCTION))  # production's rows pass
    data = json.loads(PRODUCTION.read_text(encoding="utf-8"))
    # What the cleanup did on 2026-11-09: the old numbers' rows moved away and the old rows went.
    data["courses"] = [c for c in data["courses"] if c["course_code"] not in PRODUCTION_ONLY_CODES]
    cleanup = tmp_path / "cleanup-catalog.json"
    cleanup.write_text(json.dumps(data), encoding="utf-8")
    saved = {"CS": [], "IS": [], "BA": [_new_row("BA", "EY2022 Qatar Business Administration - University Core "
                                                       "Requirements---Scientific Reasoning")], "BS": []}
    _add(app, "85-150", saved)

    with app.app_context():
        with pytest.raises(BaselineError, match="85-211, 85-219"):
            run(renames=REAL_RENAMES, catalog=TODAY, baseline=cleanup, apply=True, out=io.StringIO())
    monkeypatch.setattr("backend.app.create_app", lambda **kw: app)
    assert main(["--baseline", str(cleanup), "--apply"]) == 2
    err = capsys.readouterr().err
    assert "not the catalog the old course editor saved against" in err
    assert "git show 79e29ec:data/courses.json" in err and "Nothing was written." in err
    assert _stored(app) == {"85-150": saved}
    with app.app_context():
        assert db.session.query(AdminAuditEvent).count() == 0


def test_an_unreadable_baseline_is_reported_without_a_traceback(app, tmp_path, capsys, monkeypatch):
    """A baseline countsfor cannot read (README 15.8 step 8) stops with one line and writes nothing."""
    _add(app, "15-122", {"CS": _rows("CS", OLD_CORE)})
    monkeypatch.setattr("backend.app.create_app", lambda **kw: app)
    missing = tmp_path / "courses-main.json"
    assert main(["--baseline", str(missing), "--apply"]) == 2
    err = capsys.readouterr().err
    assert err.startswith(f"ERROR: cannot read {missing}:") and "Nothing was written." in err
    assert _stored(app)["15-122"] == {"CS": _rows("CS", OLD_CORE)}
