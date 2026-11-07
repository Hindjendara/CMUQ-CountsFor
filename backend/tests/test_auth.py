"""Auth route tests. /api/auth/google's signature check is mocked — real
JWT verification needs network round-trips to Google."""
import json
from unittest.mock import patch
import pytest

from backend.app import create_app
from backend.config import TestConfig
from backend.db import db
from backend.models import User
from .conftest import login, _make_user


def _fake(email, sub):
    return {"sub": sub, "email": email, "email_verified": True, "name": email.split("@")[0]}


def _fake_google_payload(email="alice@andrew.cmu.edu", verified=True, sub="g-123"):
    return {
        "sub": sub,
        "email": email,
        "email_verified": verified,
        "name": "Alice Example",
    }


# ── Google sign-in flow ─────────────────────────────────────

def test_google_signin_creates_user(client):
    with patch("backend.auth.id_token.verify_oauth2_token", return_value=_fake_google_payload()):
        r = client.post("/api/auth/google", json={"credential": "stub-jwt"})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["email"] == "alice@andrew.cmu.edu"
    assert body["role"] == "student"  # default

    # User row was persisted
    with client.application.app_context():
        u = db.session.query(User).filter_by(email="alice@andrew.cmu.edu").one()
        assert u.google_sub == "g-123"


def test_google_signin_reuses_existing_user(client):
    # First login creates
    with patch("backend.auth.id_token.verify_oauth2_token", return_value=_fake_google_payload()):
        client.post("/api/auth/google", json={"credential": "stub"})
    # Second login finds the same row
    with patch("backend.auth.id_token.verify_oauth2_token", return_value=_fake_google_payload()):
        client.post("/api/auth/google", json={"credential": "stub"})
    with client.application.app_context():
        assert db.session.query(User).count() == 1


def test_google_signin_promotes_admin_via_directory(client):
    directory = {
        "admin@andrew.cmu.edu": {
            "email": "admin@andrew.cmu.edu",
            "name": "Admin",
            "role": "admin",
            "department": "Dean's Office",
            "primary_program": "IS",
        }
    }
    with patch("backend.auth.resolve_directory_entry", side_effect=lambda e: directory.get(e)):
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake_google_payload(email="admin@andrew.cmu.edu", sub="g-admin")):
            r = client.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "admin"
    assert body["is_admin"] is True


def test_google_signin_marks_seeded_faculty_complete(client):
    from backend.db import db
    from backend.models import User

    with client.application.app_context():
        u = User(
            email="prof@andrew.cmu.edu",
            name="Prof",
            role="professor",
            primary_program="CS",
            google_sub="g-prof-seed",
        )
        db.session.add(u)
        db.session.commit()

    with patch(
        "backend.auth.id_token.verify_oauth2_token",
        return_value=_fake_google_payload(email="prof@andrew.cmu.edu", sub="g-prof-seed"),
    ):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "professor"
    assert body["profile_completed"] is True


def test_google_signin_rejects_unverified_email(client):
    with patch("backend.auth.id_token.verify_oauth2_token",
               return_value=_fake_google_payload(verified=False)):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "email_unverified"


def test_google_signin_rejects_bad_signature(client):
    with patch("backend.auth.id_token.verify_oauth2_token", side_effect=ValueError("bad sig")):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_token"


def test_google_signin_missing_credential(client):
    r = client.post("/api/auth/google", json={})
    assert r.status_code == 400
    assert r.get_json()["error"] == "missing_credential"


# ── /api/me ─────────────────────────────────────────────────

def test_me_unauthenticated(client):
    r = client.get("/api/me")
    assert r.status_code == 401


def test_me_returns_profile(client, student):
    login(client, student)
    r = client.get("/api/me")
    assert r.status_code == 200
    body = r.get_json()
    assert body["email"] == student.email
    assert body["role"] == "student"
    assert "google_sub" not in body  # not exposed


def test_patch_me_updates_profile(client, student):
    login(client, student)
    r = client.patch("/api/me", json={"primary_program": "BA", "minor_code": "history"})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["primary_program"] == "BA"
    assert body["minor_code"] == "history"
    assert body["minor_codes"] == ["history"]


def test_patch_me_accepts_multiple_minors(client, student):
    login(client, student)
    r = client.patch("/api/me", json={
        "primary_program": "CS",
        "minor_codes": ["finance", "history"],
    })
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["minor_codes"] == ["finance", "history"]
    assert body["minor_code"] is None


def test_patch_me_rejects_unknown_fields(client, student):
    login(client, student)
    r = client.patch("/api/me", json={"is_evil": True})
    assert r.status_code == 400


def test_patch_me_admin_cannot_self_demote(client, admin):
    login(client, admin)
    r = client.patch("/api/me", json={"role": "student"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "cannot_change_admin_role"


def test_patch_me_student_cannot_promote_to_professor(client, student):
    login(client, student)
    r = client.patch("/api/me", json={"role": "professor", "primary_program": "CS"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_role"


# ── PATCH /api/me cross-field validation ────────────────────

def test_patch_me_rejects_student_without_program(client, student):
    login(client, student)
    # Trying to clear primary_program while keeping role=student
    r = client.patch("/api/me", json={"primary_program": ""})
    assert r.status_code == 400
    assert r.get_json()["error"] == "inconsistent_profile"


def test_patch_me_rejects_advisor_major_scope_without_program(client):
    # Seed a fresh advisor user via session
    from backend.db import db
    from backend.models import User
    with client.application.app_context():
        u = User(email="adv@andrew.cmu.edu", name="Adv", role="advisor", advisor_scope="major", primary_program="CS", google_sub="g-adv")
        db.session.add(u); db.session.commit()
        uid = u.id
    with client.session_transaction() as s: s.clear(); s["uid"] = uid; s.permanent = True

    # Trying to clear primary_program while role=advisor + scope=major
    r = client.patch("/api/me", json={"primary_program": ""})
    assert r.status_code == 400
    assert r.get_json()["error"] == "inconsistent_profile"


def test_patch_me_accepts_consistent_advisor_minor(client):
    from backend.db import db
    from backend.models import User
    with client.application.app_context():
        u = User(email="adv2@andrew.cmu.edu", name="Adv2", role="advisor", advisor_scope="major", primary_program="CS", google_sub="g-adv2")
        db.session.add(u); db.session.commit()
        uid = u.id
    with client.session_transaction() as s: s.clear(); s["uid"] = uid; s.permanent = True

    # Switch advisor from major-scope CS to minor-scope History
    r = client.patch("/api/me", json={
        "advisor_scope": "minor",
        "primary_program": "",
        "minor_code": "history",
    })
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["advisor_scope"] == "minor"
    assert body["primary_program"] is None
    assert body["minor_code"] == "history"


def test_patch_me_rejects_advisor_all_programs_with_program(client):
    from backend.db import db
    from backend.models import User
    with client.application.app_context():
        u = User(email="adv3@andrew.cmu.edu", name="Adv3", role="advisor", advisor_scope="all_programs", google_sub="g-adv3")
        db.session.add(u); db.session.commit()
        uid = u.id
    with client.session_transaction() as s: s.clear(); s["uid"] = uid; s.permanent = True

    # all_programs scope should not also have a primary_program
    r = client.patch("/api/me", json={"primary_program": "CS"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "inconsistent_profile"


# ── Admin demotion / no-demotion via env ───────────────────

def test_google_signin_syncs_directory_role_on_relogin(client):
    """Directory-listed faculty keep their role on every login."""
    directory = {
        "prof@andrew.cmu.edu": {
            "email": "prof@andrew.cmu.edu",
            "role": "professor",
            "primary_program": "IS",
        }
    }
    with patch("backend.auth.load_merged_directory", return_value=directory):
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake_google_payload(email="prof@andrew.cmu.edu", sub="g-prof")):
            client.post("/api/auth/google", json={"credential": "stub"})
            r = client.post("/api/auth/google", json={"credential": "stub"})
    assert r.get_json()["role"] == "professor"


def test_login_demotes_non_env_admin_without_directory(client):
    """Accounts marked admin in DB but not in ADMIN_EMAILS or directory become students."""
    from backend.db import db
    from backend.models import User
    with client.application.app_context():
        u = User(email="exadmin@andrew.cmu.edu", name="Ex", role="admin", is_admin=True, google_sub="g-ex")
        db.session.add(u)
        db.session.commit()

    with patch("backend.auth.id_token.verify_oauth2_token",
               return_value=_fake_google_payload(email="exadmin@andrew.cmu.edu", sub="g-ex")):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "student"
    assert body["is_admin"] is False


# ── Logout ──────────────────────────────────────────────────

def test_logout_clears_session(client, student):
    login(client, student)
    assert client.get("/api/me").status_code == 200
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.get("/api/me").status_code == 401


# ── Self-service role lockdown + seed recognition ───────────

def test_patch_me_rejects_self_assign_faculty(client, student):
    """A student can no longer PATCH themselves into a faculty role — faculty
    roles come from the seed file or an admin (users.py), never self-service."""
    login(client, student)
    r = client.patch("/api/me", json={"role": "professor", "primary_program": "IS"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_role"


def test_admin_skips_onboarding(client):
    """Admin from directory with department + program is profile-complete on login."""
    directory = {
        "admin@andrew.cmu.edu": {
            "email": "admin@andrew.cmu.edu",
            "name": "Admin",
            "role": "admin",
            "department": "Dean's Office",
            "primary_program": "IS",
        }
    }
    with patch("backend.auth.resolve_directory_entry", side_effect=lambda e: directory.get(e)):
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake("admin@andrew.cmu.edu", "g-admin")):
            r = client.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "admin"
    assert body["is_admin"] is True
    assert body["profile_completed"] is True


def test_seed_user_recognized_as_faculty_on_signin(tmp_path):
    """A seeded email is recognized as faculty on first login and lands in the
    app (profile complete), instead of self-declaring on the onboarding page."""
    seed = tmp_path / "seed_users.json"
    seed.write_text(json.dumps([
        {"email": "hbouamor@andrew.cmu.edu", "name": "Houda Bouamor",
         "role": "associate_area_head", "primary_program": "IS", "department": "Information Systems"},
    ]))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.test_client() as c:
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake("hbouamor@andrew.cmu.edu", "g-houda")):
            r = c.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "associate_area_head"
    assert body["primary_program"] == "IS"
    assert body["profile_completed"] is True


def test_admin_directory_overrides_json_seed_role(tmp_path):
    """Postgres directory entry (role=admin) overrides JSON seed (role=professor)."""
    from backend.db import db
    from backend.models import DirectoryEntry

    seed = tmp_path / "seed_users.json"
    seed.write_text(json.dumps([
        {"email": "admin@andrew.cmu.edu", "role": "professor", "primary_program": "IS",
         "department": "Information Systems", "name": "Admin"},
    ]))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.app_context():
        db.session.add(DirectoryEntry(
            email="admin@andrew.cmu.edu",
            name="Admin",
            role="admin",
            department="Dean's Office",
            primary_program="IS",
        ))
        db.session.commit()
    with app.test_client() as c:
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake("admin@andrew.cmu.edu", "g-admin")):
            r = c.post("/api/auth/google", json={"credential": "stub"})
    assert r.get_json()["role"] == "admin"


# ── Faculty directory recognition ───────────────────────────

def test_google_signin_faculty_from_directory_format(tmp_path):
    seed = tmp_path / "faculty_directory.json"
    seed.write_text(json.dumps({
        "people": [
            {"email": "hbouamor@andrew.cmu.edu", "name": "Houda Bouamor",
             "role": "professor", "primary_program": "IS", "department": "Information Systems"},
        ]
    }))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.test_client() as c:
        with patch("backend.auth.id_token.verify_oauth2_token",
                   return_value=_fake("hbouamor@andrew.cmu.edu", "g-hb")):
            r = c.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert r.status_code == 200
    assert body["role"] == "professor"
    assert body["primary_program"] == "IS"
    assert body["profile_completed"] is True


# ── Password register / login / reset ───────────────────────

def test_register_and_login(client):
    r = client.post("/api/auth/register", json={
        "email": "newbie@andrew.cmu.edu",
        "password": "securepass1",
        "confirm_password": "securepass1",
        "name": "New Student",
    })
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["role"] == "student"
    assert r.get_json()["role_group"] == "student"
    assert r.get_json()["profile_completed"] is False

    client.post("/api/auth/logout")
    bad = client.post("/api/auth/login", json={
        "email": "newbie@andrew.cmu.edu",
        "password": "wrongpass",
    })
    assert bad.status_code == 401

    ok = client.post("/api/auth/login", json={
        "email": "newbie@andrew.cmu.edu",
        "password": "securepass1",
    })
    assert ok.status_code == 200
    assert ok.get_json()["email"] == "newbie@andrew.cmu.edu"


def test_register_faculty_from_seed(client, tmp_path):
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps([
        {"email": "fac@andrew.cmu.edu", "name": "Faculty One",
         "role": "professor", "primary_program": "CS"},
    ]))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.test_client() as c:
        r = c.post("/api/auth/register", json={
            "email": "fac@andrew.cmu.edu",
            "password": "facultypass",
            "confirm_password": "facultypass",
        })
    body = r.get_json()
    assert r.status_code == 201
    assert body["role"] == "professor"
    assert body["profile_completed"] is True


def test_forgot_and_reset_password(client, monkeypatch):
    monkeypatch.setenv("EXPOSE_RESET_TOKEN", "1")
    client.post("/api/auth/register", json={
        "email": "resetme@andrew.cmu.edu",
        "password": "oldpass123",
        "confirm_password": "oldpass123",
    })
    client.post("/api/auth/logout")

    r = client.post("/api/auth/forgot-password", json={"email": "resetme@andrew.cmu.edu"})
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("reset_token")
    assert "reset_url" in data
    assert "reset_token=" in data["reset_url"] or "token=" in data["reset_url"]

    r2 = client.post("/api/auth/reset-password", json={
        "token": data["reset_token"],
        "password": "newpass456",
    })
    assert r2.status_code == 200

    ok = client.post("/api/auth/login", json={
        "email": "resetme@andrew.cmu.edu",
        "password": "newpass456",
    })
    assert ok.status_code == 200


def test_forgot_password_generic_when_unknown(client, monkeypatch):
    monkeypatch.setenv("EXPOSE_RESET_TOKEN", "1")
    r = client.post("/api/auth/forgot-password", json={"email": "nobody@andrew.cmu.edu"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True
    assert "reset_token" not in body


def test_forgot_password_503_when_no_provider(client):
    """No email provider configured and no dev exposure → honest failure that
    steers the user to Google recovery, same response for any email (no
    account enumeration)."""
    for email in ("resetme@andrew.cmu.edu", "nobody@andrew.cmu.edu"):
        r = client.post("/api/auth/forgot-password", json={"email": email})
        assert r.status_code == 503
        body = r.get_json()
        assert body["error"] == "email_unavailable"
        assert body["google_recovery"] is True


def test_set_password_when_authenticated(client):
    """Google-recovery path: an authenticated user sets a new password with
    no reset token, then signs in with it."""
    client.post("/api/auth/register", json={
        "email": "recover@andrew.cmu.edu",
        "password": "origpass1",
        "confirm_password": "origpass1",
    })  # register leaves the user signed in (stands in for the Google sign-in)
    r = client.post("/api/auth/set-password", json={"password": "brandnew99"})
    assert r.status_code == 200, r.get_json()
    client.post("/api/auth/logout")
    ok = client.post("/api/auth/login", json={
        "email": "recover@andrew.cmu.edu",
        "password": "brandnew99",
    })
    assert ok.status_code == 200


def test_set_password_requires_login(client):
    r = client.post("/api/auth/set-password", json={"password": "whatever123"})
    assert r.status_code == 401


def test_set_password_rejects_weak(client):
    client.post("/api/auth/register", json={
        "email": "weak@andrew.cmu.edu",
        "password": "origpass1",
        "confirm_password": "origpass1",
    })
    r = client.post("/api/auth/set-password", json={"password": "short"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "weak_password"


def test_reset_password_works_for_google_only_account(client, monkeypatch):
    monkeypatch.setenv("EXPOSE_RESET_TOKEN", "1")
    from backend.db import db
    from backend.models import User
    with client.application.app_context():
        u = User(email="google@andrew.cmu.edu", name="G", role="student", google_sub="g-1")
        db.session.add(u)
        db.session.commit()

    r = client.post("/api/auth/forgot-password", json={"email": "google@andrew.cmu.edu"})
    token = r.get_json()["reset_token"]
    r2 = client.post("/api/auth/reset-password", json={"token": token, "password": "newpass789"})
    assert r2.status_code == 200

    ok = client.post("/api/auth/login", json={"email": "google@andrew.cmu.edu", "password": "newpass789"})
    assert ok.status_code == 200


def test_register_login_normalizes_cmu_domain(client, tmp_path):
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps([
        {"email": "fac@andrew.cmu.edu", "role": "professor", "primary_program": "CS"},
    ]))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.test_client() as c:
        c.post("/api/auth/register", json={
            "email": "fac@cmu.edu",
            "password": "password12",
            "confirm_password": "password12",
        })
        c.post("/api/auth/logout")
        ok = c.post("/api/auth/login", json={"email": "fac@cmu.edu", "password": "password12"})
    body = ok.get_json()
    assert ok.status_code == 200
    assert body["email"] == "fac@andrew.cmu.edu"
    assert body["role"] == "professor"
    assert body["role_group"] == "faculty"


def test_login_passwordless_user_gets_clear_error(client, app):
    """Users without password_hash need Create account, not generic 401."""
    _make_user(app, "googleonly@andrew.cmu.edu", name="Google Only", google_sub=None)
    r = client.post("/api/auth/login", json={
        "email": "googleonly@andrew.cmu.edu",
        "password": "anypassword1",
    })
    assert r.status_code == 401
    body = r.get_json()
    assert body["error"] == "no_password_set"
    assert "Create account" in body["message"]


def test_login_with_bearer_token_without_session_cookie(client):
    client.post("/api/auth/register", json={
        "email": "bearer@andrew.cmu.edu",
        "password": "testpass12",
        "confirm_password": "testpass12",
    })
    login = client.post("/api/auth/login", json={
        "email": "bearer@andrew.cmu.edu",
        "password": "testpass12",
    })
    token = login.get_json().get("auth_token")
    assert token

    client.post("/api/auth/logout")
    me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.get_json()["email"] == "bearer@andrew.cmu.edu"


def test_faculty_directory_reapplied_on_login(client, tmp_path):
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps([
        {"email": "prof@andrew.cmu.edu", "role": "professor", "primary_program": "IS"},
    ]))

    class SeedConfig(TestConfig):
        SEED_USERS_PATH = str(seed)

    app = create_app(SeedConfig)
    with app.test_client() as c:
        c.post("/api/auth/register", json={
            "email": "prof@andrew.cmu.edu",
            "password": "password12",
            "confirm_password": "password12",
        })
        with app.app_context():
            u = db.session.query(User).filter_by(email="prof@andrew.cmu.edu").one()
            u.role = "student"
            u.profile_completed = True
            db.session.commit()
        c.post("/api/auth/logout")
        ok = c.post("/api/auth/login", json={"email": "prof@andrew.cmu.edu", "password": "password12"})
    assert ok.get_json()["role"] == "professor"
    assert ok.get_json()["role_group"] == "faculty"


# ── Non-CMU and domain-restricted emails at the route level ─

@pytest.mark.parametrize("path", [
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/forgot-password",
])
@pytest.mark.parametrize("email", ["user@gmail.com", "@andrew.cmu.edu", "al ice@andrew.cmu.edu"])
def test_auth_routes_reject_non_cmu_email(client, path, email):
    r = client.post(path, json={
        "email": email,
        "password": "password12",
        "confirm_password": "password12",
    })
    assert r.status_code == 400, r.get_json()
    assert r.get_json()["error"] == "invalid_email"
    with client.application.app_context():
        assert db.session.query(User).count() == 0


def test_google_signin_rejects_non_cmu_email(client):
    payload = _fake_google_payload(email="user@gmail.com")
    with patch("backend.auth.id_token.verify_oauth2_token", return_value=payload):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    assert r.status_code == 401, r.get_json()
    with client.application.app_context():
        assert db.session.query(User).count() == 0


def _domain_app(domain):
    class DomainConfig(TestConfig):
        ALLOWED_EMAIL_DOMAIN = domain

    return create_app(DomainConfig)


def test_allowed_domain_accepts_cmu_aliases():
    app = _domain_app("andrew.cmu.edu")
    payload = _fake_google_payload(email="Alice@Qatar.CMU.edu")
    with app.test_client() as c:
        with patch("backend.auth.id_token.verify_oauth2_token", return_value=payload):
            g = c.post("/api/auth/google", json={"credential": "stub"})
        c.post("/api/auth/logout")
        reg = c.post("/api/auth/register", json={
            "email": "Bob@cmu.edu",
            "password": "password12",
            "confirm_password": "password12",
        })
    assert g.status_code == 200, g.get_json()
    assert g.get_json()["email"] == "alice@andrew.cmu.edu"
    assert reg.status_code == 201, reg.get_json()
    assert reg.get_json()["email"] == "bob@andrew.cmu.edu"


def test_allowed_domain_rejects_other_domain():
    app = _domain_app("example.edu")
    payload = _fake_google_payload(email="alice@andrew.cmu.edu")
    with app.test_client() as c:
        reg = c.post("/api/auth/register", json={
            "email": "bob@andrew.cmu.edu",
            "password": "password12",
            "confirm_password": "password12",
        })
        with patch("backend.auth.id_token.verify_oauth2_token", return_value=payload):
            g = c.post("/api/auth/google", json={"credential": "stub"})
    for r in (reg, g):
        assert r.status_code == 403, r.get_json()
        assert r.get_json()["error"] == "domain_not_allowed"
