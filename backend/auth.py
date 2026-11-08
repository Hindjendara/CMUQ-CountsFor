"""Auth routes: Google Sign-In, logout, /api/me.

Frontend posts the Google ID token (JWT from Google Identity Services) to
/api/auth/google. We verify it, upsert the user, and set a signed session
cookie. Subsequent requests carry the cookie automatically (with CORS
`credentials: 'include'`).
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from .activity import mark_signed_in, record_visit
from .cmu import email_in_domain, normalize_cmu_email
from .directory import resolve_directory_entry
from .db import db
from .email_util import send_password_reset_email
from .models import PasswordResetToken, User, UserMinor, VALID_DEPARTMENTS, FACULTY_ROLES
from .permissions import require_login, current_user
from .tokens import make_auth_token


bp = Blueprint("auth", __name__, url_prefix="/api")

MIN_PASSWORD_LEN = 8
GENERIC_RESET_MESSAGE = "If an account exists for that email, a reset link has been sent."


def _hash_password(password: str) -> str:
    return generate_password_hash(password)


def _password_ok(user: User, password: str) -> bool:
    if not user.password_hash:
        return False
    return check_password_hash(user.password_hash, password)


def _validate_password(password: str) -> str | None:
    if not password or len(password) < MIN_PASSWORD_LEN:
        return f"Password must be at least {MIN_PASSWORD_LEN} characters."
    return None


def _hash_reset_token(raw_token: str) -> str:
    """Deterministic SHA-256 so we can look up by raw token without storing it."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _reset_token_ttl() -> timedelta:
    minutes = int(current_app.config.get("RESET_TOKEN_MINUTES") or 30)
    return timedelta(minutes=minutes)


def _frontend_reset_url(raw_token: str) -> str:
    """Build the link emailed to the user: FRONTEND_RESET_BASE?token=..."""
    configured = (current_app.config.get("FRONTEND_RESET_BASE") or "").strip()
    if configured:
        base = configured.rstrip("/")
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}token={raw_token}"
    origins = current_app.config.get("FRONTEND_ORIGINS") or []
    origin = (origins[0] if origins else "http://localhost:8765").rstrip("/")
    return f"{origin}/index.html?token={raw_token}"


def _email_provider_configured(cfg) -> bool:
    """True when Resend or SMTP is configured enough to send mail.

    Resend needs RESEND_API_KEY and MAIL_FROM. SMTP needs SMTP_HOST and a sender:
    MAIL_FROM, or SMTP_USER (email_util uses it as the From address when MAIL_FROM
    is unset). SMTP_USER/SMTP_PASS are optional because an unauthenticated campus
    relay accepts mail without a login (email_util only logs in when SMTP_USER is set).
    """
    mail_from = (cfg.get("MAIL_FROM") or "").strip()
    if (cfg.get("RESEND_API_KEY") or "").strip() and mail_from:
        return True
    host = (cfg.get("SMTP_HOST") or "").strip()
    user = (cfg.get("SMTP_USER") or "").strip()
    return bool(host and (mail_from or user))


def _invalidate_reset_tokens(user_id: int) -> None:
    db.session.query(PasswordResetToken).filter_by(user_id=user_id, used=False).update(
        {"used": True}, synchronize_session=False
    )


def _create_reset_token(user: User) -> str:
    """Store hashed token; return raw token for email/dev exposure."""
    _invalidate_reset_tokens(user.id)
    raw_token = secrets.token_urlsafe(32)
    row = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=datetime.now(timezone.utc) + _reset_token_ttl(),
        used=False,
    )
    db.session.add(row)
    db.session.commit()
    return raw_token


def _find_valid_reset_token(raw_token: str) -> PasswordResetToken | None:
    if not raw_token:
        return None
    token_hash = _hash_reset_token(raw_token.strip())
    row = (
        db.session.query(PasswordResetToken)
        .filter_by(token_hash=token_hash, used=False)
        .one_or_none()
    )
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    return row


def _finalize_user(user: User, email: str, method: str = "password") -> User:
    """Apply directory/admin rules and mark profile complete when ready."""
    _sync_directory_profile(user, email)
    mark_signed_in(user, method)
    if user.profile_is_complete():
        user.profile_completed = True
    db.session.commit()
    return user


def _sync_directory_profile(user: User, email: str) -> None:
    """Resolve role from directory_entries (DB first), then JSON seed, else student.

    Admin is granted ONLY by directory role=admin (not ADMIN_EMAILS env).
    """
    entry = resolve_directory_entry(email)
    if entry:
        _apply_seed(user, entry)
    else:
        user.role = "student"
        user.is_admin = False
        user.advisor_scope = None
        user.minors.clear()
        user.minor_code = None
        user.sync_minor_code_legacy()


def _create_user_with_password(email: str, name: str, password: str) -> User:
    user = User(
        email=email,
        name=name,
        role="student",
        password_hash=_hash_password(password),
    )
    db.session.add(user)
    db.session.flush()
    if not user.password_hash:
        raise RuntimeError("password_hash was not set during registration")
    return _finalize_user(user, email, method="register")


MAJOR_MINOR_COLLISION = {"CS": "cs", "BA": "business", "BS": "biology"}


def _sync_user_minors(user: User, minor_codes: list[str] | None, *, role: str) -> str | None:
    """Replace student minors list. Returns error message or None."""
    if minor_codes is None:
        return None
    if role != "student":
        if minor_codes:
            return "Only students may declare minors."
        user.minors.clear()
        user.sync_minor_code_legacy()
        return None
    seen: set[str] = set()
    unique: list[str] = []
    for mc in minor_codes:
        if not mc or mc in seen:
            continue
        seen.add(mc)
        unique.append(mc)
    for mc in unique:
        if mc not in VALID_MINORS_FOR_PATCH:
            return f"Unknown minor_code: {mc}."
    pp = user.primary_program
    if pp in MAJOR_MINOR_COLLISION and MAJOR_MINOR_COLLISION[pp] in unique:
        return "Minor cannot match your major field."
    user.minors.clear()
    for mc in unique:
        user.minors.append(UserMinor(minor_code=mc))
    user.sync_minor_code_legacy()
    return None


def _minor_codes_for_validation(data: dict, user: User) -> list[str]:
    if "minor_codes" in data:
        raw = data["minor_codes"]
        if raw is None:
            return []
        if not isinstance(raw, list):
            return []
        return [str(c).strip() for c in raw if c]
    if "minor_code" in data:
        mc = data["minor_code"]
        return [mc] if mc else []
    return user.minor_codes_list()


def _apply_seed(user: User, seed: dict) -> None:
    """Merge directory row into user. Admin only when directory role is admin."""
    role = (seed.get("role") or "professor").strip().lower()
    if role == "student":
        user.role = "student"
        user.is_admin = False
        return
    user.role = role
    user.is_admin = role == "admin"
    for field in ("name", "primary_program", "department", "department_scope"):
        if seed.get(field):
            setattr(user, field, seed[field])
    user.advisor_scope = None
    user.minors.clear()
    user.minor_code = None
    user.sync_minor_code_legacy()
    pic = seed.get("picture_url")
    if pic:
        user.picture_url = pic


def _write_session(user: User) -> None:
    session.permanent = True
    session["uid"] = user.id
    session["email"] = user.email
    session["name"] = user.name
    session["role"] = user.role
    session["role_group"] = user.role_group()
    session["primary_program"] = user.primary_program
    session["minor_code"] = user.minor_code
    session["is_admin"] = user.is_admin
    session.modified = True


def _auth_payload(user: User) -> dict:
    """Public user dict plus the bearer token the frontend stores (see tokens.py)."""
    body = user.to_public_dict()
    body["auth_token"] = make_auth_token(user.id)
    return body


def _email_allowed(email: str) -> bool:
    return email_in_domain(email, current_app.config.get("ALLOWED_EMAIL_DOMAIN"))


def _upsert_user_from_login(
    email: str,
    name: str,
    google_sub: str | None = None,
    picture_url: str | None = None,
    method: str = "google",
) -> User:
    """Find or create a user, apply seed/admin rules, mark profile complete when ready."""
    user = (
        db.session.query(User).filter_by(google_sub=google_sub).one_or_none()
        if google_sub
        else None
    )
    if user is None:
        user = db.session.query(User).filter_by(email=email).one_or_none()

    if user is None:
        user = User(
            email=email,
            name=name,
            google_sub=google_sub,
            role="student",
        )
        db.session.add(user)
    else:
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if not user.name and name:
            user.name = name
    if picture_url:
        user.picture_url = picture_url

    _sync_directory_profile(user, email)

    mark_signed_in(user, method)
    if user.profile_is_complete():
        user.profile_completed = True

    db.session.commit()
    return user


# ── Register / login / password reset ────────────────────────
@bp.route("/auth/register", methods=["POST"])
def register():
    """Create an account with @andrew.cmu.edu email and password."""
    data = request.get_json(silent=True) or {}
    email = normalize_cmu_email(data.get("email") or "")
    if not email:
        return jsonify(
            error="invalid_email",
            message="Use your @andrew.cmu.edu email to create an account.",
        ), 400
    if not _email_allowed(email):
        allowed_domain = current_app.config.get("ALLOWED_EMAIL_DOMAIN") or "andrew.cmu.edu"
        return jsonify(error="domain_not_allowed", message=f"Only {allowed_domain} accounts are allowed."), 403

    password = data.get("password") or ""
    err = _validate_password(password)
    if err:
        return jsonify(error="weak_password", message=err), 400

    confirm = data.get("confirm_password") or password
    if password != confirm:
        return jsonify(error="password_mismatch", message="Passwords do not match."), 400

    existing = db.session.query(User).filter_by(email=email).one_or_none()
    if existing:
        if existing.password_hash:
            return jsonify(error="email_taken", message="An account with this email already exists. Sign in instead."), 409
        existing.password_hash = _hash_password(password)
        if not existing.name:
            existing.name = (data.get("name") or "").strip() or email.split("@", 1)[0].replace(".", " ").title()
        user = _finalize_user(existing, email, method="register")
    else:
        name = (data.get("name") or "").strip() or email.split("@", 1)[0].replace(".", " ").title()
        user = _create_user_with_password(email, name, password)

    if not user.password_hash:
        return jsonify(error="server_error", message="Account could not be created. Try again."), 500

    # Ensure password_hash is persisted before returning (register must survive re-login).
    db.session.refresh(user)
    if not user.password_hash:
        return jsonify(error="server_error", message="Account could not be saved. Try again."), 500

    _write_session(user)
    return jsonify(_auth_payload(user)), 201


@bp.route("/auth/login", methods=["POST"])
def login():
    """Sign in with @andrew.cmu.edu email and password."""
    data = request.get_json(silent=True) or {}
    email = normalize_cmu_email(data.get("email") or "")
    password = data.get("password") or ""
    if not email:
        return jsonify(error="invalid_email", message="Enter your @andrew.cmu.edu email."), 400
    if not password:
        return jsonify(error="missing_password", message="Enter your password."), 400

    user = db.session.query(User).filter_by(email=email).one_or_none()
    if user is None:
        return jsonify(error="invalid_credentials", message="Email or password is incorrect."), 401
    if not user.password_hash:
        if user.google_sub:
            return jsonify(
                error="no_password_set",
                message=(
                    "This account uses Google sign-in. Use Continue with Google, "
                    "or open Create account to set a password for this email."
                ),
            ), 401
        return jsonify(
            error="no_password_set",
            message=(
                "No password is saved for this email yet. Open Create account to set one, "
                "then sign in with that password."
            ),
        ), 401
    if not _password_ok(user, password):
        return jsonify(error="invalid_credentials", message="Email or password is incorrect."), 401

    user = _finalize_user(user, email)
    _write_session(user)
    return jsonify(_auth_payload(user))


@bp.route("/auth/forgot-password", methods=["POST"])
def forgot_password():
    """Start a password reset. Returns a token in dev when EXPOSE_RESET_TOKEN=1."""
    data = request.get_json(silent=True) or {}
    email = normalize_cmu_email(data.get("email") or "")
    if not email:
        return jsonify(error="invalid_email", message="Enter your @andrew.cmu.edu email."), 400

    # No email provider configured and no dev token exposure → be honest
    # instead of claiming a mail was sent. Returned for ANY email (existing
    # or not) so it never reveals whether an account exists. The frontend
    # steers the user to Google recovery instead.
    cfg = current_app.config
    expose = os.environ.get("EXPOSE_RESET_TOKEN", "").lower() in ("1", "true", "yes")
    if not _email_provider_configured(cfg) and not expose:
        return jsonify(
            error="email_unavailable",
            google_recovery=True,
            message="Password reset by email isn't available yet. Use Continue with Google below.",
        ), 503

    payload = {"ok": True, "message": GENERIC_RESET_MESSAGE}
    user = db.session.query(User).filter_by(email=email).one_or_none()
    if user is not None:
        raw_token = _create_reset_token(user)
        reset_url = _frontend_reset_url(raw_token)
        sent = send_password_reset_email(email, reset_url)
        if not sent and not expose:
            return jsonify(
                error="email_failed",
                google_recovery=True,
                message="We couldn't send the reset email right now. Try again in a few minutes, or use Continue with Google below.",
            ), 502

        if expose:
            payload["reset_token"] = raw_token
            payload["reset_url"] = reset_url
            payload["email"] = email

    return jsonify(payload)


@bp.route("/auth/reset-password", methods=["POST"])
def reset_password():
    """Set a new password using the token from the reset email."""
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    password = data.get("password") or ""
    if not token:
        return jsonify(error="missing_fields", message="Reset token is required."), 400
    err = _validate_password(password)
    if err:
        return jsonify(error="weak_password", message=err), 400

    row = _find_valid_reset_token(token)
    if row is None:
        return jsonify(error="invalid_token", message="This reset link is invalid or has expired."), 400

    user = db.session.get(User, row.user_id)
    if user is None:
        return jsonify(error="invalid_token", message="This reset link is invalid or has expired."), 400

    user.password_hash = _hash_password(password)
    _invalidate_reset_tokens(user.id)
    db.session.commit()
    return jsonify(ok=True, message="Password updated. You can sign in now.")


@bp.route("/auth/set-password", methods=["POST"])
@require_login
def set_password():
    """Set/replace the signed-in user's password without a reset token.

    Used by the Google-based recovery flow: signing in with Google already
    proves ownership of the @andrew.cmu.edu address, so no emailed token is
    needed. Works even when no email provider is configured.
    """
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    err = _validate_password(password)
    if err:
        return jsonify(error="weak_password", message=err), 400

    user = current_user()
    user.password_hash = _hash_password(password)
    _invalidate_reset_tokens(user.id)
    db.session.commit()
    return jsonify(ok=True, message="Password set. You can sign in with it next time.")


# ── Google Sign-In ───────────────────────────────────────────
@bp.route("/auth/google", methods=["POST"])
def google_signin():
    """Body: { "credential": "<Google ID token JWT>" }
    Verifies the token, finds/creates the user, sets the session cookie.
    Returns the user object (same shape as /api/me)."""
    data = request.get_json(silent=True) or {}
    token = data.get("credential")
    if not token:
        return jsonify(error="missing_credential", message="Google credential token required."), 400

    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return jsonify(
            error="server_misconfigured",
            message="GOOGLE_CLIENT_ID not set on the server.",
        ), 500

    # Verify the JWT was signed by Google and is intended for our client.
    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
    except ValueError as e:
        return jsonify(error="invalid_token", message=str(e)), 401

    email = normalize_cmu_email(info.get("email") or "")
    if not email or not info.get("email_verified"):
        return jsonify(error="email_unverified", message="Google account email is not verified."), 401

    if not _email_allowed(email):
        allowed_domain = current_app.config.get("ALLOWED_EMAIL_DOMAIN") or "andrew.cmu.edu"
        return jsonify(
            error="domain_not_allowed",
            message=f"Only {allowed_domain} accounts are allowed.",
        ), 403

    google_sub = info.get("sub")
    name = info.get("name") or info.get("given_name") or email.split("@", 1)[0]
    picture = info.get("picture")
    user = _upsert_user_from_login(email, name, google_sub=google_sub, picture_url=picture)
    _write_session(user)
    return jsonify(_auth_payload(user))


# ── Logout ───────────────────────────────────────────────────
@bp.route("/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(ok=True)


# ── /api/me ──────────────────────────────────────────────────
@bp.route("/me", methods=["GET"])
def me():
    user = current_user()
    if not user:
        return jsonify(error="unauthenticated", message="Not signed in."), 401
    record_visit(user)
    return jsonify(_auth_payload(user))


# ── PATCH /api/me — profile completion / edit ────────────────
# Used after first signup to capture role + program. Admin role is directory-driven.
ALLOWED_PROFILE_FIELDS = {
    "name",
    "role",
    "primary_program",
    "minor_code",
    "minor_codes",
    "advisor_scope",
    "department_scope",
    "department",
}
# Roles an admin/area-head may assign to OTHERS via the user-management API
# (backend/users.py). Faculty roles are managed, not self-claimed.
USER_SETTABLE_ROLES = {"student", "professor", "area_head", "associate_area_head", "advisor"}

# Roles a user may set on THEMSELVES via PATCH /api/me. Self-service is
# student-only: faculty roles come from the seed file or an admin via
# users.py — never self-selection. Closes the privilege-escalation path
# where a student could PATCH themselves into a faculty role.
SELF_SETTABLE_ROLES = {"student"}


VALID_PROGRAMS_FOR_PATCH = {"CS", "IS", "BA", "BS", "AI", "GS", "AS"}
VALID_MINORS_FOR_PATCH = {
    "arabic", "biology", "business", "cs", "economics", "finance", "history",
    "math", "neuroscience", "product", "writing", "psychology", "sociology",
    "self_defined", "tech_entre",
}
VALID_ADVISOR_SCOPES = {"major", "minor", "arts_sciences", "all_programs"}


def _validate_consistent_profile(role, primary_program, minor_codes, advisor_scope, department):
    """Return None if the combination is internally consistent, else an error message."""
    minor_codes = minor_codes or []
    if role == "student":
        if not primary_program or primary_program not in VALID_PROGRAMS_FOR_PATCH - {"AS"}:
            return "Students must have a primary_program (CS/IS/BA/BS/AI/GS)."
        for mc in minor_codes:
            if mc not in VALID_MINORS_FOR_PATCH:
                return f"Unknown minor_code: {mc}."
            if primary_program in MAJOR_MINOR_COLLISION and MAJOR_MINOR_COLLISION[primary_program] == mc:
                return "Minor cannot match your major field."
        if advisor_scope:
            return "Students cannot have an advisor_scope."
        if department:
            return "Students do not use department."
        return None
    if role in FACULTY_ROLES or role == "admin":
        if minor_codes:
            return "Faculty cannot have minors."
        if advisor_scope:
            return "Faculty roles do not use advisor_scope."
        if not department or department not in VALID_DEPARTMENTS:
            return "Faculty must have a valid department."
        if not primary_program or primary_program not in VALID_PROGRAMS_FOR_PATCH:
            return "Faculty must have a valid program (primary_program)."
        return None
    return f"Unknown role: {role}."


@bp.route("/me", methods=["PATCH"])
@require_login
def update_me():
    from flask import g

    data = request.get_json(silent=True) or {}
    unknown = set(data.keys()) - ALLOWED_PROFILE_FIELDS
    if unknown:
        return jsonify(error="unknown_fields", message=f"Cannot update: {sorted(unknown)}"), 400

    user: User = g.user
    is_admin = user.role == "admin"

    # Compute what the user would look like AFTER applying the patch, then
    # validate cross-field consistency before any DB write.
    def _next(field, default):
        if field in data:
            v = data[field]
            return None if v == "" else v
        return default

    new_role            = _next("role", user.role)
    new_primary         = _next("primary_program", user.primary_program)
    new_advisor_scope   = _next("advisor_scope", user.advisor_scope)
    new_department      = _next("department", user.department)
    new_minor_codes     = _minor_codes_for_validation(data, user)
    if "minor_codes" in data and not isinstance(data["minor_codes"], list):
        return jsonify(error="invalid_minor_codes", message="minor_codes must be a list."), 400
    new_minor_single    = _next("minor_code", user.minor_code)

    if "role" in data:
        if is_admin:
            if new_role != "admin":
                return jsonify(
                    error="cannot_change_admin_role",
                    message="Admin role is managed via the directory panel.",
                ), 400
        else:
            if new_role not in SELF_SETTABLE_ROLES:
                return jsonify(error="invalid_role", message=f"You can't set your own role to '{new_role}'. Faculty roles are assigned by an admin."), 400

    validation_minors = new_minor_codes if new_role == "student" else []

    err = _validate_consistent_profile(new_role, new_primary, validation_minors, new_advisor_scope, new_department)
    if err:
        return jsonify(error="inconsistent_profile", message=err), 400

    # All checks passed — apply the patch.
    if "role" in data and not is_admin:
        user.role = new_role
    for field in ("name", "primary_program", "minor_code", "advisor_scope", "department_scope", "department"):
        if field in data:
            value = data[field]
            if value == "":
                value = None
            setattr(user, field, value)

    if new_role == "student":
        if "minor_codes" in data or "minor_code" in data:
            sync_err = _sync_user_minors(user, new_minor_codes, role=new_role)
            if sync_err:
                return jsonify(error="inconsistent_profile", message=sync_err), 400
    elif "minor_codes" in data or (new_role != "advisor" and "minor_code" in data):
        sync_err = _sync_user_minors(user, [], role=new_role)
        if sync_err:
            return jsonify(error="inconsistent_profile", message=sync_err), 400

    user.profile_completed = user.profile_is_complete()
    db.session.commit()
    _write_session(user)
    return jsonify(_auth_payload(user))
