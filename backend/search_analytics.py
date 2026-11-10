"""Course search popularity — aggregated by student major and semester."""
from __future__ import annotations

import re

from flask import Blueprint, current_app, g, jsonify, request

from .db import db
from .models import CourseSearchCount, _utcnow
from .permissions import require_login, require_role
from .semesters import default_semester, normalize_semester

bp = Blueprint("search_analytics", __name__, url_prefix="/api/search-analytics")

_COURSE_CODE_RE = re.compile(r"^\d{1,2}-\d{2,4}$")
_VALID_PROGRAMS = frozenset({"CS", "IS", "BA", "BS", "AI", "GS", "AS"})
_MAX_LIMIT = 10


def _normalize_course_code(code: str) -> str:
    code = (code or "").strip().upper()
    if not code:
        return ""
    if _COURSE_CODE_RE.match(code):
        return code
    return ""


def _normalize_program(program: str | None) -> str | None:
    p = (program or "").strip().upper()
    return p if p in _VALID_PROGRAMS else None


def _semester_or_default(raw) -> str | None:
    """Any semester code (S27, M26, a new F27...), else the default: the newest
    fall or spring with Qatar sections in soc.json. None if neither exists."""
    return normalize_semester(raw) or default_semester(current_app.config["SOC_JSON_PATH"])


def _no_semester():
    return jsonify(error="invalid_semester", message="Give a semester code such as S27."), 400


def _bump_count(program: str, semester: str, course_code: str) -> CourseSearchCount:
    row = (
        db.session.query(CourseSearchCount)
        .filter_by(
            primary_program=program,
            semester_code=semester,
            course_code=course_code,
        )
        .one_or_none()
    )
    now = _utcnow()
    if row:
        row.search_count += 1
        row.last_searched_at = now
    else:
        row = CourseSearchCount(
            primary_program=program,
            semester_code=semester,
            course_code=course_code,
            search_count=1,
            last_searched_at=now,
        )
        db.session.add(row)
    db.session.commit()
    return row


@bp.route("/events", methods=["POST"])
@require_role("student")
def record_search_event():
    """Increment peer popularity when a student opens a course."""
    data = request.get_json(silent=True) or {}
    course_code = _normalize_course_code(data.get("course_code") or "")
    if not course_code:
        return jsonify(error="invalid_course_code", message="Valid course_code required."), 400

    program = _normalize_program(g.user.primary_program)
    if not program:
        return jsonify(
            error="missing_program",
            message="Complete your profile with a primary program first.",
        ), 400
    semester = _semester_or_default(data.get("semester_code"))
    if not semester:
        return _no_semester()

    row = _bump_count(program, semester, course_code)
    return jsonify(row.to_dict()), 201


@bp.route("/popular", methods=["GET"])
def get_popular_courses():
    """Top searched courses for a program + semester (aggregate, no user data)."""
    program = _normalize_program(request.args.get("program"))
    if not program:
        return jsonify(error="missing_program", message="program query param required."), 400
    semester = _semester_or_default(request.args.get("semester"))
    if not semester:
        return _no_semester()

    try:
        limit = min(int(request.args.get("limit", 5)), _MAX_LIMIT)
    except ValueError:
        limit = 5
    limit = max(1, limit)

    rows = (
        db.session.query(CourseSearchCount)
        .filter_by(primary_program=program, semester_code=semester)
        .order_by(CourseSearchCount.search_count.desc(), CourseSearchCount.last_searched_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify(
        program=program,
        semester=semester,
        items=[r.to_dict() for r in rows],
    )
