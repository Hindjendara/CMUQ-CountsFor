"""Centralized configuration. Every setting comes from an environment variable,
so the same code runs locally, on the server and in tests without edits.

backend/.env.example lists every variable with its local value and, in comments,
the production value. backend/tests/test_env_example.py keeps that file and the
variables read in backend/ in sync.

Where the values come from:
  local dev   backend/.env (copied from .env.example), loaded below
  production  /etc/countsfor/countsfor.env, loaded by systemd (EnvironmentFile);
              template: deploy/countsfor.env.example. Real environment variables
              always win over backend/.env.

Production is FLASK_ENV=production. It refuses to start without SECRET_KEY and
DATABASE_URL (no SQLite fallback), and turns on Secure session cookies.
"""
import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent

# Load backend/.env in development. Never overrides variables already set.
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND_DIR / ".env")
except ImportError:
    pass


def _csv(env_value: str) -> list[str]:
    return [v.strip() for v in (env_value or "").split(",") if v.strip()]


def _flag(name: str, default: bool = False) -> bool:
    """Boolean env var: 1/true/yes/on are true, 0/false/no/off are false, unset is the default."""
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def is_production() -> bool:
    return os.environ.get("FLASK_ENV", "").strip().lower() == "production"


# Local SQLite databases live in backend/instance/ (gitignored).
_INSTANCE_DIR = _BACKEND_DIR / "instance"


def _absolutize_sqlite(uri: str) -> str:
    """Anchor a relative SQLite path to backend/instance/.

    A relative URI like `sqlite:///countsfor.db` is resolved by Flask-SQLAlchemy
    against `app.instance_path`, and that differs by entry point: running
    `python -m backend.app` makes the app name `__main__` so instance_path becomes
    `backend/instance/`, while gunicorn importing `backend.app:create_app()` makes it
    a package so instance_path becomes `<repo>/instance/`. The dev server and
    gunicorn therefore read *different database files* from identical config, which
    silently produced three stray countsfor.db files and an account that existed in
    one of them but not the others. Anchoring to one fixed folder removes the ambiguity.

    Postgres and absolute SQLite URIs are returned untouched.
    """
    prefix = "sqlite:///"
    if not uri.startswith(prefix):
        return uri
    path = uri[len(prefix):]
    if not path or path.startswith("/"):  # ':memory:' or already absolute
        return uri
    # SQLite does not create missing folders, so make sure backend/instance/ exists.
    _INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    return prefix + str(_INSTANCE_DIR / Path(path).name)


def _resolve_database_url() -> str:
    """SQLAlchemy URI from DATABASE_URL. Production never falls back to SQLite."""
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if raw:
        if raw.startswith("postgres://"):
            raw = raw.replace("postgres://", "postgresql://", 1)
        return _absolutize_sqlite(raw)
    if is_production():
        raise RuntimeError(
            "DATABASE_URL is required when FLASK_ENV=production. "
            "Refusing the SQLite fallback."
        )
    return _absolutize_sqlite("sqlite:///countsfor.db")


_DEV_SECRET_KEY = "dev-only-change-me"


def _secret_key() -> str:
    """SECRET_KEY signs the session cookie and the bearer tokens; production must set it."""
    key = os.environ.get("SECRET_KEY", "").strip()
    if key:
        return key
    if is_production():
        raise RuntimeError("SECRET_KEY is required when FLASK_ENV=production.")
    return _DEV_SECRET_KEY


def _samesite(default: str) -> str:
    raw = os.environ.get("SESSION_COOKIE_SAMESITE", "").strip().capitalize()
    if not raw:
        return default
    if raw not in ("Lax", "Strict", "None"):
        raise RuntimeError(
            f"SESSION_COOKIE_SAMESITE must be Lax, Strict or None, got {raw!r}."
        )
    return raw


class Config:
    IS_PRODUCTION = is_production()

    # ── Flask core ────────────────────────────────────────────
    SECRET_KEY = _secret_key()

    # ── Session cookie ────────────────────────────────────────
    # The site and the API share one origin (Apache proxies /api), so the cookie is
    # first-party: SameSite=Lax works and also keeps it off cross-site POSTs.
    # Secure (HTTPS only) is on in production. Both can be overridden.
    SESSION_COOKIE_NAME = "cf_session"
    SESSION_COOKIE_SECURE = _flag("SESSION_COOKIE_SECURE", IS_PRODUCTION)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = _samesite("Lax")
    SESSION_COOKIE_PATH = "/"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 30  # 30 days

    # ── Reverse proxy ─────────────────────────────────────────
    # TRUST_PROXY=1 wraps the app in werkzeug ProxyFix(x_for=1, x_proto=1), so
    # request.remote_addr and request.scheme come from the X-Forwarded-For and
    # X-Forwarded-Proto headers set by the one proxy in front (Apache). Leave it
    # off when nothing sits in front of the app: clients could forge the headers.
    TRUST_PROXY = _flag("TRUST_PROXY")

    # ── Database ──────────────────────────────────────────────
    _raw_db = _resolve_database_url()
    SQLALCHEMY_DATABASE_URI = _raw_db
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Fail fast if Postgres is unreachable instead of hanging a gunicorn worker.
    _engine_opts: dict = {"pool_pre_ping": True}
    if _raw_db.startswith("postgresql"):
        _engine_opts["connect_args"] = {"connect_timeout": 10}
    SQLALCHEMY_ENGINE_OPTIONS = _engine_opts

    # ── Auth ──────────────────────────────────────────────────
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
    ALLOWED_EMAIL_DOMAIN = os.environ.get("ALLOWED_EMAIL_DOMAIN", "").strip().lower()
    # Admins come only from the directory (role=admin), never from an env var.
    SEED_USERS_PATH = os.environ.get(
        "SEED_USERS_PATH",
        str(_BACKEND_DIR / "seed_users.json"),
    )
    # Hand-kept admins layered over the faculty seed (default backend/data/directory_admins.json).
    # Unset means the default file; an empty string disables it.
    ADMIN_SEED_PATH = os.environ.get("ADMIN_SEED_PATH")

    # ── Course data ───────────────────────────────────────────
    # The private SOC scrape (written by backend/scraper/scrape_soc.py). The admin
    # overview reads its last_scrape date. The scraper takes the same variable.
    SOC_JSON_PATH = os.environ.get("SOC_JSON_PATH", str(_BACKEND_DIR / "data" / "soc.json"))

    # ── Password reset email ───────────────────────────────────
    RESET_TOKEN_MINUTES = int(os.environ.get("RESET_TOKEN_MINUTES", "30"))
    # Page the emailed reset link opens (the landing page, index.html); the token
    # is appended as ?token=. Default: first FRONTEND_ORIGIN + /index.html.
    FRONTEND_RESET_BASE = os.environ.get("FRONTEND_RESET_BASE", "").strip()
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
    MAIL_FROM = os.environ.get("MAIL_FROM", "").strip()
    SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER", "").strip()
    SMTP_PASS = os.environ.get("SMTP_PASS", "")
    SMTP_USE_TLS = _flag("SMTP_USE_TLS", True)

    # ── CORS ──────────────────────────────────────────────────
    # Only matters when a page on another origin calls the API, e.g. a local page
    # using the cf_backend_override debugging hook. Same-origin requests (through
    # Apache, or scripts/dev_server.py locally) never need it.
    FRONTEND_ORIGINS = _csv(os.environ.get("FRONTEND_ORIGIN", "http://localhost:8765"))


class TestConfig(Config):
    TESTING = True
    IS_PRODUCTION = False
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret"
    GOOGLE_CLIENT_ID = "test-google-client-id"
    ALLOWED_EMAIL_DOMAIN = ""
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_SAMESITE = "Lax"
    TRUST_PROXY = False
    FRONTEND_ORIGINS = ["http://localhost:8765"]
    SEED_USERS_PATH = ""
    ADMIN_SEED_PATH = ""
    # Tests opt in via monkeypatch when they need the raw reset token in responses.
    EXPOSE_RESET_TOKEN = os.environ.get("EXPOSE_RESET_TOKEN", "")
