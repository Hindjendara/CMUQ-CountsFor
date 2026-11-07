"""Directory management API — faculty/admin grant roles via Postgres (never JSON writes)."""
from flask import Blueprint, g, jsonify, request

from .cmu import normalize_cmu_email
from .admin import record_event
from .db import db
from .directory import (
    ELEVATED_ROLES,
    UI_DIRECTORY_ROLES,
    list_elevated_directory,
    load_merged_directory,
    _load_json_directory,
)
from .models import DirectoryEntry, VALID_DEPARTMENTS
from .permissions import require_role_group, ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN

bp = Blueprint("directory", __name__, url_prefix="/api/directory")

# UI adds only need name + email; these defaults grant the special (faculty) view on login.
DEFAULT_DIRECTORY_ROLE = "professor"
DEFAULT_DIRECTORY_DEPARTMENT = "Dean's Office"
DEFAULT_DIRECTORY_PROGRAM = "AS"


def _validate_entry_payload(data: dict, *, require_email: bool = True) -> tuple[dict | None, tuple | None]:
    email = normalize_cmu_email(data.get("email") or "")
    name = (data.get("name") or "").strip()
    role = (data.get("role") or "").strip().lower() or DEFAULT_DIRECTORY_ROLE
    department = (data.get("department") or "").strip() or None
    primary_program = (data.get("primary_program") or "").strip().upper() or None
    picture_url = (data.get("picture_url") or "").strip() or None

    if require_email and not email:
        return None, (jsonify(error="invalid_email", message="Use a valid @andrew.cmu.edu email."), 400)
    if not name:
        return None, (jsonify(error="invalid_name", message="Name is required."), 400)
    if role not in UI_DIRECTORY_ROLES:
        return None, (
            jsonify(error="invalid_role", message=f"Role must be one of: {', '.join(UI_DIRECTORY_ROLES)}."),
            400,
        )
    if role in ELEVATED_ROLES and role != "admin":
        department = department or DEFAULT_DIRECTORY_DEPARTMENT
        primary_program = primary_program or DEFAULT_DIRECTORY_PROGRAM
        if department not in VALID_DEPARTMENTS:
            return None, (jsonify(error="invalid_department", message="Department is required for faculty roles."), 400)
    if role == "admin":
        department = department or DEFAULT_DIRECTORY_DEPARTMENT
        if department not in VALID_DEPARTMENTS:
            return None, (jsonify(error="invalid_department", message="Department is required."), 400)

    return {
        "email": email,
        "name": name,
        "role": role,
        "department": department,
        "primary_program": primary_program,
        "picture_url": picture_url,
    }, None


@bp.route("/entries", methods=["GET"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def list_entries():
    items = list_elevated_directory()
    return jsonify(items=items, total=len(items))


@bp.route("/entries", methods=["POST"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def add_entry():
    payload, err = _validate_entry_payload(request.get_json(silent=True) or {})
    if err:
        return err

    email = payload["email"]
    existing = db.session.query(DirectoryEntry).filter_by(email=email).one_or_none()
    created = existing is None
    if existing is None:
        existing = DirectoryEntry(email=email, added_by_id=g.user.id)
        db.session.add(existing)

    for field in ("name", "role", "department", "primary_program", "picture_url"):
        setattr(existing, field, payload[field])
    if not existing.added_by_id:
        existing.added_by_id = g.user.id
    record_event(g.user, "directory.add" if created else "directory.update", email, role=payload["role"], name=payload["name"])
    db.session.commit()
    source = "db" if email not in _load_json_directory() else "db+json"
    body = existing.to_public_dict(source=source)
    return jsonify(body), 201 if created else 200


@bp.route("/entries/<int:entry_id>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def update_entry(entry_id: int):
    row = db.session.get(DirectoryEntry, entry_id)
    if row is None:
        return jsonify(error="not_found", message="No such directory entry."), 404

    data = request.get_json(silent=True) or {}
    data.setdefault("email", row.email)
    data.setdefault("name", row.name)
    data.setdefault("role", row.role)
    data.setdefault("department", row.department or "")
    data.setdefault("primary_program", row.primary_program or "")
    payload, err = _validate_entry_payload(data, require_email=True)
    if err:
        return err

    for field in ("name", "role", "department", "primary_program", "picture_url"):
        setattr(row, field, payload[field])
    record_event(g.user, "directory.update", row.email, role=payload["role"], name=payload["name"])
    db.session.commit()
    return jsonify(row.to_public_dict(source="db"))


@bp.route("/entries/by-email", methods=["PATCH"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def upsert_entry_by_email():
    """Create or update a DB overlay for a JSON-seeded person."""
    data = request.get_json(silent=True) or {}
    email = normalize_cmu_email(data.get("email") or "")
    if not email:
        return jsonify(error="invalid_email", message="Email is required."), 400
    data["email"] = email
    payload, err = _validate_entry_payload(data)
    if err:
        return err

    row = db.session.query(DirectoryEntry).filter_by(email=email).one_or_none()
    created = row is None
    if row is None:
        row = DirectoryEntry(email=email, added_by_id=g.user.id)
        db.session.add(row)
    for field in ("name", "role", "department", "primary_program", "picture_url"):
        setattr(row, field, payload[field])
    record_event(g.user, "directory.add" if created else "directory.update", email, role=payload["role"], name=payload["name"])
    db.session.commit()
    source = "db+json" if email in _load_json_directory() else "db"
    return jsonify(row.to_public_dict(source=source)), 201 if created else 200


@bp.route("/entries/<int:entry_id>", methods=["DELETE"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def delete_entry(entry_id: int):
    row = db.session.get(DirectoryEntry, entry_id)
    if row is None:
        return jsonify(error="not_found", message="No such directory entry."), 404
    email = row.email
    db.session.delete(row)
    record_event(g.user, "directory.remove", email, name=row.name)
    db.session.commit()
    return jsonify(ok=True, email=email)


@bp.route("/entries/revoke", methods=["POST"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def revoke_access():
    """Remove elevated access — DB overlay with role=student, or delete DB row to revert to JSON."""
    data = request.get_json(silent=True) or {}
    email = normalize_cmu_email(data.get("email") or "")
    if not email:
        return jsonify(error="invalid_email", message="Email is required."), 400

    row = db.session.query(DirectoryEntry).filter_by(email=email).one_or_none()
    if row is not None:
        db.session.delete(row)
        record_event(g.user, "directory.remove", email, name=row.name)
        db.session.commit()
        return jsonify(ok=True, message="Directory entry removed.")

    if email not in load_merged_directory():
        return jsonify(error="not_found", message="That person is not in the directory."), 404

    row = DirectoryEntry(
        email=email,
        name=(data.get("name") or email.split("@", 1)[0]).strip(),
        role="student",
        added_by_id=g.user.id,
    )
    db.session.add(row)
    record_event(g.user, "directory.revoke", email, name=row.name)
    db.session.commit()
    return jsonify(ok=True, message="Access revoked. User will be a student on next login.")
