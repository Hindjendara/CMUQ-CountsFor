"""Auth routes: sign-in, logout, /api/me.

Two modes, chosen by AUTH_MODE (backend/config.py):

  password    email + password (register, login, forgot, reset, set-password)
              and Google Sign-In: the frontend posts the Google ID token (JWT
              from Google Identity Services) to /api/auth/google, which verifies it.
  shibboleth  CMU single sign-on only. Apache (mod_shib) protects
              GET /api/auth/shibboleth and passes the SAML attributes as request
              headers, together with a shared secret that proves the request came
              through that protected location. The password and Google routes
              answer 403 sso_only.

Every sign-in upserts the user, applies the directory role and sets a signed
session cookie; the JSON answers also carry a bearer `auth_token` (tokens.py).
GET /api/auth/methods tells the landing page which mode is on.
"""
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from urllib.parse import unquote

from flask import Blueprint, abort, current_app, jsonify, redirect, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from .activity import mark_signed_in, record_visit
from .cmu import andrew_email_from_input, email_in_domain, normalize_cmu_email
from .config import AUTH_MODES
from .directory import resolve_directory_entry
from .db import db
from .email_util import send_password_reset_email
from .models import PasswordResetToken, User, UserMinor, VALID_DEPARTMENTS, FACULTY_ROLES
from .permissions import require_login, current_user
from .tokens import make_auth_token


bp = Blueprint("auth", __name__, url_prefix="/api")
log = logging.getLogger(__name__)

MIN_PASSWORD_LEN = 8
GENERIC_RESET_MESSAGE = "If an account exists for that email, a reset link has been sent."

# Password registration is refused for faculty and staff emails (any directory
# role other than student): register cannot prove the person owns the address,
# and the directory would hand the new account that role at once. Google sign-in
# proves ownership, so they set a password through the Google recovery flow.
STAFF_REGISTER_MESSAGE = (
    "Faculty and staff set up their account with Google. "
    "Open Forgot password and use Continue with Google."
)
ACCOUNT_EXISTS_MESSAGE = (
    "An account already exists for this email. "
    "Open Forgot password to set a password, or use Continue with Google."
)

# ── CMU sign-in (Shibboleth) ─────────────────────────────────
SSO_LOGIN_PATH = "/api/auth/shibboleth"
# Set by Apache inside <Location /api/auth/shibboleth> only (deploy/countsfor.conf).
SSO_SECRET_HEADER = "X-CountsFor-SSO-Secret"
MIN_SSO_SECRET_LEN = 32
SSO_DEFAULT_NEXT = "/app.html"
SSO_LANDING = "/"
SSO_ONLY_MESSAGE = "Sign in with your Andrew ID."
MAX_NAME_LEN = 200  # users.name is VARCHAR(200)

# A path on this site: one leading "/", then only characters a URL may carry
# unescaped (no backslash, space, control character or "#").
_SITE_PATH_RE = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$")


def auth_mode() -> str:
    return (current_app.config.get("AUTH_MODE") or "password").strip().lower()


def is_site_path(value: str) -> bool:
    """True for a same-site relative path such as /app.html?share_plan=x.

    Refuses "//host" and "/\\host" (browsers read both as another host), any
    scheme, and the same tricks hidden behind percent-encoding (/%2F%2Fhost).
    """
    if not value or len(value) > 2048 or not _SITE_PATH_RE.match(value):
        return False
    decoded = unquote(value)
    return not (decoded.startswith("//") or decoded.startswith("/\\"))


def check_auth_settings(config) -> None:
    """Refuse to start with an unsafe sign-in setup. Called by create_app()."""
    mode = (config.get("AUTH_MODE") or "password").strip().lower()
    if mode not in AUTH_MODES:
        raise RuntimeError(f"AUTH_MODE must be password or shibboleth, got {mode!r}.")
    if mode != "shibboleth":
        return
    if len(config.get("SHIB_PROXY_SECRET") or "") < MIN_SSO_SECRET_LEN:
        raise RuntimeError(
            "AUTH_MODE=shibboleth needs SHIB_PROXY_SECRET: at least "
            f"{MIN_SSO_SECRET_LEN} characters, the same value Apache sends in "
            f"{SSO_SECRET_HEADER} (README 15.22). Refusing to start."
        )
    if not (config.get("SHIB_HEADER_EPPN") or config.get("SHIB_HEADER_MAIL")):
        raise RuntimeError("AUTH_MODE=shibboleth needs SHIB_HEADER_EPPN or SHIB_HEADER_MAIL.")
    if not is_site_path(config.get("SHIB_LOGOUT_URL") or ""):
        raise RuntimeError("SHIB_LOGOUT_URL must be a path on this site, starting with one '/'.")


def _password_mode_only(fn):
    """403 sso_only in shibboleth mode: the route belongs to password sign-in."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if auth_mode() == "shibboleth":
            return jsonify(error="sso_only", message=SSO_ONLY_MESSAGE), 403
        return fn(*args, **kwargs)
    return wrapper


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


# Minors a major may not declare: blocked_majors in frontend/data/minors.json
# (the minor in the student's own field, and for BA also the three other Tepper
# minors). MINOR_BLOCKED_MAJORS in frontend/js/profile.js holds the same rule.
MAJOR_MINOR_COLLISION = {
    "CS": frozenset({"cs"}),
    "BA": frozenset({"business", "business_analytics", "finance", "product"}),
    "BS": frozenset({"biology"}),
}
MINOR_BLOCKED_MESSAGE = "That minor is not open to students in your major."


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
    if MAJOR_MINOR_COLLISION.get(pp, frozenset()) & set(unique):
        return MINOR_BLOCKED_MESSAGE
    user.minors.clear()
    # Delete the old rows before inserting the new ones. Without this flush the
    # unit of work inserts first, and keeping a minor while adding another
    # broke the (user_id, minor_code) unique key with a 500.
    db.session.flush()
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
        # A name that is only the Andrew ID (CMU sign-in before the IdP released
        # names) gives way to the real one; a name the person has is kept.
        andrew_id = email.split("@", 1)[0]
        if name and (not user.name or (user.name == andrew_id and name != andrew_id)):
            user.name = name
    if picture_url:
        user.picture_url = picture_url

    _sync_directory_profile(user, email)

    mark_signed_in(user, method)
    if user.profile_is_complete():
        user.profile_completed = True

    db.session.commit()
    return user


def _is_staff_email(email: str) -> bool:
    """True when the directory gives this email any role other than student
    (a row without a role counts as professor, as in _apply_seed)."""
    entry = resolve_directory_entry(email)
    if not entry:
        return False
    return (entry.get("role") or "professor").strip().lower() != "student"


# ── Register / login / password reset ────────────────────────
@bp.route("/auth/register", methods=["POST"])
@_password_mode_only
def register():
    """Create an account with @andrew.cmu.edu email and password.

    Register cannot prove that the caller owns the address, so it only creates
    new student accounts: a faculty or staff email (403 staff_email) and an email
    that already has an account, with or without a password (409), are refused.
    Those people prove ownership with Google instead (Forgot password, Continue
    with Google, then set-password).
    """
    data = request.get_json(silent=True) or {}
    email = andrew_email_from_input(data.get("email") or "")
    if not email:
        return jsonify(
            error="invalid_email",
            message="Use your Andrew ID to create an account.",
        ), 400
    if not _email_allowed(email):
        allowed_domain = current_app.config.get("ALLOWED_EMAIL_DOMAIN") or "andrew.cmu.edu"
        return jsonify(error="domain_not_allowed", message=f"Only {allowed_domain} accounts are allowed."), 403

    if _is_staff_email(email):
        return jsonify(error="staff_email", message=STAFF_REGISTER_MESSAGE), 403

    existing = db.session.query(User).filter_by(email=email).one_or_none()
    if existing:
        if existing.password_hash:
            return jsonify(error="email_taken", message="An account with this email already exists. Sign in instead."), 409
        return jsonify(error="account_exists", message=ACCOUNT_EXISTS_MESSAGE), 409

    password = data.get("password") or ""
    err = _validate_password(password)
    if err:
        return jsonify(error="weak_password", message=err), 400

    confirm = data.get("confirm_password") or password
    if password != confirm:
        return jsonify(error="password_mismatch", message="Passwords do not match."), 400

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
@_password_mode_only
def login():
    """Sign in with @andrew.cmu.edu email and password."""
    data = request.get_json(silent=True) or {}
    email = andrew_email_from_input(data.get("email") or "")
    password = data.get("password") or ""
    if not email:
        return jsonify(error="invalid_email", message="Enter your Andrew ID."), 400
    if not password:
        return jsonify(error="missing_password", message="Enter your password."), 400

    user = db.session.query(User).filter_by(email=email).one_or_none()
    if user is None:
        return jsonify(error="invalid_credentials", message="Email or password is incorrect."), 401
    if not user.password_hash:
        # Create account no longer sets a password on an existing account (it
        # cannot prove ownership), so both cases point to Forgot password.
        if user.google_sub:
            return jsonify(
                error="no_password_set",
                message=(
                    "This account signs in with Google. Open Forgot password "
                    "and use Continue with Google to set a password."
                ),
            ), 401
        return jsonify(
            error="no_password_set",
            message="No password is set for this account yet. Open Forgot password to set one.",
        ), 401
    if not _password_ok(user, password):
        return jsonify(error="invalid_credentials", message="Email or password is incorrect."), 401

    user = _finalize_user(user, email)
    _write_session(user)
    return jsonify(_auth_payload(user))


@bp.route("/auth/forgot-password", methods=["POST"])
@_password_mode_only
def forgot_password():
    """Start a password reset. Returns a token in dev when EXPOSE_RESET_TOKEN=1
    (never in production: the token would let anyone reset any account)."""
    data = request.get_json(silent=True) or {}
    email = andrew_email_from_input(data.get("email") or "")
    if not email:
        return jsonify(error="invalid_email", message="Enter your Andrew ID."), 400

    # No email provider configured and no dev token exposure → be honest
    # instead of claiming a mail was sent. Returned for ANY email (existing
    # or not) so it never reveals whether an account exists. The frontend
    # steers the user to Google recovery instead.
    cfg = current_app.config
    expose = (not cfg.get("IS_PRODUCTION")
              and os.environ.get("EXPOSE_RESET_TOKEN", "").lower() in ("1", "true", "yes"))
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
@_password_mode_only
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
@_password_mode_only
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
@_password_mode_only
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


# ── CMU sign-in (Shibboleth) ─────────────────────────────────
def _utf8(value: str) -> str:
    """WSGI hands header values over as latin-1; mod_shib sends UTF-8 bytes."""
    try:
        return value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def _shib_attr(header: str | None) -> str:
    """First value of an attribute header, or "". mod_shib joins the values of a
    multi-valued attribute with ";" and escapes a ";" inside a value as "\\;"."""
    if not header:
        return ""
    raw = request.headers.get(header) or ""
    first = re.split(r"(?<!\\);", raw, maxsplit=1)[0].replace("\\;", ";")
    return _utf8(first).strip()


def _shib_name(email: str) -> str:
    cfg = current_app.config
    name = _shib_attr(cfg.get("SHIB_HEADER_DISPLAY_NAME"))
    if not name:
        parts = (_shib_attr(cfg.get("SHIB_HEADER_GIVEN_NAME")), _shib_attr(cfg.get("SHIB_HEADER_SURNAME")))
        name = " ".join(p for p in parts if p)
    name = " ".join(name.split())[:MAX_NAME_LEN]
    return name or email.split("@", 1)[0]


def _sso_next(raw: str | None) -> str:
    """Where to send the browser after CMU sign-in: `next` when it is a path on
    this site outside /api and /Shibboleth.sso, else /app.html."""
    value = raw or ""
    if not is_site_path(value):
        return SSO_DEFAULT_NEXT
    path = unquote(value.split("?", 1)[0]).lower()
    if path == "/api" or path.startswith("/api/") or path.startswith("/shibboleth.sso"):
        return SSO_DEFAULT_NEXT
    return value


def _sso_failed(code: str):
    """Back to the landing page, which explains the code (js/landing.js)."""
    return redirect(f"{SSO_LANDING}?sso_error={code}", code=302)


@bp.route("/auth/shibboleth", methods=["GET"])
def shibboleth_signin():
    """CMU single sign-on. Apache protects this path with mod_shib (a Shibboleth
    session is required) and passes the SAML attributes as request headers, plus
    SSO_SECRET_HEADER, which it sets only inside that protected location. A
    request without the right secret did not come through it, so its identity
    headers are ignored. Answers with a redirect, never JSON: to `next` (default
    /app.html) on success, to /?sso_error=<code> on failure."""
    if auth_mode() != "shibboleth":
        abort(404)
    cfg = current_app.config
    secret = cfg.get("SHIB_PROXY_SECRET") or ""
    sent = request.headers.get(SSO_SECRET_HEADER) or ""
    if len(secret) < MIN_SSO_SECRET_LEN:
        log.error("CMU sign-in refused: SHIB_PROXY_SECRET is not set on the server.")
        return _sso_failed("unavailable")
    if not sent:
        log.warning(
            "CMU sign-in refused: no %s header (request from %s did not pass Apache's "
            "protected location).", SSO_SECRET_HEADER, request.remote_addr,
        )
        return _sso_failed("unavailable")
    if not hmac.compare_digest(sent.encode("utf-8"), secret.encode("utf-8")):
        log.warning(
            "CMU sign-in refused: wrong %s header (request from %s). Apache's value and "
            "SHIB_PROXY_SECRET differ, or someone is forging it.", SSO_SECRET_HEADER, request.remote_addr,
        )
        return _sso_failed("unavailable")

    # eppn is the Andrew identity; mail is only a fallback for an IdP that does not release it.
    raw_id = _shib_attr(cfg.get("SHIB_HEADER_EPPN")) or _shib_attr(cfg.get("SHIB_HEADER_MAIL"))
    if not raw_id:
        log.warning("CMU sign-in refused: the IdP released neither eppn nor mail.")
        return _sso_failed("identity")
    email = normalize_cmu_email(raw_id)
    if not email or not _email_allowed(email):
        log.info("CMU sign-in refused: %r is not an allowed domain.", raw_id.rpartition("@")[2])
        return _sso_failed("domain")

    user = _upsert_user_from_login(email, _shib_name(email), method="shibboleth")
    session.clear()
    _write_session(user)
    return redirect(_sso_next(request.args.get("next")), code=302)


@bp.route("/auth/methods", methods=["GET"])
def auth_methods():
    """Public: which sign-in methods are on, for the landing page."""
    sso = auth_mode() == "shibboleth"
    return jsonify(
        mode="shibboleth" if sso else "password",
        methods={
            "password": not sso,
            "google": not sso and bool(current_app.config.get("GOOGLE_CLIENT_ID")),
            "shibboleth": sso,
        },
        login_url=SSO_LOGIN_PATH if sso else None,
        logout_url=current_app.config.get("SHIB_LOGOUT_URL") if sso else None,
    )


# ── Logout ───────────────────────────────────────────────────
@bp.route("/auth/logout", methods=["POST"])
def logout():
    """Clear the session. In shibboleth mode the answer also names the SP logout
    URL, where the frontend sends the browser to end the Shibboleth session."""
    session.clear()
    if auth_mode() == "shibboleth":
        return jsonify(ok=True, logout_url=current_app.config.get("SHIB_LOGOUT_URL"))
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
# The minors of frontend/data/minors.json (MINOR_LIST in frontend/js/profile.js).
VALID_MINORS_FOR_PATCH = {
    "arabic", "biology", "business", "business_analytics", "comp_bio", "cs",
    "economics", "finance", "history", "math", "neuroscience", "product",
    "writing", "psychology", "sociology", "self_defined", "tech_entre",
}


def _validate_consistent_profile(role, primary_program, minor_codes, advisor_scope, department):
    """Return None if the combination is internally consistent, else an error message."""
    minor_codes = minor_codes or []
    if role == "student":
        if not primary_program or primary_program not in VALID_PROGRAMS_FOR_PATCH - {"AS"}:
            return "Students must have a primary_program (CS/IS/BA/BS/AI/GS)."
        for mc in minor_codes:
            if mc not in VALID_MINORS_FOR_PATCH:
                return f"Unknown minor_code: {mc}."
            if mc in MAJOR_MINOR_COLLISION.get(primary_program, frozenset()):
                return MINOR_BLOCKED_MESSAGE
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
