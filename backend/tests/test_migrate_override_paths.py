"""backend/migrate_override_paths.py: old whole-list course edits become changes in the new names."""
import io
import json

from backend.db import db
from backend.migrate_override_paths import main, migrate_value, run
from backend.models import AdminAuditEvent, CourseOverride

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
