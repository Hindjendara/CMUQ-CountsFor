"""Wishlist API: students save courses with optional notes.

A student's saved courses and notes are private to that student. Faculty and
admins see only anonymous counts: how many students saved each course.
"""
from flask import Blueprint, g, jsonify, request
from sqlalchemy import func
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


@bp.route("/interest", methods=["GET"])
@require_role_group(ROLE_GROUP_FACULTY, ROLE_GROUP_ADMIN)
def get_wishlist_interest():
    """How many students saved each course, most saved first. No names, no notes.

    `limit` (default 50, max 500) caps the course list; `total_courses` counts
    every saved course and `students` the students who saved at least one.
    """
    try:
        limit = int(request.args.get("limit", "50") or "50")
    except ValueError:
        limit = 50
    limit = min(500, max(1, limit))
    students = func.count(func.distinct(WishlistItem.user_id))
    base = (
        db.session.query(WishlistItem.course_code, students)
        .join(User, User.id == WishlistItem.user_id)
        .filter(User.role == "student")
        .group_by(WishlistItem.course_code)
    )
    total_courses = base.count()
    rows = base.order_by(students.desc(), WishlistItem.course_code).limit(limit).all()
    saving = (
        db.session.query(func.count(func.distinct(WishlistItem.user_id)))
        .join(User, User.id == WishlistItem.user_id)
        .filter(User.role == "student")
        .scalar()
        or 0
    )
    return jsonify(
        courses=[{"course_code": code, "students": n} for code, n in rows],
        total_courses=total_courses,
        students=saving,
    )


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
