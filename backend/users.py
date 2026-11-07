"""User management — list and update roles for admins and area heads."""
from flask import Blueprint, g, jsonify, request

from .auth import USER_SETTABLE_ROLES, _sync_user_minors, _validate_consistent_profile, _minor_codes_for_validation
from .admin import record_event
from .db import db
from .models import User
from .permissions import require_role_group, ROLE_GROUP_ADMIN
from .models import VALID_DEPARTMENTS, FACULTY_ROLES

bp = Blueprint("users", __name__, url_prefix="/api/users")

MANAGER_ROLES = (ROLE_GROUP_ADMIN,)  # user management is admin-only

ALLOWED_PATCH_FIELDS = {
    "name",
    "role",
    "primary_program",
    "minor_code",
    "minor_codes",
    "advisor_scope",
    "department",
    "department_scope",
}


def _audit_snapshot(user: User) -> dict:
    return {
        "role": user.role,
        "primary_program": user.primary_program,
        "minor_codes": user.minor_codes_list(),
        "department": user.department,
        "advisor_scope": user.advisor_scope,
        "name": user.name,
    }


@bp.route("", methods=["GET"])
@require_role_group(ROLE_GROUP_ADMIN)
def list_users():
    q = db.session.query(User).order_by(User.email)
    search = (request.args.get("search") or "").strip().lower()
    if search:
        like = f"%{search}%"
        q = q.filter(
            (User.email.ilike(like))
            | (User.name.ilike(like))
            | (User.role.ilike(like))
        )
    group = (request.args.get("role_group") or "").strip().lower()
    if group == "student":
        q = q.filter(User.role == "student")
    elif group == "faculty":
        q = q.filter(User.role.in_(FACULTY_ROLES))
    elif group == "admin":
        q = q.filter(User.role == "admin")
    if (request.args.get("incomplete") or "").lower() in ("1", "true", "yes"):
        q = q.filter(User.profile_completed.is_(False))
    try:
        limit = max(1, min(int(request.args.get("limit", 200)), 1000))
    except ValueError:
        limit = 200
    total = q.count()
    rows = q.limit(limit).all()
    items = []
    for u in rows:
        row = u.to_public_dict()
        row["created_at"] = u.created_at.isoformat() if u.created_at else None
        items.append(row)
    return jsonify(items=items, total=total)


@bp.route("/<int:user_id>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_ADMIN)
def update_user(user_id: int):
    actor: User = g.user
    target = db.session.get(User, user_id)
    if not target:
        return jsonify(error="not_found", message="No such user."), 404

    # Area heads may correct roles/programs but cannot promote to admin.
    if actor.role != "admin" and target.role == "admin":
        return jsonify(error="forbidden", message="Only admins can edit admin accounts."), 403

    before = _audit_snapshot(target)
    data = request.get_json(silent=True) or {}
    unknown = set(data.keys()) - ALLOWED_PATCH_FIELDS
    if unknown:
        return jsonify(error="unknown_fields", message=f"Cannot update: {sorted(unknown)}"), 400

    def _next(field, default):
        if field in data:
            v = data[field]
            return None if v == "" else v
        return default

    new_role = _next("role", target.role)
    new_primary = _next("primary_program", target.primary_program)
    new_advisor_scope = _next("advisor_scope", target.advisor_scope)
    new_minor_codes = _minor_codes_for_validation(data, target)
    if "minor_codes" in data and not isinstance(data["minor_codes"], list):
        return jsonify(error="invalid_minor_codes", message="minor_codes must be a list."), 400
    new_department = _next("department", target.department)

    if "role" in data:
        if actor.role != "admin" and new_role == "admin":
            return jsonify(error="forbidden", message="Only admins can grant admin role."), 403
        if new_role not in USER_SETTABLE_ROLES | {"admin"}:
            return jsonify(error="invalid_role", message=f"Role must be one of {sorted(USER_SETTABLE_ROLES | {'admin'})}."), 400
        if target.role == "admin" and new_role != "admin" and actor.role != "admin":
            return jsonify(error="forbidden", message="Only admins can change an admin's role."), 403

    validation_minors = new_minor_codes if new_role == "student" else []

    err = _validate_consistent_profile(new_role, new_primary, validation_minors, new_advisor_scope, new_department)
    if err:
        return jsonify(error="inconsistent_profile", message=err), 400

    if "name" in data:
        target.name = data["name"] or target.name
    if "role" in data and (actor.role == "admin" or new_role != "admin"):
        target.role = new_role
        target.is_admin = new_role == "admin"
    for field in ("primary_program", "minor_code", "advisor_scope", "department", "department_scope"):
        if field in data:
            value = data[field]
            if value == "":
                value = None
            setattr(target, field, value)
            if field == "department_scope" and value and not target.department:
                target.department = value

    if new_role == "student":
        if "minor_codes" in data or "minor_code" in data:
            sync_err = _sync_user_minors(target, new_minor_codes, role=new_role)
            if sync_err:
                return jsonify(error="inconsistent_profile", message=sync_err), 400
    elif "minor_codes" in data or (new_role != "advisor" and "minor_code" in data):
        sync_err = _sync_user_minors(target, [], role=new_role)
        if sync_err:
            return jsonify(error="inconsistent_profile", message=sync_err), 400

    target.profile_completed = target.profile_is_complete()
    changes = {
        field: {"from": before[field], "to": value}
        for field, value in _audit_snapshot(target).items()
        if before[field] != value
    }
    if changes:
        record_event(actor, "user.update", target.email, changes=changes)
    db.session.commit()
    return jsonify(target.to_public_dict())
