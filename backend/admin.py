"""Admin console API — overview counts, usage insights and the activity log. Admin only."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func

from .db import db
from .activity import LOCAL_TZ, local_day
from .models import (
    AdminAuditEvent, CourseSearchCount, DirectoryEntry, Flag, FLAG_STATUSES,
    SchedulePlan, SignInEvent, User, UserActivityDay, WishlistItem,
)
from .permissions import require_role_group, ROLE_GROUP_ADMIN
from .semesters import semester_rank

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

_LAST_SCRAPE_RE = re.compile(r'"last_scrape"\s*:\s*"([^"]+)"')


def record_event(actor: User, action: str, target: str | None = None, **details) -> None:
    """Add an audit row to the current session. The caller's commit saves it with the change."""
    clean = {k: v for k, v in details.items() if v is not None}
    db.session.add(AdminAuditEvent(
        actor_id=actor.id,
        actor_email=actor.email,
        actor_name=actor.name,
        action=action,
        target=target,
        details=json.dumps(clean) if clean else None,
    ))


def _as_utc(dt: datetime | None) -> datetime | None:
    # SQLite hands back naive datetimes; Postgres returns aware ones.
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _course_data_info() -> dict:
    """Read only the header of the SOC file; metadata is its first key.

    The file (config SOC_JSON_PATH, default backend/data/soc.json) is written by
    backend/scraper/scrape_soc.py and is private: never served to the browser.
    """
    try:
        with Path(current_app.config["SOC_JSON_PATH"]).open("r", encoding="utf-8") as fh:
            head = fh.read(4096)
    except OSError:
        return {"last_scrape": None}
    m = _LAST_SCRAPE_RE.search(head)
    return {"last_scrape": m.group(1) if m else None}


def _limit(default: int, maximum: int) -> int:
    try:
        value = int(request.args.get("limit", default))
    except ValueError:
        value = default
    return max(1, min(value, maximum))


@bp.route("/overview", methods=["GET"])
@require_role_group(ROLE_GROUP_ADMIN)
def overview():
    now = datetime.now(timezone.utc)
    week_ago, month_ago = now - timedelta(days=7), now - timedelta(days=30)

    users = db.session.query(User).all()
    active_ids = _active_user_ids(_window_days(7))
    by_role: dict[str, int] = {}
    by_group = {"student": 0, "faculty": 0, "admin": 0}
    new_7d = new_30d = active_7d = incomplete = 0
    for u in users:
        by_role[u.role] = by_role.get(u.role, 0) + 1
        by_group[u.role_group()] += 1
        created, last_login = _as_utc(u.created_at), _as_utc(u.last_login)
        if created and created >= week_ago:
            new_7d += 1
        if created and created >= month_ago:
            new_30d += 1
        if u.id in active_ids or (last_login and last_login >= week_ago):
            active_7d += 1
        if not u.profile_completed:
            incomplete += 1

    flag_counts = {s: 0 for s in FLAG_STATUSES}
    for status, count in db.session.query(Flag.status, func.count(Flag.id)).group_by(Flag.status):
        flag_counts[status] = count

    recent = sorted(users, key=lambda u: _as_utc(u.created_at) or now, reverse=True)[:6]

    return jsonify(
        users={
            "total": len(users),
            "by_group": by_group,
            "by_role": by_role,
            "new_7d": new_7d,
            "new_30d": new_30d,
            "active_7d": active_7d,
            "incomplete_profiles": incomplete,
        },
        flags=flag_counts,
        wishlist={
            "items": db.session.query(func.count(WishlistItem.id)).scalar() or 0,
            "students": db.session.query(func.count(func.distinct(WishlistItem.user_id))).scalar() or 0,
        },
        plans=db.session.query(func.count(SchedulePlan.id)).scalar() or 0,
        course_lookups=db.session.query(func.coalesce(func.sum(CourseSearchCount.search_count), 0)).scalar() or 0,
        directory_overrides=db.session.query(func.count(DirectoryEntry.id)).scalar() or 0,
        course_data=_course_data_info(),
        recent_signups=[
            {
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "primary_program": u.primary_program,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in recent
        ],
    )


@bp.route("/insights", methods=["GET"])
@require_role_group(ROLE_GROUP_ADMIN)
def insights():
    semester = (request.args.get("semester") or "").strip().upper() or None

    lookups_q = db.session.query(
        CourseSearchCount.course_code, func.sum(CourseSearchCount.search_count).label("n")
    )
    if semester:
        lookups_q = lookups_q.filter(CourseSearchCount.semester_code == semester)
    top_lookups = lookups_q.group_by(CourseSearchCount.course_code).order_by(func.sum(CourseSearchCount.search_count).desc()).limit(15).all()

    by_program_q = db.session.query(
        CourseSearchCount.primary_program, CourseSearchCount.course_code,
        func.sum(CourseSearchCount.search_count),
    )
    if semester:
        by_program_q = by_program_q.filter(CourseSearchCount.semester_code == semester)
    by_program: dict[str, list[dict]] = {}
    for program, code, n in by_program_q.group_by(CourseSearchCount.primary_program, CourseSearchCount.course_code):
        by_program.setdefault(program, []).append({"course_code": code, "count": int(n)})
    for program in by_program:
        by_program[program] = sorted(by_program[program], key=lambda r: -r["count"])[:5]

    most_saved = (
        db.session.query(WishlistItem.course_code, func.count(WishlistItem.id))
        .group_by(WishlistItem.course_code)
        .order_by(func.count(WishlistItem.id).desc())
        .limit(15)
        .all()
    )

    flagged: dict[str, dict] = {}
    for code, name, status, n in db.session.query(
        Flag.course_code, Flag.course_name, Flag.status, func.count(Flag.id)
    ).group_by(Flag.course_code, Flag.course_name, Flag.status):
        row = flagged.setdefault(code, {"course_code": code, "course_name": name, "total": 0, "open": 0})
        row["total"] += n
        if status in ("pending", "reviewed"):
            row["open"] += n
    most_flagged = sorted(flagged.values(), key=lambda r: (-r["total"], r["course_code"]))[:10]

    students_by_program = dict(
        db.session.query(func.coalesce(User.primary_program, "none"), func.count(User.id))
        .filter(User.role == "student")
        .group_by(func.coalesce(User.primary_program, "none"))
        .all()
    )

    # Sign-ups per week for the last 12 weeks, oldest first.
    now = datetime.now(timezone.utc)
    start = now - timedelta(weeks=12)
    weeks = [0] * 12
    for (created,) in db.session.query(User.created_at).filter(User.created_at >= start):
        created = _as_utc(created)
        idx = min(11, max(0, (created - start).days // 7))
        weeks[idx] += 1

    # Newest first, as in the app's semester picker.
    semesters = sorted(
        (s for (s,) in db.session.query(CourseSearchCount.semester_code).distinct().order_by(CourseSearchCount.semester_code)),
        key=semester_rank, reverse=True,
    )

    return jsonify(
        semester=semester,
        semesters=semesters,
        top_lookups=[{"course_code": c, "count": int(n)} for c, n in top_lookups],
        lookups_by_program=by_program,
        most_saved=[{"course_code": c, "count": n} for c, n in most_saved],
        most_flagged=most_flagged,
        students_by_program=students_by_program,
        signups_by_week={
            "start": start.date().isoformat(),
            "counts": weeks,
        },
    )


# ── Sign-in analytics ────────────────────────────────────────
SIGN_IN_WINDOWS = (7, 30, 90)


def _window_days(n: int, end: datetime | None = None) -> list[str]:
    """The last n CMU-Q calendar days ending today (or `end`), oldest first."""
    end_day = datetime.fromisoformat(local_day(end)).date()
    return [(end_day - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def _active_user_ids(days: list[str]) -> set[int]:
    if not days:
        return set()
    rows = db.session.query(UserActivityDay.user_id).filter(
        UserActivityDay.day >= days[0], UserActivityDay.day <= days[-1]
    ).distinct()
    return {uid for (uid,) in rows}


@bp.route("/sign-ins", methods=["GET"])
@require_role_group(ROLE_GROUP_ADMIN)
def sign_ins():
    """Who used CountsFor in the last 7, 30 or 90 days, and how.

    "Active" means the person signed in or opened CountsFor with a saved
    session at least once in the window (sessions last 30 days, so counting
    only fresh sign-ins would miss most returning users).
    """
    try:
        n = int(request.args.get("days", 7))
    except ValueError:
        n = 7
    if n not in SIGN_IN_WINDOWS:
        n = 7

    days = _window_days(n)
    prev_days = _window_days(n, datetime.fromisoformat(days[0]).replace(tzinfo=LOCAL_TZ) - timedelta(days=1))
    start_utc = datetime.fromisoformat(days[0]).replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)

    rows = db.session.query(UserActivityDay).filter(
        UserActivityDay.day >= prev_days[0], UserActivityDay.day <= days[-1]
    ).all()
    in_window = [r for r in rows if r.day >= days[0]]
    prev_ids = {r.user_id for r in rows if r.day < days[0]}

    per_user: dict[int, dict] = {}
    daily = {d: {"day": d, "users": 0, "sign_ins": 0, "visits": 0} for d in days}
    for r in in_window:
        bucket = daily.get(r.day)
        if bucket is not None:
            bucket["users"] += 1
            bucket["sign_ins"] += r.sign_ins or 0
            bucket["visits"] += r.visits or 0
        pu = per_user.setdefault(r.user_id, {"days_active": 0, "sign_ins": 0, "visits": 0, "last_seen": None, "first_seen": None})
        pu["days_active"] += 1
        pu["sign_ins"] += r.sign_ins or 0
        pu["visits"] += r.visits or 0
        last, first = _as_utc(r.last_seen), _as_utc(r.first_seen)
        if last and (pu["last_seen"] is None or last > pu["last_seen"]):
            pu["last_seen"] = last
        if first and (pu["first_seen"] is None or first < pu["first_seen"]):
            pu["first_seen"] = first

    events = db.session.query(SignInEvent.method, SignInEvent.created_at, SignInEvent.user_id).filter(
        SignInEvent.created_at >= start_utc
    ).all()
    by_method: dict[str, int] = {}
    by_hour = [0] * 24
    last_method: dict[int, tuple[datetime, str]] = {}
    for method, created, uid in events:
        by_method[method] = by_method.get(method, 0) + 1
        created = _as_utc(created)
        if method != "before_tracking":
            by_hour[created.astimezone(LOCAL_TZ).hour] += 1
        if uid not in last_method or created > last_method[uid][0]:
            last_method[uid] = (created, method)

    users = {u.id: u for u in db.session.query(User).filter(User.id.in_(list(per_user))).all()} if per_user else {}
    total_accounts = db.session.query(func.count(User.id)).scalar() or 0

    by_group = {"student": 0, "faculty": 0, "admin": 0}
    by_program: dict[str, int] = {}
    people = []
    new_accounts = 0
    for uid, stats in per_user.items():
        u = users.get(uid)
        if u is None:
            continue
        group = u.role_group()
        by_group[group] = by_group.get(group, 0) + 1
        prog = u.primary_program or "none"
        by_program[prog] = by_program.get(prog, 0) + 1
        created = _as_utc(u.created_at)
        is_new = bool(created and created >= start_utc)
        new_accounts += is_new
        people.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "role_group": group,
            "primary_program": u.primary_program,
            "days_active": stats["days_active"],
            "sign_ins": stats["sign_ins"],
            "visits": stats["visits"],
            "last_seen": stats["last_seen"].isoformat() if stats["last_seen"] else None,
            "last_method": last_method.get(uid, (None, None))[1],
            "is_new": is_new,
            "returning": uid in prev_ids,
            "created_at": created.isoformat() if created else None,
        })
    people.sort(key=lambda p: p["last_seen"] or "", reverse=True)

    active = len(people)
    first_event = db.session.query(func.min(SignInEvent.created_at)).filter(
        SignInEvent.method != "before_tracking"
    ).scalar()
    return jsonify(
        days=n,
        windows=list(SIGN_IN_WINDOWS),
        start=days[0],
        end=days[-1],
        timezone="Asia/Qatar (UTC+3)",
        tracking_since=_as_utc(first_event).isoformat() if first_event else None,
        totals={
            "active_users": active,
            "total_accounts": total_accounts,
            "sign_ins": sum(d["sign_ins"] for d in daily.values()),
            "visits": sum(d["visits"] for d in daily.values()),
            "returning": sum(1 for p in people if p["returning"]),
            "new_accounts": new_accounts,
            "avg_days_active": round(sum(p["days_active"] for p in people) / active, 1) if active else 0,
        },
        previous={
            "start": prev_days[0],
            "end": prev_days[-1],
            "active_users": len(prev_ids),
        },
        daily=list(daily.values()),
        by_group=by_group,
        by_program=by_program,
        by_method=by_method,
        by_hour=by_hour,
        users=people,
    )


@bp.route("/activity", methods=["GET"])
@require_role_group(ROLE_GROUP_ADMIN)
def activity():
    limit = _limit(50, 200)
    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    q = db.session.query(AdminAuditEvent)
    action = (request.args.get("action") or "").strip()
    if action:
        q = q.filter(AdminAuditEvent.action.like(action.rstrip("*") + "%"))
    total = q.count()
    rows = (
        q.order_by(AdminAuditEvent.created_at.desc(), AdminAuditEvent.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    return jsonify(total=total, page=page, limit=limit, items=[r.to_dict() for r in rows])

