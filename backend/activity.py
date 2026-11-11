"""Usage tracking for the admin sign-in analytics.

Two writers:
  * mark_signed_in(user, method)  called by every sign-in route in auth.py
  * record_visit(user)            called by GET /api/me (each app load)

Both only touch `sign_in_events` and `user_activity_days`. Neither may ever
break sign-in or /api/me: visit tracking swallows its own errors.

Days are bucketed in CMU-Q local time (Asia/Qatar is UTC+3 all year, no DST),
so "today" on the admin page matches the calendar day people in Doha see.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import SQLAlchemyError

from .db import db
from .models import SignInEvent, User, UserActivityDay

log = logging.getLogger(__name__)

LOCAL_TZ = timezone(timedelta(hours=3), name="AST")  # Asia/Qatar, no daylight saving


def local_day(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ).date().isoformat()


def _day_row(user_id: int, day: str, now: datetime) -> UserActivityDay:
    row = (
        db.session.query(UserActivityDay)
        .filter_by(user_id=user_id, day=day)
        .one_or_none()
    )
    if row is None:
        row = UserActivityDay(user_id=user_id, day=day, visits=0, sign_ins=0, first_seen=now, last_seen=now)
        db.session.add(row)
    return row


def mark_signed_in(user: User, method: str) -> None:
    """Stamp last_login and log the sign-in. The caller commits."""
    now = datetime.now(timezone.utc)
    user.last_login = now
    if user.id is None:
        db.session.flush()
    db.session.add(SignInEvent(user_id=user.id, method=method, created_at=now))
    row = _day_row(user.id, local_day(now), now)
    row.sign_ins = (row.sign_ins or 0) + 1
    row.last_seen = now


def record_visit(user: User) -> None:
    """Count one app load for a signed-in user. Never raises."""
    if not user or user.id is None:
        return
    now = datetime.now(timezone.utc)
    try:
        row = _day_row(user.id, local_day(now), now)
        row.visits = (row.visits or 0) + 1
        row.last_seen = now
        db.session.commit()
    except SQLAlchemyError as exc:  # e.g. two tabs creating today's row at once
        db.session.rollback()
        log.warning("record_visit failed for user %s: %s", user.id, exc)
