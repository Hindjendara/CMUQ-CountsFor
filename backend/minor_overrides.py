"""Minor settings: admins correct what frontend/data/minors.json says about a minor.

The minor file is built by hand from the official minor files (README 4.4), and a
few of its numbers are open questions (double counting limits, unit totals). An
override changes them for everyone without editing the file; the browser applies
it after loading the file (applyMinorOverrides in js/data.js). Reads are public
(who saved a minor's settings only for admins), writes admin only. Which courses
fill a category is a course edit instead (MINOR:<code> keys in course_overrides.py).

Fields, each optional:
  total_units            integer 0 to 400, or null when the minor states no total
  max_with_major         integer 0 to 10, or null for no limit (as in minors.json)
  max_with_other_minors  integer 0 to 10, or null for no limit
  admin_note             up to 1000 characters, shown to students as a note from CMU-Q
A value equal to the file's is not stored, so setting a field back to the file
value removes it, and a row with nothing left is deleted.
"""
from __future__ import annotations

import json

from flask import Blueprint, g, jsonify, request

from .admin import record_event
from .db import db
from .minors_file import known_minor_codes, load_minors
from .models import MinorOverride
from .permissions import current_user, is_admin, require_role_group, ROLE_GROUP_ADMIN

bp = Blueprint("minor_overrides", __name__, url_prefix="/api/minors/overrides")

LIMIT_FIELDS = ("max_with_major", "max_with_other_minors")
FIELDS = ("total_units", *LIMIT_FIELDS, "admin_note")
UNITS_MAX = 400
LIMIT_MAX = 10
NOTE_MAX = 1000
LABELS = {
    "total_units": "Total units",
    "max_with_major": "Courses shared with the major",
    "max_with_other_minors": "Courses shared with another minor",
    "admin_note": "Note for students",
}


class SettingError(ValueError):
    pass


def _whole_number(field: str, value, maximum: int):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise SettingError(f"{LABELS[field]} must be a whole number or empty.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise SettingError(f"{LABELS[field]} must be a whole number or empty.") from None
    if not number.is_integer() or not 0 <= number <= maximum:
        raise SettingError(f"{LABELS[field]} must be a whole number from 0 to {maximum}, or empty.")
    return int(number)


def _clean(data: dict) -> dict:
    out: dict = {}
    if "total_units" in data:
        out["total_units"] = _whole_number("total_units", data["total_units"], UNITS_MAX)
    for field in LIMIT_FIELDS:
        if field in data:
            out[field] = _whole_number(field, data[field], LIMIT_MAX)
    if "admin_note" in data:
        note = data["admin_note"]
        if note is not None and not isinstance(note, str):
            raise SettingError("The note must be text.")
        note = (note or "").strip()
        if len(note) > NOTE_MAX:
            raise SettingError(f"The note is too long (max {NOTE_MAX} characters).")
        out["admin_note"] = note
    return out


def _file_values(code: str) -> dict | None:
    """The file's value of every field, or None when the file cannot be read."""
    minors = load_minors()
    definition = (minors or {}).get(code)
    if not isinstance(definition, dict):
        return None
    dc = definition.get("double_count") or {}
    return {
        "total_units": definition.get("total_units"),
        "max_with_major": dc.get("max_with_major"),
        "max_with_other_minors": dc.get("max_with_other_minors"),
        "admin_note": "",
    }


def _stored(row: MinorOverride | None) -> dict:
    return row.to_dict()["fields"] if row is not None else {}


def _effective(fields: dict, file_values: dict | None, field: str):
    if field in fields:
        return fields[field]
    return (file_values or {}).get(field, "" if field == "admin_note" else None)


def _minor_code(raw: str) -> str | None:
    code = (raw or "").strip().lower()
    return code if code in known_minor_codes() else None


@bp.route("", methods=["GET"])
def list_minor_overrides():
    """Every minor's settings, for every visitor. Who saved them (updated_by_email) only for admins."""
    rows = db.session.query(MinorOverride).order_by(MinorOverride.minor_code).all()
    editor = is_admin(current_user())
    resp = jsonify(items=[r.to_dict(include_editor=editor) for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/<code>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_ADMIN)
def edit_minor(code: str):
    key = _minor_code(code)
    if not key:
        return jsonify(error="unknown_minor", message=f"Unknown minor: {code}."), 400
    data = request.get_json(silent=True) or {}
    unknown = set(data) - set(FIELDS)
    if unknown:
        return jsonify(error="unknown_fields", message=f"Cannot update: {sorted(unknown)}"), 400
    try:
        fields = _clean(data)
    except SettingError as e:
        return jsonify(error="invalid_field", message=str(e)), 400

    row = db.session.query(MinorOverride).filter_by(minor_code=key).one_or_none()
    prev = _stored(row)
    merged = dict(prev)
    merged.update(fields)
    file_values = _file_values(key)
    if file_values is not None:
        merged = {k: v for k, v in merged.items() if v != file_values.get(k)}
    elif merged.get("admin_note") == "":
        merged.pop("admin_note")
    changed = [f for f in FIELDS if _effective(prev, file_values, f) != _effective(merged, file_values, f)
               or (f in prev) != (f in merged)]
    if not changed:
        return jsonify(row.to_dict() if row else {"minor_code": key, "fields": {}})
    changes = {f: {"from": _effective(prev, file_values, f), "to": _effective(merged, file_values, f)} for f in changed}

    if not merged:
        if row is not None:
            db.session.delete(row)
            record_event(g.user, "minor.revert", key, before=prev, reason="matches the minor file")
            db.session.commit()
        return jsonify(minor_code=key, fields={})
    if row is None:
        row = MinorOverride(minor_code=key)
        db.session.add(row)
    row.fields = json.dumps(merged)
    row.updated_by_id = g.user.id
    row.updated_by_email = g.user.email
    record_event(g.user, "minor.update", key, fields=changed, changes=changes)
    db.session.commit()
    return jsonify(row.to_dict())


@bp.route("/<code>", methods=["DELETE"])
@require_role_group(ROLE_GROUP_ADMIN)
def revert_minor(code: str):
    """Back to exactly what minors.json says. The event keeps what was dropped."""
    key = (code or "").strip().lower()
    row = db.session.query(MinorOverride).filter_by(minor_code=key).one_or_none()
    if row is None:
        return jsonify(error="not_found", message="That minor has no edits."), 404
    before = _stored(row)
    db.session.delete(row)
    record_event(g.user, "minor.revert", key, before=before)
    db.session.commit()
    return jsonify(ok=True, minor_code=key)
