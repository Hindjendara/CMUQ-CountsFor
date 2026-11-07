"""Centralized configuration. All values come from env vars so the same code
runs locally, on Render, and in tests without edits.

Required env vars in production:
  SECRET_KEY        — random 32+ byte string for cookie signing
  DATABASE_URL      — full Postgres URL (Render provides one for free)
  GOOGLE_CLIENT_ID  — OAuth client ID from Google Cloud Console
  FRONTEND_ORIGIN   — CORS allow-list, comma-separated
                      e.g. "https://adicmu.github.io,http://localhost:8765"
  ADMIN_EMAILS      — comma-separated andrew.cmu.edu emails granted admin role
                      e.g. "avivek@andrew.cmu.edu,ladyhodhod@andrew.cmu.edu"

Optional:
  ALLOWED_EMAIL_DOMAIN  — restrict signups to one domain (e.g. "andrew.cmu.edu")
                          leave empty to allow any verified Google account
"""
import os
from pathlib import Path

# Load .env in development. In production env vars come from the host (Render).
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _csv(env_value: str) -> list[str]:
    return [v.strip() for v in (env_value or "").split(",") if v.strip()]


def recovery_deploy_enabled() -> bool:
    """One-shot recovery when Render free Postgres/trial expired blocks deploy."""
    return os.environ.get("ALLOW_BOOTSTRAP_SKIP", "").strip().lower() in ("1", "true", "yes")


# Repo root, i.e. the parent of the backend/ package.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _absolutize_sqlite(uri: str) -> str:
    """Anchor a relative SQLite path to the repo root.

    A relative URI like `sqlite:///countsfor.db` is resolved by Flask-SQLAlchemy
    against `app.instance_path`, and that differs by entry point: running
    `python -m backend.app` makes the app name `__main__` so instance_path becomes
    `backend/instance/`, while gunicorn importing `backend.app:create_app()` makes it
    a package so instance_path becomes `<repo>/instance/`. The dev server and
    gunicorn therefore read *different database files* from identical config, which
    silently produced three stray countsfor.db files and an account that existed in
    one of them but not the others. Anchoring to the repo root removes the ambiguity.

    Postgres and absolute SQLite URIs are returned untouched.
    """
    prefix = "sqlite:///"
    if not uri.startswith(prefix):
        return uri
    path = uri[len(prefix):]
    if not path or path.startswith("/"):  # ':memory:' or already absolute
        return uri
    return prefix + str(_PROJECT_ROOT / "instance" / Path(path).name)


def _resolve_database_url() -> str:
    """Resolve SQLAlchemy URI. Never silently use SQLite on Render or production."""
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    on_render = os.environ.get("RENDER", "").lower() == "true"
    is_production = os.environ.get("FLASK_ENV", "").strip().lower() == "production"

    if raw:
        if raw.startswith("postgres://"):
            raw = raw.replace("postgres://", "postgresql://", 1)
        return _absolutize_sqlite(raw)

    if on_render:
        raise RuntimeError(
            "DATABASE_URL is not set on Render. Link the web service to "
            "CountsFor_Summer_2026: refusing the SQLite fallback."
        )
    if is_production:
        raise RuntimeError(
            "DATABASE_URL is required when FLASK_ENV=production. "
            "Refusing SQLite fallback."
        )

    allow_sqlite = os.environ.get("ALLOW_SQLITE", "").lower() in ("1", "true", "yes")
    if allow_sqlite or not is_production:
        return _absolutize_sqlite("sqlite:///countsfor.db")

    raise RuntimeError(
        "DATABASE_URL is unset. Set DATABASE_URL or ALLOW_SQLITE=1 for local SQLite dev."
    )


class Config:
    # ── Flask core ────────────────────────────────────────────
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")

    # Cookie / session settings — cross-origin (GH Pages → Render) needs
    # SameSite=None + Secure=True over HTTPS.
    ON_RENDER = os.environ.get("RENDER", "").lower() == "true"
    IS_PRODUCTION = (
        os.environ.get("FLASK_ENV", "development") == "production" or ON_RENDER
    )
    SESSION_COOKIE_NAME = "cf_session"
    SESSION_COOKIE_SECURE = IS_PRODUCTION
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "None" if IS_PRODUCTION else "Lax"
    SESSION_COOKIE_PATH = "/"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 30  # 30 days

    # ── Database ──────────────────────────────────────────────
    _raw_db = _resolve_database_url()
    SQLALCHEMY_DATABASE_URI = _raw_db
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Fail fast on Render if Postgres is misconfigured instead of hanging gunicorn.
    _engine_opts: dict = {"pool_pre_ping": True}
    if _raw_db.startswith("postgresql"):
        _engine_opts["connect_args"] = {"connect_timeout": 10}
    SQLALCHEMY_ENGINE_OPTIONS = _engine_opts

    # ── Auth ──────────────────────────────────────────────────
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
    ALLOWED_EMAIL_DOMAIN = os.environ.get("ALLOWED_EMAIL_DOMAIN", "").strip().lower()
    # Admin emails come ONLY from the directory panel (role=admin).
    # ADMIN_EMAILS is legacy and ignored by auth sync — kept for backwards-compatible deploy configs.
    ADMIN_EMAILS = {e.lower() for e in _csv(os.environ.get("ADMIN_EMAILS"))}
    SEED_USERS_PATH = os.environ.get(
        "SEED_USERS_PATH",
        str(Path(__file__).resolve().parent / "seed_users.json"),
    )
    # Hand-kept admins layered over the faculty seed (default data/directory_admins.json).
    # Unset means the default file; an empty string disables it.
    ADMIN_SEED_PATH = os.environ.get("ADMIN_SEED_PATH")

    # ── Password reset email ───────────────────────────────────
    RESET_TOKEN_MINUTES = int(os.environ.get("RESET_TOKEN_MINUTES", "30"))
    # Override reset link base (default: first FRONTEND_ORIGIN + /index.html)
    FRONTEND_RESET_BASE = (
        os.environ.get("FRONTEND_RESET_BASE", "").strip()
        or os.environ.get("PUBLIC_APP_URL", "").strip()
    )
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
    MAIL_FROM = (
        os.environ.get("MAIL_FROM", "").strip()
        or os.environ.get("SMTP_FROM", "").strip()
    )
    SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER", "").strip()
    SMTP_PASS = os.environ.get("SMTP_PASS") or os.environ.get("SMTP_PASSWORD") or ""
    SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

    # ── CORS ──────────────────────────────────────────────────
    FRONTEND_ORIGINS = _csv(os.environ.get(
        "FRONTEND_ORIGIN",
        "http://localhost:8765,https://adicmu.github.io"
    ))


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret"
    GOOGLE_CLIENT_ID = "test-google-client-id"
    ADMIN_EMAILS = {"admin@andrew.cmu.edu"}
    ALLOWED_EMAIL_DOMAIN = ""
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_SAMESITE = "Lax"
    FRONTEND_ORIGINS = ["http://localhost:8765"]
    SEED_USERS_PATH = ""
    ADMIN_SEED_PATH = ""
    # Tests opt in via monkeypatch when they need the raw reset token in responses.
    EXPOSE_RESET_TOKEN = os.environ.get("EXPOSE_RESET_TOKEN", "")
