"""CMU sign-in (Shibboleth): AUTH_MODE, GET /api/auth/shibboleth, the methods
route and logout (README 15.22, 21.1).

Apache (mod_shib) protects /api/auth/shibboleth and passes the SAML attributes
as request headers, plus X-CountsFor-SSO-Secret, which it sets only inside that
protected location. These tests play Apache's part by sending those headers.
"""
import json
import logging
from unittest.mock import patch

import pytest

from backend import config as config_module
from backend.app import create_app
from backend.auth import SSO_SECRET_HEADER, check_auth_settings, is_site_path
from backend.config import TestConfig
from backend.db import db
from backend.models import DirectoryEntry, SignInEvent, User
from .conftest import login, _make_user

SECRET = "test-sso-secret-" + "k" * 40
SSO = "/api/auth/shibboleth"


class ShibConfig(TestConfig):
    AUTH_MODE = "shibboleth"
    SHIB_PROXY_SECRET = SECRET


def _make_app(config_class=ShibConfig):
    """Like conftest's app fixture, for another config class."""
    app = create_app(config_class)
    with app.app_context():
        db.drop_all()
        db.create_all()
        from backend.migrate import run_migrations
        run_migrations()
    return app


@pytest.fixture
def sso_app():
    app = _make_app()
    yield app
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture
def sso(sso_app):
    return sso_app.test_client()


def _apache(secret=SECRET, **attrs):
    """The headers Apache sends inside the protected location."""
    headers = {} if secret is None else {SSO_SECRET_HEADER: secret}
    headers.update(attrs)
    return headers


def _sign_in(client, next_=None, secret=SECRET, **attrs):
    url = SSO if next_ is None else SSO + "?" + _query(next_)
    return client.get(url, headers=_apache(secret, **attrs))


def _query(next_):
    from urllib.parse import urlencode
    return urlencode({"next": next_})


def _users(app):
    with app.app_context():
        return db.session.query(User).count()


def _refused(r, code):
    assert r.status_code == 302, r.data
    assert r.headers["Location"] == f"/?sso_error={code}"
    assert "cf_session=" not in (r.headers.get("Set-Cookie") or "")


# ── Mode off ────────────────────────────────────────────────

def test_route_is_404_in_password_mode(client, app):
    r = client.get(SSO, headers=_apache(eppn="alice@andrew.cmu.edu"))
    assert r.status_code == 404
    assert r.get_json()["error"] == "not_found"
    assert client.get("/api/me").status_code == 401
    assert _users(app) == 0


# ── The shared secret ───────────────────────────────────────

def test_missing_secret_is_refused_and_logged(sso, sso_app, caplog):
    with caplog.at_level(logging.WARNING, logger="backend.auth"):
        r = _sign_in(sso, secret=None, eppn="alice@andrew.cmu.edu", displayName="Alice")
    _refused(r, "unavailable")
    assert sso.get("/api/me").status_code == 401
    assert _users(sso_app) == 0
    assert any(SSO_SECRET_HEADER in rec.getMessage() for rec in caplog.records)


@pytest.mark.parametrize("sent", ["", "wrong", SECRET[:-1], SECRET + "x", SECRET.upper(), " " + SECRET, "é" * 40])
def test_wrong_or_empty_secret_is_refused(sso, sso_app, sent, caplog):
    with caplog.at_level(logging.WARNING, logger="backend.auth"):
        r = _sign_in(sso, secret=sent, eppn="alice@andrew.cmu.edu")
    _refused(r, "unavailable")
    assert sso.get("/api/me").status_code == 401
    assert _users(sso_app) == 0
    assert caplog.records, "a refused secret must be logged"


def test_secret_is_compared_in_constant_time(sso):
    import hmac
    with patch("backend.auth.hmac.compare_digest", wraps=hmac.compare_digest) as spy:
        r = _sign_in(sso, eppn="alice@andrew.cmu.edu")
    assert r.status_code == 302 and r.headers["Location"] == "/app.html"
    spy.assert_called_once()


@pytest.mark.parametrize("secret", ["", "short", "x" * 31])
def test_shibboleth_mode_refuses_to_start_without_a_long_secret(secret):
    class Bad(ShibConfig):
        SHIB_PROXY_SECRET = secret

    with pytest.raises(RuntimeError, match="SHIB_PROXY_SECRET"):
        create_app(Bad, bootstrap_db=False)


def test_route_refuses_when_the_secret_is_unset_at_run_time(sso, sso_app, caplog):
    """Defense in depth: create_app() checks the secret, the route checks again."""
    sso_app.config["SHIB_PROXY_SECRET"] = ""
    with caplog.at_level(logging.ERROR, logger="backend.auth"):
        r = _sign_in(sso, secret="", eppn="alice@andrew.cmu.edu")
    _refused(r, "unavailable")
    assert _users(sso_app) == 0
    assert caplog.records


def test_bad_auth_settings_stop_the_app():
    with pytest.raises(RuntimeError, match="AUTH_MODE"):
        check_auth_settings({"AUTH_MODE": "magic"})
    with pytest.raises(RuntimeError, match="SHIB_LOGOUT_URL"):
        check_auth_settings({"AUTH_MODE": "shibboleth", "SHIB_PROXY_SECRET": SECRET,
                             "SHIB_HEADER_EPPN": "eppn", "SHIB_LOGOUT_URL": "https://evil.example/"})
    with pytest.raises(RuntimeError, match="SHIB_HEADER"):
        check_auth_settings({"AUTH_MODE": "shibboleth", "SHIB_PROXY_SECRET": SECRET,
                             "SHIB_HEADER_EPPN": "", "SHIB_HEADER_MAIL": "",
                             "SHIB_LOGOUT_URL": "/Shibboleth.sso/Logout?return=/"})
    check_auth_settings({"AUTH_MODE": "password"})  # password mode needs nothing


def test_auth_mode_env_values(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    assert config_module._auth_mode() == "password"
    monkeypatch.setenv("AUTH_MODE", " Shibboleth ")
    assert config_module._auth_mode() == "shibboleth"
    monkeypatch.setenv("AUTH_MODE", "sso")
    with pytest.raises(RuntimeError, match="AUTH_MODE"):
        config_module._auth_mode()


# ── Identity ────────────────────────────────────────────────

def test_missing_eppn_and_mail_is_refused(sso, sso_app):
    _refused(_sign_in(sso, displayName="Nobody"), "identity")
    _refused(_sign_in(sso, eppn="", mail=""), "identity")
    assert _users(sso_app) == 0


@pytest.mark.parametrize("attrs", [
    {"eppn": "bob@pitt.edu"},
    {"eppn": "bob@andrew.cmu.edu.evil.com"},
    {"eppn": "not-an-address"},
    {"mail": "bob@gmail.com"},
    # eppn decides when present: a CMU mail does not rescue a foreign eppn.
    {"eppn": "bob@pitt.edu", "mail": "bob@andrew.cmu.edu"},
])
def test_foreign_domain_is_refused(sso, sso_app, attrs):
    _refused(_sign_in(sso, **attrs), "domain")
    assert sso.get("/api/me").status_code == 401
    assert _users(sso_app) == 0


def test_allowed_email_domain_applies():
    class OtherDomain(ShibConfig):
        ALLOWED_EMAIL_DOMAIN = "example.edu"

    app = _make_app(OtherDomain)
    _refused(_sign_in(app.test_client(), eppn="alice@andrew.cmu.edu"), "domain")
    assert _users(app) == 0


def test_happy_path_creates_a_student_and_signs_in(sso, sso_app):
    r = _sign_in(sso, eppn="alice@andrew.cmu.edu", mail="alice@andrew.cmu.edu",
                 displayName="Alice Example", givenName="Alice", sn="Example")
    assert r.status_code == 302
    assert r.headers["Location"] == "/app.html"
    assert "cf_session=" in r.headers.get("Set-Cookie", "")

    # app.html boots with GET /api/me on the session cookie and stores auth_token.
    me = sso.get("/api/me")
    assert me.status_code == 200, me.get_json()
    body = me.get_json()
    assert body["email"] == "alice@andrew.cmu.edu"
    assert body["name"] == "Alice Example"
    assert body["role"] == "student" and body["role_group"] == "student"
    assert body["profile_completed"] is False  # onboarding picks the major
    token = body["auth_token"]
    assert token

    # The token works on its own too (the frontend sends it as a bearer token).
    bare = sso_app.test_client()
    assert bare.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code == 200

    with sso_app.app_context():
        user = db.session.query(User).filter_by(email="alice@andrew.cmu.edu").one()
        assert user.password_hash is None and user.google_sub is None
        methods = [e.method for e in db.session.query(SignInEvent).filter_by(user_id=user.id)]
        assert methods == ["shibboleth"]


def test_signing_in_again_reuses_the_account(sso, sso_app):
    _make_user(sso_app, "carol@andrew.cmu.edu", name="Carol From Before", primary_program="CS")
    for _ in range(2):
        assert _sign_in(sso, eppn="carol@andrew.cmu.edu", displayName="Carol C").status_code == 302
    assert _users(sso_app) == 1
    body = sso.get("/api/me").get_json()
    assert body["name"] == "Carol From Before"  # an existing name is kept
    assert body["primary_program"] == "CS"


@pytest.mark.parametrize("attrs,email,name", [
    # Multi-valued attributes: mod_shib joins them with ";", the first one counts.
    ({"eppn": "dan@andrew.cmu.edu;dan2@andrew.cmu.edu", "displayName": "Dan One;Dan Two"},
     "dan@andrew.cmu.edu", "Dan One"),
    # No displayName: givenName + sn.
    ({"eppn": "erin@andrew.cmu.edu", "givenName": "Erin", "sn": "Smith"}, "erin@andrew.cmu.edu", "Erin Smith"),
    # No name at all: the Andrew ID.
    ({"eppn": "fay@andrew.cmu.edu"}, "fay@andrew.cmu.edu", "fay"),
    # No eppn: mail, normalized like every other CMU address.
    ({"mail": "Gus@Qatar.CMU.edu", "displayName": "Gus"}, "gus@andrew.cmu.edu", "Gus"),
    ({"eppn": "  HAL@cmu.edu  "}, "hal@andrew.cmu.edu", "hal"),
])
def test_attribute_parsing(sso, attrs, email, name):
    r = _sign_in(sso, **attrs)
    assert r.headers["Location"] == "/app.html"
    body = sso.get("/api/me").get_json()
    assert body["email"] == email
    assert body["name"] == name


def test_utf8_names_survive_the_header(sso_app):
    """mod_shib sends UTF-8 bytes; WSGI reads header bytes as latin-1."""
    name = "Fatima Al Kuwari فاطمة"
    raw = name.encode("utf-8").decode("latin-1")
    c = sso_app.test_client()
    assert _sign_in(c, eppn="fatima@andrew.cmu.edu", displayName=raw).status_code == 302
    assert c.get("/api/me").get_json()["name"] == name


def test_header_names_are_configurable():
    class Renamed(ShibConfig):
        SHIB_HEADER_EPPN = "X-Eppn"
        SHIB_HEADER_DISPLAY_NAME = "X-Name"

    app = _make_app(Renamed)
    c = app.test_client()
    _refused(_sign_in(c, eppn="ivy@andrew.cmu.edu"), "identity")  # the default name is not read
    assert _sign_in(c, **{"X-Eppn": "ivy@andrew.cmu.edu", "X-Name": "Ivy"}).status_code == 302
    assert c.get("/api/me").get_json()["name"] == "Ivy"


def test_admin_seed_email_gets_admin(sso_app, tmp_path):
    admins = tmp_path / "admins.json"
    admins.write_text(json.dumps({"people": [
        {"email": "boss@andrew.cmu.edu", "name": "Boss", "role": "admin",
         "primary_program": "CS", "department": "Computer Science"},
    ]}))
    sso_app.config["ADMIN_SEED_PATH"] = str(admins)
    c = sso_app.test_client()
    assert _sign_in(c, eppn="boss@andrew.cmu.edu", displayName="The Boss").status_code == 302
    body = c.get("/api/me").get_json()
    assert body["role"] == "admin" and body["role_group"] == "admin" and body["is_admin"] is True
    assert body["profile_completed"] is True


def test_directory_faculty_get_their_role(sso_app):
    with sso_app.app_context():
        db.session.add(DirectoryEntry(email="prof@andrew.cmu.edu", name="Prof", role="professor",
                                      department="Information Systems", primary_program="IS"))
        db.session.commit()
    c = sso_app.test_client()
    assert _sign_in(c, eppn="prof@andrew.cmu.edu").status_code == 302
    body = c.get("/api/me").get_json()
    assert body["role"] == "professor" and body["role_group"] == "faculty"


def test_a_new_sign_in_replaces_the_previous_session(sso, sso_app):
    other = _make_user(sso_app, "other@andrew.cmu.edu")
    login(sso, other)
    assert _sign_in(sso, eppn="jane@andrew.cmu.edu").status_code == 302
    assert sso.get("/api/me").get_json()["email"] == "jane@andrew.cmu.edu"


# ── Where the browser goes next ─────────────────────────────

@pytest.mark.parametrize("target", [
    "/app.html",
    "/app.html?share_plan=AbC_123-xyz",
    "/index.html",
    "/app.html?share_plan=a%2Bb",
])
def test_next_keeps_a_path_on_this_site(sso, target):
    r = _sign_in(sso, next_=target, eppn="kim@andrew.cmu.edu")
    assert r.status_code == 302
    assert r.headers["Location"] == target


@pytest.mark.parametrize("target", [
    "//evil.example/",
    "///evil.example/",
    "/\\evil.example/",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%2f/evil.example",
    "/%5Cevil.example",
    "https://evil.example/",
    "http:/evil.example",
    "javascript:alert(1)",
    "evil.example",
    "app.html",
    " /app.html",
    "/app.html\r\nSet-Cookie: x=1",
    "/app.html#frag",
    "/app html",
    "/api/auth/logout",
    "/api",
    "/Shibboleth.sso/Logout",
    "/shibboleth.sso/Logout",
    "/" + "a" * 3000,
])
def test_next_refuses_open_redirects(sso, target):
    r = _sign_in(sso, next_=target, eppn="lee@andrew.cmu.edu")
    assert r.status_code == 302
    assert r.headers["Location"] == "/app.html"
    assert sso.get("/api/me").status_code == 200  # the sign-in itself still worked


def test_is_site_path():
    assert is_site_path("/") and is_site_path("/app.html?share_plan=x")
    for bad in ("", "x", "//a", "/\\a", "/%2F%2Fa", "https://a", "/a b", "/a\nb", "/a#b"):
        assert not is_site_path(bad), bad


# ── Password and Google routes in shibboleth mode ───────────

@pytest.mark.parametrize("path,body", [
    ("/api/auth/register", {"email": "a@andrew.cmu.edu", "password": "password12", "confirm_password": "password12"}),
    ("/api/auth/login", {"email": "a@andrew.cmu.edu", "password": "password12"}),
    ("/api/auth/forgot-password", {"email": "a@andrew.cmu.edu"}),
    ("/api/auth/reset-password", {"token": "x", "password": "password12"}),
    ("/api/auth/set-password", {"password": "password12"}),
    ("/api/auth/google", {"credential": "stub"}),
])
def test_password_and_google_routes_are_refused(sso, sso_app, path, body):
    with patch("backend.auth.id_token.verify_oauth2_token",
               return_value={"sub": "g", "email": "a@andrew.cmu.edu", "email_verified": True}) as verify:
        r = sso.post(path, json=body)
    assert r.status_code == 403, r.get_json()
    assert r.get_json() == {"error": "sso_only", "message": "Sign in with your Andrew ID."}
    verify.assert_not_called()
    assert _users(sso_app) == 0


def test_set_password_is_refused_even_when_signed_in(sso, sso_app):
    _sign_in(sso, eppn="mo@andrew.cmu.edu")
    r = sso.post("/api/auth/set-password", json={"password": "password12"})
    assert r.status_code == 403 and r.get_json()["error"] == "sso_only"
    with sso_app.app_context():
        assert db.session.query(User).filter_by(email="mo@andrew.cmu.edu").one().password_hash is None


def test_password_routes_still_work_in_password_mode(client):
    r = client.post("/api/auth/register", json={
        "email": "pat@andrew.cmu.edu", "password": "password12", "confirm_password": "password12"})
    assert r.status_code == 201, r.get_json()


# ── /api/auth/methods and logout ────────────────────────────

def test_methods_in_password_mode(client):
    r = client.get("/api/auth/methods")
    assert r.status_code == 200
    assert r.get_json() == {
        "mode": "password",
        "methods": {"password": True, "google": True, "shibboleth": False},
        "login_url": None,
        "logout_url": None,
    }


def test_methods_in_password_mode_without_google():
    class NoGoogle(TestConfig):
        GOOGLE_CLIENT_ID = ""

    body = create_app(NoGoogle, bootstrap_db=False).test_client().get("/api/auth/methods").get_json()
    assert body["methods"] == {"password": True, "google": False, "shibboleth": False}


def test_methods_in_shibboleth_mode(sso):
    r = sso.get("/api/auth/methods")
    assert r.status_code == 200
    assert r.get_json() == {
        "mode": "shibboleth",
        "methods": {"password": False, "google": False, "shibboleth": True},
        "login_url": "/api/auth/shibboleth",
        "logout_url": "/Shibboleth.sso/Logout?return=/",
    }
    # Public: nothing about the secret.
    assert SECRET not in r.get_data(as_text=True)


def test_logout_names_the_sp_logout_in_shibboleth_mode(sso):
    _sign_in(sso, eppn="ned@andrew.cmu.edu")
    r = sso.post("/api/auth/logout")
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "logout_url": "/Shibboleth.sso/Logout?return=/"}
    assert sso.get("/api/me").status_code == 401


def test_logout_in_password_mode_is_unchanged(client, student):
    login(client, student)
    assert client.post("/api/auth/logout").get_json() == {"ok": True}


def test_cmu_qatar_eppn_signs_in_to_the_andrew_account(sso_app):
    """CMU-Q's IdP scopes eppn with qatar.cmu.edu: andrewid@qatar.cmu.edu is the
    same person as the account and directory entries under andrewid@andrew.cmu.edu."""
    with sso_app.app_context():
        user = User(email="qstudent@andrew.cmu.edu", name="Q Student", role="student")
        db.session.add(user)
        db.session.commit()
        uid = user.id
    c = sso_app.test_client()
    assert _sign_in(c, eppn="QStudent@qatar.cmu.edu").status_code == 302
    me = c.get("/api/me").get_json()
    assert me["email"] == "qstudent@andrew.cmu.edu" and me["id"] == uid
    assert _users(sso_app) == 1
