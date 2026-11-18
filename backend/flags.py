"""Flags API: faculty submit, faculty+admin resolve, students read-only.

Students may list non-dismissed flags (to see flagged courses) but cannot POST.
They see a flag's admin note only when an admin has made it visible
(`admin_notes_public`); only admins can change that setting.
All faculty (professor, area_head, associate_area_head, advisor) and admin share
the same flag queue and may resolve flags.
"""
import secrets
import time
from flask import Blueprint, g, jsonify, request

from .admin import record_event
from .db import db
from .models import Flag, FLAG_STATUSES
from .permissions import (
    is_admin,
    require_login,
    require_role_group,
    ROLE_GROUP_STUDENT,
    ROLE_GROUP_FACULTY,
    ROLE_GROUP_ADMIN,
)


bp = Blueprint("flags", __name__, url_prefix="/api/flags")

VALID_REASON_CODES = {
    "not_offered",
    "campus_wrong",
    "metadata_outdated",
    "prereq_wrong",
    "requirement_mismatch",
    "requirement_newly_counts",
    "should_be_equivalent",
    "wrong_semester",
    "restrictions_missing",
    "duplicate",
    "other",
}

REQUIRED_POST_FIELDS = {"course_code", "course_name", "reason_code", "reason_label"}


def _new_flag_id() -> str:
    ts = format(int(time.time() * 1000), "x")
    rnd = secrets.token_hex(3)
    return f"flg-{ts}-{rnd}"


# ── POST /api/flags — faculty + admin only ───────────────────
@bp.route("", methods=["POST"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def create_flag():
    data = request.get_json(silent=True) or {}
    missing = REQUIRED_POST_FIELDS - set(data.keys())
    if missing:
        return jsonify(error="missing_fields", message=f"Required: {sorted(missing)}"), 400

    if data["reason_code"] not in VALID_REASON_CODES:
        return jsonify(error="invalid_reason", message=f"reason_code must be one of {sorted(VALID_REASON_CODES)}"), 400

    user = g.user
    incoming_id = data.get("id")
    flag_id = incoming_id if (incoming_id and incoming_id.startswith("flg-")) else _new_flag_id()

    flag = Flag(
        id=flag_id,
        course_code=data["course_code"],
        course_name=data["course_name"],
        reason_code=data["reason_code"],
        reason_label=data["reason_label"],
        notes=(data.get("notes") or None),
        submitted_by_id=user.id,
        submitted_by_name=user.name,
        submitted_by_email=user.email,
        submitted_by_role=user.role,
        submitted_program=user.primary_program,
        submitted_minor=user.minor_code,
        status="pending",
    )
    existing = db.session.get(Flag, flag_id)
    if existing:
        return jsonify(existing.to_dict()), 200

    db.session.add(flag)
    db.session.commit()
    return jsonify(flag.to_dict()), 201


# ── GET /api/flags — students: read-only; faculty/admin: full queue ─
@bp.route("", methods=["GET"])
@require_login
def list_flags():
    status = request.args.get("status")
    course = request.args.get("course")
    page = max(1, int(request.args.get("page", "1") or "1"))
    limit = min(100, max(1, int(request.args.get("limit", "50") or "50")))

    q = db.session.query(Flag)
    group = g.user.role_group()

    if group == ROLE_GROUP_STUDENT:
        q = q.filter(Flag.status != "dismissed")
    elif group == ROLE_GROUP_FACULTY:
        mine = request.args.get("mine", "").lower() in ("1", "true", "yes")
        if mine:
            q = q.filter(Flag.submitted_by_id == g.user.id)

    if status:
        if status not in FLAG_STATUSES:
            return jsonify(error="invalid_status", message=f"status must be one of {list(FLAG_STATUSES)}"), 400
        q = q.filter(Flag.status == status)
    if course:
        q = q.filter(Flag.course_code == course)

    total = q.count()
    rows = (
        q.order_by(Flag.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    if group == ROLE_GROUP_STUDENT:
        items = [
            {
                "id": f.id,
                "course_code": f.course_code,
                "course_name": f.course_name,
                "reason_code": f.reason_code,
                "reason_label": f.reason_label,
                "status": f.status,
                "admin_notes": f.admin_notes if f.admin_notes_public else None,
                "updated_at": f.updated_at.isoformat() if f.updated_at else None,
            }
            for f in rows
        ]
    else:
        items = [f.to_dict() for f in rows]

    return jsonify(total=total, page=page, limit=limit, items=items)


# ── PATCH /api/flags/<id> — faculty + admin resolve ───────────
@bp.route("/<flag_id>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def update_flag(flag_id: str):
    data = request.get_json(silent=True) or {}
    flag = db.session.get(Flag, flag_id)
    if not flag:
        return jsonify(error="not_found", message="No such flag."), 404

    if "status" in data:
        if data["status"] not in FLAG_STATUSES:
            return jsonify(error="invalid_status", message=f"status must be one of {list(FLAG_STATUSES)}"), 400
        if data["status"] != flag.status:
            record_event(g.user, "flag.status", flag.course_code, flag_id=flag.id, **{"from": flag.status, "to": data["status"]})
        flag.status = data["status"]
        flag.resolved_by = g.user.id

    admin = is_admin(g.user)
    if "admin_notes_public" in data and not admin:
        return jsonify(error="admin_only", message="Only an admin can show a note to students."), 403

    if "admin_notes" in data:
        note = (data["admin_notes"] or "").strip() or None
        if note != flag.admin_notes:
            record_event(g.user, "flag.note", flag.course_code, flag_id=flag.id, note=note)
            # A note changed by someone who is not an admin goes back to private,
            # so students never see text no admin approved.
            if not admin:
                flag.admin_notes_public = False
        flag.admin_notes = note

    if "admin_notes_public" in data:
        public = bool(data["admin_notes_public"]) and bool(flag.admin_notes)
        if public != bool(flag.admin_notes_public):
            record_event(g.user, "flag.note_visibility", flag.course_code, flag_id=flag.id, public=public)
        flag.admin_notes_public = public
    if not flag.admin_notes:
        flag.admin_notes_public = False

    db.session.commit()
    return jsonify(flag.to_dict())
