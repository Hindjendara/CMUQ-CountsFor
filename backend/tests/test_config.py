"""Configuration read from the environment (backend/config.py) and the settings
that depend on it: session cookie defaults, production guards, TRUST_PROXY,
SOC_JSON_PATH and the SMTP check behind forgot-password."""
import email
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from werkzeug.middleware.proxy_fix import ProxyFix

from backend.app import create_app
from backend.auth import _email_provider_configured
from backend.config import TestConfig

from .conftest import login

REPO_ROOT = Path(__file__).resolve().parents[2]

# Every variable Config reads. Cleared for the subprocess so the developer's own
# environment cannot leak into these checks.
_CONFIG_VARS = (
    "FLASK_ENV", "SECRET_KEY", "DATABASE_URL", "SESSION_COOKIE_SECURE",
    "SESSION_COOKIE_SAMESITE", "TRUST_PROXY", "FRONTEND_ORIGIN", "SOC_JSON_PATH",
    "RENDER",
)

# Imports backend.config in a fresh interpreter (class attributes are computed
# at import) with backend/.env loading disabled, and prints the values as JSON.
_PROBE = """
import json, dotenv
dotenv.load_dotenv = lambda *a, **k: False
from backend.config import Config as C
print(json.dumps({
    "secure": C.SESSION_COOKIE_SECURE, "samesite": C.SESSION_COOKIE_SAMESITE,
    "trust_proxy": C.TRUST_PROXY, "origins": C.FRONTEND_ORIGINS,
    "db": C.SQLALCHEMY_DATABASE_URI, "soc": C.SOC_JSON_PATH, "secret": C.SECRET_KEY,
}))
"""


def _load_config(**env):
    clean = {k: v for k, v in os.environ.items() if k not in _CONFIG_VARS}
    clean.update(env)
    clean["PYTHONPATH"] = str(REPO_ROOT)
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE], cwd=REPO_ROOT, env=clean,
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        return None, proc.stderr
    return json.loads(proc.stdout), proc.stderr


PROD = {"FLASK_ENV": "production", "SECRET_KEY": "s" * 40, "DATABASE_URL": "postgresql:///countsfor"}


def test_development_defaults():
    cfg, err = _load_config()
    assert cfg, err
    assert cfg["secure"] is False
    assert cfg["samesite"] == "Lax"
    assert cfg["trust_proxy"] is False
    assert cfg["origins"] == ["http://localhost:8765"]
    assert cfg["db"].startswith("sqlite:///")
    assert Path(cfg["db"][len("sqlite:///"):]).parent == REPO_ROOT / "backend" / "instance"
    assert Path(cfg["soc"]) == REPO_ROOT / "backend" / "data" / "soc.json"


def test_production_defaults_same_origin_cookie():
    cfg, err = _load_config(**PROD)
    assert cfg, err
    assert cfg["secure"] is True
    assert cfg["samesite"] == "Lax"
    assert cfg["db"] == "postgresql:///countsfor"


def test_render_variable_no_longer_means_production():
    cfg, err = _load_config(RENDER="true")
    assert cfg, err
    assert cfg["secure"] is False
    assert cfg["db"].startswith("sqlite:///")


def test_cookie_proxy_and_path_overrides():
    cfg, err = _load_config(
        **PROD, SESSION_COOKIE_SECURE="0", SESSION_COOKIE_SAMESITE="strict",
        TRUST_PROXY="1", FRONTEND_ORIGIN="https://a.example, https://b.example",
        SOC_JSON_PATH="/srv/soc.json",
    )
    assert cfg, err
    assert cfg["secure"] is False
    assert cfg["samesite"] == "Strict"
    assert cfg["trust_proxy"] is True
    assert cfg["origins"] == ["https://a.example", "https://b.example"]
    assert cfg["soc"] == "/srv/soc.json"


def test_postgres_scheme_is_normalized():
    cfg, err = _load_config(DATABASE_URL="postgres://u:p@h/db")
    assert cfg, err
    assert cfg["db"] == "postgresql://u:p@h/db"


@pytest.mark.parametrize("missing", ["DATABASE_URL", "SECRET_KEY"])
def test_production_refuses_to_start_without(missing):
    env = {k: v for k, v in PROD.items() if k != missing}
    cfg, err = _load_config(**env)
    assert cfg is None
    assert f"{missing} is required when FLASK_ENV=production" in err


def test_invalid_samesite_is_rejected():
    cfg, err = _load_config(SESSION_COOKIE_SAMESITE="sometimes")
    assert cfg is None
    assert "SESSION_COOKIE_SAMESITE" in err


def test_trust_proxy_wraps_app_in_proxyfix():
    class ProxiedConfig(TestConfig):
        TRUST_PROXY = True

    plain = create_app(TestConfig, bootstrap_db=False)
    assert not isinstance(plain.wsgi_app, ProxyFix)

    app = create_app(ProxiedConfig, bootstrap_db=False)
    assert isinstance(app.wsgi_app, ProxyFix)

    seen = {}

    @app.route("/_probe")
    def _probe():
        from flask import request
        seen["addr"], seen["scheme"] = request.remote_addr, request.scheme
        return "ok"

    app.test_client().get("/_probe", headers={
        "X-Forwarded-For": "10.1.2.3", "X-Forwarded-Proto": "https",
    })
    assert seen == {"addr": "10.1.2.3", "scheme": "https"}


def test_admin_overview_reads_soc_json_path(client, app, admin, tmp_path):
    soc = tmp_path / "soc.json"
    soc.write_text(json.dumps({"metadata": {"last_scrape": "2026-11-08T12:00:00Z"}, "courses": {}}),
                   encoding="utf-8")
    app.config["SOC_JSON_PATH"] = str(soc)
    login(client, admin)
    body = client.get("/api/admin/overview").get_json()
    assert body["course_data"]["last_scrape"] == "2026-11-08T12:00:00Z"

    app.config["SOC_JSON_PATH"] = str(tmp_path / "missing.json")
    body = client.get("/api/admin/overview").get_json()
    assert body["course_data"]["last_scrape"] is None


@pytest.mark.parametrize("cfg,expected", [
    ({}, False),
    ({"RESEND_API_KEY": "re_x"}, False),                                  # Resend needs a sender
    ({"RESEND_API_KEY": "re_x", "MAIL_FROM": "a@qatar.cmu.edu"}, True),
    ({"SMTP_HOST": "relay.example"}, False),                              # no sender at all
    ({"SMTP_HOST": "relay.example", "MAIL_FROM": "a@qatar.cmu.edu"}, True),  # unauthenticated relay
    ({"SMTP_HOST": "relay.example", "SMTP_USER": "u@x.edu"}, True),       # SMTP_USER doubles as sender
    ({"SMTP_HOST": "smtp.x", "SMTP_USER": "u@x.edu", "SMTP_PASS": "p"}, True),
    ({"MAIL_FROM": "a@qatar.cmu.edu", "SMTP_USER": "u"}, False),          # no host
])
def test_email_provider_configured(cfg, expected):
    assert _email_provider_configured(cfg) is expected


def test_forgot_password_through_unauthenticated_relay(monkeypatch):
    """SMTP_HOST + MAIL_FROM with no SMTP_USER/SMTP_PASS: forgot-password sends
    through the relay without logging in, instead of answering 503."""
    monkeypatch.delenv("EXPOSE_RESET_TOKEN", raising=False)

    class RelayConfig(TestConfig):
        RESEND_API_KEY = ""
        SMTP_HOST = "relay.qatar.example"
        SMTP_PORT = 25
        SMTP_USER = ""
        SMTP_PASS = ""
        SMTP_USE_TLS = False
        MAIL_FROM = "CountsFor <noreply@qatar.cmu.edu>"
        FRONTEND_RESET_BASE = "https://countsfor.qatar.cmu.edu/index.html"

    app = create_app(RelayConfig)
    client = app.test_client()
    client.post("/api/auth/register", json={
        "email": "relay@andrew.cmu.edu", "password": "relaypass1", "confirm_password": "relaypass1",
    })
    client.post("/api/auth/logout")

    with patch("backend.email_util.smtplib.SMTP") as smtp_cls:
        smtp = smtp_cls.return_value.__enter__.return_value
        r = client.post("/api/auth/forgot-password", json={"email": "relay@andrew.cmu.edu"})

    assert r.status_code == 200, r.get_json()
    smtp_cls.assert_called_once_with("relay.qatar.example", 25, timeout=15)
    smtp.login.assert_not_called()
    smtp.starttls.assert_not_called()
    smtp.sendmail.assert_called_once()
    sender, recipients, message = smtp.sendmail.call_args.args
    assert sender == "CountsFor <noreply@qatar.cmu.edu>"
    assert recipients == ["relay@andrew.cmu.edu"]
    parsed = email.message_from_string(message)
    text = "".join(
        part.get_payload(decode=True).decode("utf-8")
        for part in parsed.walk() if not part.is_multipart()
    )
    assert "https://countsfor.qatar.cmu.edu/index.html?token=" in text
