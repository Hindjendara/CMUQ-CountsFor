"""Course catalog edits — admins add, edit, renumber and archive courses.

Reads are public so every visitor sees the corrected catalog; writes are admin only.
Edits are stored as overrides because the daily SOC scrape regenerates
frontend/data/courses.json and would otherwise erase them.
"""
from __future__ import annotations

import json
import re

from flask import Blueprint, g, jsonify, request

from .admin import record_event
from .db import db
from .models import CourseOverride
from .permissions import require_role_group, ROLE_GROUP_ADMIN

bp = Blueprint("course_overrides", __name__, url_prefix="/api/courses/overrides")

COURSE_CODE_RE = re.compile(r"^\d{2}-\d{3}$")
REQUIREMENT_PROGRAMS = frozenset({"CS", "IS", "BA", "BS", "AI", "GS"})
TEXT_FIELDS = {"course_name": 200, "description": 5000, "prerequisites": 1000}
SEMESTER_RE = re.compile(r"^[FSMN]\d{2}$")


def _normalize_code(raw) -> str | None:
    code = (raw or "").strip().upper()
    if re.fullmatch(r"\d{5}", code):
        code = f"{code[:2]}-{code[2:]}"
    return code if COURSE_CODE_RE.match(code) else None


def _clean_fields(data: dict) -> tuple[dict, str | None]:
    """Validate the catalog fields present in `data`. Returns (fields, error)."""
    out: dict = {}
    if "new_code" in data:
        code = _normalize_code(data["new_code"])
        if not code:
            return {}, "Course number must look like 15-122."
        out["course_code"] = code
    for field, max_len in TEXT_FIELDS.items():
        if field in data:
            value = (data[field] or "").strip()
            if field == "course_name" and not value:
                return {}, "Course name cannot be empty."
            if len(value) > max_len:
                return {}, f"{field.replace('_', ' ').capitalize()} is too long (max {max_len} characters)."
            out[field] = value
    if "department" in data:
        dept = str(data["department"] or "").strip().lstrip("0") or None
        if dept is not None and not dept.isdigit():
            return {}, "Department must be the numeric department code, for example 15."
        out["department"] = dept
    if "units" in data:
        try:
            units = float(data["units"])
        except (TypeError, ValueError):
            return {}, "Units must be a number."
        if not 0 <= units <= 48:
            return {}, "Units must be between 0 and 48."
        out["units"] = int(units) if units.is_integer() else units
    for flag in ("offered_qatar", "offered_pitts"):
        if flag in data:
            out[flag] = bool(data[flag])
    if "offered" in data:
        sems = data["offered"] or []
        if not isinstance(sems, list) or not all(isinstance(s, str) and SEMESTER_RE.match(s) for s in sems):
            return {}, "Offered semesters must be codes like F26 or S27."
        out["offered"] = sorted(set(sems))
    return out, None


def _clean_requirements(raw) -> tuple[dict | None, str | None]:
    """{"CS": [{"requirement": "A---B", "type": bool}], ...} -> stored map with `major` filled in."""
    if not isinstance(raw, dict):
        return None, "requirements must be an object keyed by program."
    out: dict[str, list[dict]] = {}
    for program, entries in raw.items():
        if program not in REQUIREMENT_PROGRAMS:
            return None, f"Unknown program: {program}."
        if not isinstance(entries, list):
            return None, f"Requirements for {program} must be a list."
        seen: set[str] = set()
        rows = []
        for entry in entries:
            req = (entry.get("requirement") if isinstance(entry, dict) else "") or ""
            req = req.strip()
            if not req or len(req) > 400:
                return None, "Each requirement needs a category path under 400 characters."
            if req in seen:
                continue
            seen.add(req)
            rows.append({"requirement": req, "type": bool(entry.get("type")), "major": program})
        out[program] = rows
    return out, None


def _actor_stamp(row: CourseOverride) -> None:
    row.updated_by_id = g.user.id
    row.updated_by_email = g.user.email


def _changed_keys(fields: dict, requirements: dict | None) -> list[str]:
    keys = sorted(fields.keys())
    if requirements is not None:
        keys.append("counts for")
    return keys


@bp.route("", methods=["GET"])
def list_overrides():
    rows = db.session.query(CourseOverride).order_by(CourseOverride.course_code).all()
    resp = jsonify(items=[r.to_dict() for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def add_course():
    """Add a course that is not in the scraped catalog."""
    data = request.get_json(silent=True) or {}
    code = _normalize_code(data.get("course_code"))
    if not code:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    if not (data.get("course_name") or "").strip():
        return jsonify(error="missing_name", message="Course name is required."), 400
    if db.session.query(CourseOverride).filter_by(course_code=code).one_or_none():
        return jsonify(error="exists", message=f"{code} already has an entry here. Edit it instead."), 409

    payload = {k: v for k, v in data.items() if k not in ("course_code", "new_code", "requirements")}
    fields, err = _clean_fields(payload)
    if err:
        return jsonify(error="invalid_field", message=err), 400
    fields["course_code"] = code
    requirements, err = _clean_requirements(data.get("requirements") or {})
    if err:
        return jsonify(error="invalid_requirements", message=err), 400

    row = CourseOverride(
        course_code=code,
        is_new=True,
        fields=json.dumps(fields),
        requirements=json.dumps(requirements),
    )
    _actor_stamp(row)
    db.session.add(row)
    record_event(g.user, "course.add", code, name=fields.get("course_name"))
    db.session.commit()
    return jsonify(row.to_dict()), 201


@bp.route("/<code>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_ADMIN)
def edit_course(code: str):
    """Save edits for a catalog course (creates its override) or an added course."""
    key = _normalize_code(code)
    if not key:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    data = request.get_json(silent=True) or {}
    unknown = set(data) - {"new_code", "requirements", "offered", *TEXT_FIELDS, "department", "units", "offered_qatar", "offered_pitts"}
    if unknown:
        return jsonify(error="unknown_fields", message=f"Cannot update: {sorted(unknown)}"), 400

    fields, err = _clean_fields(data)
    if err:
        return jsonify(error="invalid_field", message=err), 400
    requirements = None
    if "requirements" in data:
        requirements, err = _clean_requirements(data["requirements"])
        if err:
            return jsonify(error="invalid_requirements", message=err), 400

    new_code = fields.get("course_code")
    if new_code and new_code != key:
        clash = db.session.query(CourseOverride).filter_by(course_code=new_code).one_or_none()
        if clash and clash.is_new:
            return jsonify(error="code_taken", message=f"{new_code} is already used by a course added here."), 409

    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none()
    if row is None:
        row = CourseOverride(course_code=key, is_new=False)
        db.session.add(row)
    merged = json.loads(row.fields) if row.fields else {}
    merged.update(fields)
    if not row.is_new and merged.get("course_code") == key:
        merged.pop("course_code")  # renumbered back to the original
    if row.is_new:
        # An added course is keyed by its own code, so renumbering moves the key.
        if new_code and new_code != key:
            if db.session.query(CourseOverride).filter_by(course_code=new_code).one_or_none():
                return jsonify(error="code_taken", message=f"{new_code} already has an entry here."), 409
            row.course_code = new_code
        merged["course_code"] = row.course_code
    row.fields = json.dumps(merged) if merged else None
    if requirements is not None:
        row.requirements = json.dumps(requirements)
    if not row.is_new and not row.fields and row.requirements is None and not row.archived:
        # Nothing differs from the catalog any more, so keep no row at all.
        if row.id is None:
            db.session.expunge(row)
        else:
            db.session.delete(row)
            record_event(g.user, "course.revert", key)
        db.session.commit()
        return jsonify(course_code=key, is_new=False, archived=False, fields={}, requirements=None)
    _actor_stamp(row)
    changed = _changed_keys(fields, requirements)
    record_event(g.user, "course.update", row.course_code, fields=changed, **({"renumbered_from": key} if new_code and new_code != key else {}))
    db.session.commit()
    return jsonify(row.to_dict())


def _set_archived(code: str, archived: bool):
    key = _normalize_code(code)
    if not key:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none()
    if row is None:
        if not archived:
            return jsonify(error="not_found", message="That course is not archived."), 404
        row = CourseOverride(course_code=key, is_new=False)
        db.session.add(row)
    row.archived = archived
    _actor_stamp(row)
    record_event(g.user, "course.archive" if archived else "course.restore", key)
    body = row.to_dict()
    if not archived and not row.is_new and not row.fields and row.requirements is None:
        db.session.delete(row)  # restored with no other edits, so nothing left to store
    db.session.commit()
    return jsonify(body)


@bp.route("/<code>/archive", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def archive_course(code: str):
    """Hide a course from students. Nothing is deleted; restore brings it back."""
    return _set_archived(code, True)


@bp.route("/<code>/restore", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def restore_course(code: str):
    return _set_archived(code, False)


@bp.route("/<code>", methods=["DELETE"])
@require_role_group(ROLE_GROUP_ADMIN)
def revert_course(code: str):
    """Drop every manual edit so the course shows exactly what the scrape says.

    Added courses are archived instead, so a misclick never loses one.
    """
    key = _normalize_code(code)
    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none() if key else None
    if row is None:
        return jsonify(error="not_found", message="That course has no edits."), 404
    if row.is_new:
        return jsonify(error="added_course", message="Courses added here can be archived, not reverted."), 400
    db.session.delete(row)
    record_event(g.user, "course.revert", key)
    db.session.commit()
    return jsonify(ok=True, course_code=key)
