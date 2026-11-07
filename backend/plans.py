"""Schedule plan API — list, share by email, and share-by-link import."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from .cmu import normalize_cmu_email
from .db import db
from .models import SchedulePlan, SchedulePlanItem, SchedulePlanShareToken, User
from .permissions import require_login


bp = Blueprint("plans", __name__, url_prefix="/api/plans")

SHARE_LINK_DAYS = 30
SHARE_LINK_MAX_USES = 20


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_share_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _normalize_items(raw_items: list | None) -> list[dict]:
    items: list[dict] = []
    if not isinstance(raw_items, list):
        return items
    for row in raw_items:
        if not isinstance(row, dict):
            continue
        course_code = (row.get("course_code") or "").strip()
        if not course_code:
            continue
        offering_id = (row.get("id") or "").strip()
        if not offering_id:
            offering_id = "::".join([
                course_code,
                (row.get("semester_code") or "").strip(),
                (row.get("section") or "").strip(),
                (row.get("campus") or "").strip(),
                (row.get("days_times") or "TBA").strip(),
            ])
        items.append({
            "offering_id": offering_id,
            "course_code": course_code,
            "semester_code": (row.get("semester_code") or "").strip(),
            "section": (row.get("section") or "").strip(),
            "campus": (row.get("campus") or "").strip(),
            "days_times": (row.get("days_times") or "TBA").strip() or "TBA",
            "modality": (row.get("modality") or "").strip(),
        })
    return items


def _new_plan_id() -> str:
    return f"plan-{secrets.token_hex(8)}"


def _create_plan_for_user(
    user: User,
    name: str,
    items: list[dict],
    *,
    shared_from: User | None = None,
) -> SchedulePlan:
    plan = SchedulePlan(
        id=_new_plan_id(),
        user_id=user.id,
        name=name.strip() or "Shared schedule",
        shared_from_user_id=shared_from.id if shared_from else None,
        shared_from_name=shared_from.name if shared_from else None,
        shared_from_email=shared_from.email if shared_from else None,
    )
    db.session.add(plan)
    for item in items:
        db.session.add(SchedulePlanItem(
            plan_id=plan.id,
            offering_id=item["offering_id"],
            course_code=item["course_code"],
            semester_code=item["semester_code"],
            section=item["section"],
            campus=item["campus"],
            days_times=item["days_times"],
            modality=item["modality"],
        ))
    db.session.commit()
    db.session.refresh(plan)
    return plan


def _plan_payload(plan: SchedulePlan) -> dict:
    return plan.to_dict()


@bp.route("", methods=["GET"])
@require_login
def list_plans():
    """All schedule plans for the signed-in user (including shared copies)."""
    rows = (
        db.session.query(SchedulePlan)
        .filter_by(user_id=g.user.id)
        .order_by(SchedulePlan.updated_at.desc())
        .all()
    )
    return jsonify(plans=[_plan_payload(p) for p in rows])


@bp.route("/share", methods=["POST"])
@require_login
def share_plan_by_email():
    """Copy a schedule snapshot to another CountsFor user's library."""
    data = request.get_json(silent=True) or {}
    raw_recipient = (data.get("recipient_email") or "").strip().lower()
    # Accounts are stored as name@andrew.cmu.edu, so map the cmu.edu and
    # qatar.cmu.edu aliases to it before the lookup.
    recipient_email = normalize_cmu_email(raw_recipient) or raw_recipient
    name = (data.get("name") or "").strip() or "Shared schedule"
    items = _normalize_items(data.get("items"))

    if not recipient_email:
        return jsonify(error="missing_email", message="Recipient email is required."), 400
    if not items:
        return jsonify(error="empty_plan", message="This schedule has no sections to share."), 400

    recipient = (
        db.session.query(User)
        .filter(db.func.lower(User.email) == recipient_email)
        .one_or_none()
    )
    if not recipient:
        return jsonify(
            error="recipient_not_found",
            message="No CountsFor account found for that email. They need to sign up first.",
        ), 404
    if recipient.id == g.user.id:
        return jsonify(error="self_share", message="You cannot share a schedule with yourself."), 400

    shared_name = f"From {g.user.name}: {name}"
    plan = _create_plan_for_user(recipient, shared_name, items, shared_from=g.user)
    return jsonify(
        ok=True,
        recipient_name=recipient.name,
        recipient_email=recipient.email,
        plan_id=plan.id,
    ), 201


@bp.route("/share-link", methods=["POST"])
@require_login
def create_share_link():
    """Create a link anyone can use to import this schedule into their account."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip() or "Shared schedule"
    items = _normalize_items(data.get("items"))
    if not items:
        return jsonify(error="empty_plan", message="This schedule has no sections to share."), 400

    raw_token = secrets.token_urlsafe(24)
    row = SchedulePlanShareToken(
        token_hash=_hash_share_token(raw_token),
        plan_name=name,
        plan_items_json=json.dumps(items),
        created_by_id=g.user.id,
        created_by_name=g.user.name,
        created_by_email=g.user.email,
        expires_at=_utcnow() + timedelta(days=SHARE_LINK_DAYS),
        max_uses=SHARE_LINK_MAX_USES,
    )
    db.session.add(row)
    db.session.commit()
    return jsonify(
        token=raw_token,
        expires_in_days=SHARE_LINK_DAYS,
        max_uses=SHARE_LINK_MAX_USES,
    ), 201


@bp.route("/accept-share", methods=["POST"])
@require_login
def accept_share_link():
    """Import a schedule from a share link into the current user's library."""
    data = request.get_json(silent=True) or {}
    raw_token = (data.get("token") or "").strip()
    if not raw_token:
        return jsonify(error="missing_token", message="Share link token is required."), 400

    token_hash = _hash_share_token(raw_token)
    row = (
        db.session.query(SchedulePlanShareToken)
        .filter_by(token_hash=token_hash)
        .one_or_none()
    )
    if not row:
        return jsonify(error="invalid_token", message="This share link is invalid or expired."), 404

    now = _utcnow()
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        return jsonify(error="expired_token", message="This share link has expired."), 410
    if row.use_count >= row.max_uses:
        return jsonify(error="link_exhausted", message="This share link has reached its use limit."), 410

    try:
        items = json.loads(row.plan_items_json)
    except json.JSONDecodeError:
        return jsonify(error="corrupt_token", message="This share link is corrupted."), 500
    normalized = _normalize_items(items)
    if not normalized:
        return jsonify(error="empty_plan", message="This shared schedule has no sections."), 400

    sharer = db.session.get(User, row.created_by_id)
    shared_name = f"From {row.created_by_name}: {row.plan_name}"
    plan = _create_plan_for_user(
        g.user,
        shared_name,
        normalized,
        shared_from=sharer,
    )
    row.use_count += 1
    db.session.commit()
    return jsonify(plan=_plan_payload(plan)), 201
