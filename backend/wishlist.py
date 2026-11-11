"""Wishlist API: students save courses with optional notes; faculty view roster."""
from flask import Blueprint, g, jsonify, request
from sqlalchemy.exc import IntegrityError

from .db import db
from .models import User, WishlistItem
from .permissions import require_role_group, require_role, ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN


bp = Blueprint("wishlist", __name__, url_prefix="/api/wishlist")


@bp.route("", methods=["GET"])
@require_role("student")
def get_wishlist():
    items = (
        db.session.query(WishlistItem)
        .filter_by(user_id=g.user.id)
        .order_by(WishlistItem.added_at.desc())
        .all()
    )
    return jsonify(items=[i.to_dict() for i in items])


@bp.route("/roster", methods=["GET"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def get_wishlist_roster():
    """All students' saved courses with notes — for faculty advising."""
    rows = (
        db.session.query(WishlistItem, User)
        .join(User, User.id == WishlistItem.user_id)
        .filter(User.role == "student")
        .order_by(User.name, WishlistItem.added_at.desc())
        .all()
    )
    by_user: dict[int, dict] = {}
    for item, user in rows:
        bucket = by_user.setdefault(
            user.id,
            {
                "user_id": user.id,
                "name": user.name,
                "email": user.email,
                "primary_program": user.primary_program,
                "items": [],
            },
        )
        bucket["items"].append(item.to_dict())
    return jsonify(students=list(by_user.values()))


@bp.route("", methods=["POST"])
@require_role("student")
def add_wishlist():
    data = request.get_json(silent=True) or {}
    course_code = (data.get("course_code") or "").strip()
    if not course_code:
        return jsonify(error="missing_course_code", message="course_code required."), 400

    note = (data.get("note") or "").strip() or None
    item = WishlistItem(user_id=g.user.id, course_code=course_code, note=note)
    db.session.add(item)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        existing = (
            db.session.query(WishlistItem)
            .filter_by(user_id=g.user.id, course_code=course_code)
            .one()
        )
        if note is not None:
            existing.note = note
            db.session.commit()
        return jsonify(existing.to_dict()), 200

    return jsonify(item.to_dict()), 201


@bp.route("/<course_code>", methods=["PATCH"])
@require_role("student")
def update_wishlist_note(course_code: str):
    data = request.get_json(silent=True) or {}
    item = (
        db.session.query(WishlistItem)
        .filter_by(user_id=g.user.id, course_code=course_code.strip())
        .one_or_none()
    )
    if not item:
        return jsonify(error="not_found", message="Not in wishlist."), 404
    if "note" in data:
        item.note = (data.get("note") or "").strip() or None
    db.session.commit()
    return jsonify(item.to_dict())


@bp.route("/<course_code>", methods=["DELETE"])
@require_role("student")
def remove_wishlist(course_code: str):
    item = (
        db.session.query(WishlistItem)
        .filter_by(user_id=g.user.id, course_code=course_code)
        .one_or_none()
    )
    if not item:
        return jsonify(error="not_found", message="Not in wishlist."), 404
    db.session.delete(item)
    db.session.commit()
    return "", 204
