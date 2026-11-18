"""backend/reset_link.py: a one-time password link printed on the server."""
import json
from urllib.parse import parse_qs, urlparse

import pytest

from backend.db import db
from backend.models import User
from backend.reset_link import make_reset_link


def _token(link):
    return parse_qs(urlparse(link).query)["token"][0]


def test_link_lets_a_seeded_admin_in_on_a_new_server(app, tmp_path):
    admins = tmp_path / "admins.json"
    admins.write_text(json.dumps({"people": [
        {"email": "boss@andrew.cmu.edu", "name": "Boss", "role": "admin",
         "primary_program": "AS", "department": "Humanities and Social Sciences (H&SS)"},
    ]}))
    app.config["ADMIN_SEED_PATH"] = str(admins)
    c = app.test_client()
    # The staff email cannot register with a password (it would prove nothing) ...
    r = c.post("/api/auth/register", json={"email": "boss@andrew.cmu.edu", "password": "longenough1", "confirm_password": "longenough1"})
    assert r.status_code == 403
    # ... but someone with a shell on the server can hand out a link.
    with app.app_context():
        link, created, minutes = make_reset_link("Boss@andrew.cmu.edu", name="Boss")
        assert created and minutes == 30
        user = db.session.query(User).filter_by(email="boss@andrew.cmu.edu").one()
        assert user.password_hash is None and user.role == "student"
    assert "token=" in link
    r = c.post("/api/auth/reset-password", json={"token": _token(link), "password": "longenough1"})
    assert r.status_code == 200, r.get_json()
    r = c.post("/api/auth/login", json={"email": "boss@andrew.cmu.edu", "password": "longenough1"})
    assert r.status_code == 200 and r.get_json()["role"] == "admin"
    # The link works once.
    r = c.post("/api/auth/reset-password", json={"token": _token(link), "password": "another-pass2"})
    assert r.status_code == 400


def test_link_for_an_existing_account_keeps_it(app):
    with app.app_context():
        db.session.add(User(email="old@andrew.cmu.edu", name="Old Student", role="student"))
        db.session.commit()
        link, created, _ = make_reset_link("old@andrew.cmu.edu")
        assert not created
        assert db.session.query(User).filter_by(email="old@andrew.cmu.edu").count() == 1


def test_refuses_other_domains_and_shibboleth_mode(app):
    with app.app_context():
        with pytest.raises(ValueError):
            make_reset_link("someone@gmail.com")
        app.config["AUTH_MODE"] = "shibboleth"
        with pytest.raises(ValueError):
            make_reset_link("someone@andrew.cmu.edu")
