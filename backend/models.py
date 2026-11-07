"""ORM models. Mirrors `schema.sql` so the doc and code stay in sync.

Field meanings live in `schema.sql`. Keep this file thin — business logic
belongs in route modules or permissions.py.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from sqlalchemy import (
    Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import db


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


VALID_ROLES = (
    "student",
    "professor",
    "area_head",
    "associate_area_head",
    "advisor",
    "admin",
)

# Faculty job titles (permission group "faculty"). Admin is separate.
FACULTY_ROLES = frozenset({"professor", "area_head", "associate_area_head", "advisor"})

# UI bucket for faculty-style app chrome (flags, directory tab). Includes admin.
FACULTY_UI_ROLES = FACULTY_ROLES | {"admin"}

FLAG_STATUSES = ("pending", "reviewed", "resolved", "dismissed")

VALID_DEPARTMENTS = (
    "Business Administration",
    "Mathematical and Physical Sciences (MPS)",
    "Humanities and Social Sciences (H&SS)",
    "Biological Sciences",
    "Computer Science",
    "Information Systems",
    "Dean's Office",
    "Education Office",
)


class User(db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    # Google SSO — no password column. If we ever add email+password, add
    # password_hash here as nullable so SSO users don't need a password.
    google_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reset_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="student", index=True)
    primary_program: Mapped[str | None] = mapped_column(String(8), nullable=True)
    minor_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    advisor_scope: Mapped[str | None] = mapped_column(String(32), nullable=True)
    department_scope: Mapped[str | None] = mapped_column(String(200), nullable=True)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    picture_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    profile_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    flags: Mapped[list["Flag"]] = relationship(back_populates="submitter", foreign_keys="Flag.submitted_by_id")
    wishlist: Mapped[list["WishlistItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    schedule_plans: Mapped[list["SchedulePlan"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", foreign_keys="SchedulePlan.user_id"
    )
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    minors: Mapped[list["UserMinor"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="UserMinor.id"
    )

    def minor_codes_list(self) -> list[str]:
        return [m.minor_code for m in self.minors]

    def sync_minor_code_legacy(self) -> None:
        """Keep nullable minor_code aligned with first minor for legacy clients."""
        codes = self.minor_codes_list()
        self.minor_code = codes[0] if len(codes) == 1 else None

    def role_group(self) -> str:
        """Permission bucket: student | faculty | admin."""
        if self.role == "admin":
            return "admin"
        if self.role in FACULTY_ROLES:
            return "faculty"
        return "student"

    def profile_is_complete(self) -> bool:
        if self.role_group() == "admin":
            return bool(self.department and self.primary_program)
        if self.role == "student":
            return bool(self.primary_program)
        if self.role_group() == "faculty":
            return bool(self.department and self.primary_program)
        return False

    def to_public_dict(self) -> dict:
        """Returned by /api/me — never expose google_sub or DB-internal ids
        to other users, but the owner can see their own."""
        codes = self.minor_codes_list()
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "role_group": self.role_group(),
            "primary_program": self.primary_program,
            "minor_code": self.minor_code,
            "minor_codes": codes,
            "advisor_scope": self.advisor_scope,
            "department_scope": self.department_scope,
            "department": self.department,
            "picture_url": self.picture_url,
            "is_admin": self.is_admin,
            "profile_completed": self.profile_completed,
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }


class UserMinor(db.Model):
    __tablename__ = "user_minors"
    __table_args__ = (UniqueConstraint("user_id", "minor_code", name="uq_user_minor_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    minor_code: Mapped[str] = mapped_column(String(32), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    user: Mapped[User] = relationship(back_populates="minors")


class DirectoryEntry(db.Model):
    """Editable directory layer (Postgres). JSON seed is static; DB wins on clash."""
    __tablename__ = "directory_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="professor")
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    primary_program: Mapped[str | None] = mapped_column(String(8), nullable=True)
    picture_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    added_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def to_merged_dict(self) -> dict:
        return {
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "department": self.department,
            "primary_program": self.primary_program,
            "picture_url": self.picture_url,
        }

    def to_public_dict(self, *, source: str = "db") -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "department": self.department,
            "primary_program": self.primary_program,
            "picture_url": self.picture_url,
            "source": source,
            "editable": True,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (Index("ix_password_reset_tokens_user_used", "user_id", "used"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    user: Mapped[User] = relationship(back_populates="password_reset_tokens")


class Flag(db.Model):
    __tablename__ = "flags"

    # String ID matches the frontend's existing localStorage scheme
    # ('flg-<base36ts>-<rand>') so a one-shot migration POSTs verbatim.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_code: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    reason_label: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Snapshot the submitter at submit time so the flag stays self-contained
    # if the user is later deleted or renamed.
    submitted_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    submitted_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    submitted_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    submitted_by_role: Mapped[str] = mapped_column(String(32), nullable=False)
    submitted_program: Mapped[str | None] = mapped_column(String(8), nullable=True)
    submitted_minor: Mapped[str | None] = mapped_column(String(32), nullable=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    submitter: Mapped[User | None] = relationship("User", foreign_keys=[submitted_by_id], back_populates="flags")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "course_code": self.course_code,
            "course_name": self.course_name,
            "reason_code": self.reason_code,
            "reason_label": self.reason_label,
            "notes": self.notes,
            "submitted_by_id": self.submitted_by_id,
            "submitted_by_name": self.submitted_by_name,
            "submitted_by_email": self.submitted_by_email,
            "submitted_by_role": self.submitted_by_role,
            "submitted_program": self.submitted_program,
            "submitted_minor": self.submitted_minor,
            "status": self.status,
            "admin_notes": self.admin_notes,
            "resolved_by": self.resolved_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class WishlistItem(db.Model):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        UniqueConstraint("user_id", "course_code", name="uq_user_course"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_code: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    user: Mapped[User] = relationship(back_populates="wishlist")

    def to_dict(self) -> dict:
        return {
            "course_code": self.course_code,
            "note": self.note,
            "added_at": self.added_at.isoformat() if self.added_at else None,
        }


class SchedulePlan(db.Model):
    """User schedule draft — synced across devices; share copies land here too."""
    __tablename__ = "schedule_plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    shared_from_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    shared_from_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shared_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    user: Mapped[User] = relationship(back_populates="schedule_plans", foreign_keys=[user_id])
    items: Mapped[list["SchedulePlanItem"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="SchedulePlanItem.id"
    )

    def to_dict(self) -> dict:
        shared_from = None
        if self.shared_from_name or self.shared_from_email:
            shared_from = {
                "name": self.shared_from_name,
                "email": self.shared_from_email,
            }
        return {
            "id": self.id,
            "name": self.name,
            "shared_from": shared_from,
            "items": [i.to_dict() for i in self.items],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SchedulePlanItem(db.Model):
    __tablename__ = "schedule_plan_items"
    __table_args__ = (
        UniqueConstraint("plan_id", "offering_id", name="uq_plan_offering"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("schedule_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offering_id: Mapped[str] = mapped_column(String(255), nullable=False)
    course_code: Mapped[str] = mapped_column(String(16), nullable=False)
    semester_code: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    section: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    campus: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    days_times: Mapped[str] = mapped_column(String(255), nullable=False, default="TBA")
    modality: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    plan: Mapped[SchedulePlan] = relationship(back_populates="items")

    def to_dict(self) -> dict:
        return {
            "id": self.offering_id,
            "course_code": self.course_code,
            "semester_code": self.semester_code,
            "section": self.section,
            "campus": self.campus,
            "days_times": self.days_times,
            "modality": self.modality,
        }


class SchedulePlanShareToken(db.Model):
    """One-time / limited-use link to import a schedule snapshot."""
    __tablename__ = "schedule_plan_share_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    plan_name: Mapped[str] = mapped_column(String(200), nullable=False)
    plan_items_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class CourseSearchCount(db.Model):
    """Aggregated course lookups by program + semester (student peer signal)."""
    __tablename__ = "course_search_counts"
    __table_args__ = (
        UniqueConstraint(
            "primary_program", "semester_code", "course_code",
            name="uq_search_count_program_sem_course",
        ),
        Index("ix_search_count_program_sem", "primary_program", "semester_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    primary_program: Mapped[str] = mapped_column(String(8), nullable=False)
    semester_code: Mapped[str] = mapped_column(String(8), nullable=False)
    course_code: Mapped[str] = mapped_column(String(16), nullable=False)
    search_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_searched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def to_dict(self) -> dict:
        return {
            "course_code": self.course_code,
            "search_count": self.search_count,
            "last_searched_at": self.last_searched_at.isoformat() if self.last_searched_at else None,
        }


class AdminAuditEvent(db.Model):
    """Who changed what: role edits, flag reviews and directory changes."""
    __tablename__ = "admin_audit_events"
    __table_args__ = (Index("ix_admin_audit_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Copied at write time so the log still reads correctly after an account is removed.
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON text
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    def to_dict(self) -> dict:
        try:
            details = json.loads(self.details) if self.details else {}
        except ValueError:
            details = {}
        return {
            "id": self.id,
            "actor_email": self.actor_email,
            "actor_name": self.actor_name,
            "action": self.action,
            "target": self.target,
            "details": details,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class CourseOverride(db.Model):
    """Admin edits layered over the scraped catalog (data/courses.json).

    The daily scrape rewrites the catalog file, so manual changes live here and
    the frontend applies them after loading it. One row per course, keyed by the
    catalog code (or the new code for a course an admin added).
    """
    __tablename__ = "course_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    is_new: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fields: Mapped[str | None] = mapped_column(Text, nullable=True)        # JSON: only the changed catalog fields
    requirements: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: full "counts for" map when edited
    updated_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def to_dict(self) -> dict:
        return {
            "course_code": self.course_code,
            "is_new": self.is_new,
            "archived": self.archived,
            "fields": json.loads(self.fields) if self.fields else {},
            "requirements": json.loads(self.requirements) if self.requirements else None,
            "updated_by_email": self.updated_by_email,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SignInEvent(db.Model):
    """One row per successful sign-in (Google, password, email link or new account).

    Feeds the admin "Signed in this week" analytics. Rows written before this
    table existed are backfilled from users.last_login with method "before_tracking".
    """
    __tablename__ = "sign_in_events"
    __table_args__ = (Index("ix_sign_in_events_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    method: Mapped[str] = mapped_column(String(24), nullable=False, default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class UserActivityDay(db.Model):
    """Per-user, per-day usage counter (CMU-Q local date).

    A session lasts 30 days, so most returning visits do not create a new
    sign-in. Each GET /api/me (every time a signed-in user opens CountsFor)
    bumps `visits`; each sign-in bumps `sign_ins`. One row per user per day
    keeps the table small enough to scan for any reporting window.
    """
    __tablename__ = "user_activity_days"
    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_user_activity_day"),
        Index("ix_user_activity_day", "day"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD in Qatar time
    visits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sign_ins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
