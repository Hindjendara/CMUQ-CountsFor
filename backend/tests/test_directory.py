"""Directory API — name + email adds grant faculty view on login."""
from unittest.mock import patch

from backend.db import db
from backend.models import DirectoryEntry, User
from .conftest import login


def _google_sign_in(client, email):
    """Sign in through /api/auth/google with Google's token check mocked.
    Faculty and staff sign in this way (or with CMU sign-in): password
    registration is refused for their emails (README 21.1)."""
    payload = {"sub": "g-" + email, "email": email, "email_verified": True, "name": email.split("@")[0]}
    with patch("backend.auth.id_token.verify_oauth2_token", return_value=payload):
        return client.post("/api/auth/google", json={"credential": "stub"})


def test_add_directory_entry_name_email_only(client, professor):
    login(client, professor)
    r = client.post(
        "/api/directory/entries",
        json={"name": "New Faculty", "email": "new.faculty@andrew.cmu.edu"},
    )
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["name"] == "New Faculty"
    assert body["email"] == "new.faculty@andrew.cmu.edu"
    assert body["role"] == "professor"
    assert body["department"] == "Dean's Office"
    assert body["primary_program"] == "AS"

    with client.application.app_context():
        row = db.session.query(DirectoryEntry).filter_by(email="new.faculty@andrew.cmu.edu").one()
        assert row.role == "professor"


def test_directory_entry_grants_faculty_view_on_login(client, professor):
    login(client, professor)
    client.post(
        "/api/directory/entries",
        json={"name": "Listed Person", "email": "listed@andrew.cmu.edu"},
    )

    # A password account for a listed email is refused: register cannot prove
    # the caller owns the address.
    r = client.post(
        "/api/auth/register",
        json={
            "email": "listed@andrew.cmu.edu",
            "password": "SecurePass1!",
            "confirm_password": "SecurePass1!",
            "name": "Listed Person",
        },
    )
    assert r.status_code == 403, r.get_json()
    assert r.get_json()["error"] == "staff_email"

    r = _google_sign_in(client, "listed@andrew.cmu.edu")
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["role_group"] == "faculty"
    assert body["role"] == "professor"

    with client.application.app_context():
        u = db.session.query(User).filter_by(email="listed@andrew.cmu.edu").one()
        assert u.role_group() == "faculty"


def test_student_not_in_directory_gets_student_view(client):
    r = client.post(
        "/api/auth/register",
        json={
            "email": "student.only@andrew.cmu.edu",
            "password": "SecurePass1!",
            "confirm_password": "SecurePass1!",
            "name": "Student Only",
        },
    )
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["role_group"] == "student"


def test_students_cannot_list_directory(client, student):
    login(client, student)
    r = client.get("/api/directory/entries")
    assert r.status_code == 403


def test_admin_seed_file_grants_admin_over_faculty_seed(app, tmp_path):
    """backend/data/directory_admins.json style file is layered over the faculty seed."""
    import json
    from backend.db import db
    from backend.directory import resolve_directory_entry

    faculty = tmp_path / "faculty.json"
    faculty.write_text(json.dumps({"people": [
        {"email": "prof@andrew.cmu.edu", "name": "Prof", "role": "professor", "primary_program": "CS", "department": "Computer Science"},
    ]}))
    admins = tmp_path / "admins.json"
    admins.write_text(json.dumps({"people": [
        {"email": "boss@andrew.cmu.edu", "name": "Boss", "role": "admin", "primary_program": "CS", "department": "Computer Science"},
    ]}))
    app.config["SEED_USERS_PATH"] = str(faculty)
    app.config["ADMIN_SEED_PATH"] = str(admins)
    with app.app_context():
        assert resolve_directory_entry("boss@andrew.cmu.edu")["role"] == "admin"
        assert resolve_directory_entry("prof@andrew.cmu.edu")["role"] == "professor"
        app.config["ADMIN_SEED_PATH"] = ""
        assert resolve_directory_entry("boss@andrew.cmu.edu") is None


def test_admin_seed_sign_in_makes_admin(app, client, tmp_path):
    import json
    admins = tmp_path / "admins.json"
    admins.write_text(json.dumps({"people": [
        {"email": "boss@andrew.cmu.edu", "name": "Boss", "role": "admin", "primary_program": "CS", "department": "Computer Science"},
    ]}))
    app.config["ADMIN_SEED_PATH"] = str(admins)
    r = client.post("/api/auth/register", json={"email": "boss@andrew.cmu.edu", "password": "a-long-password-1", "name": "Boss"})
    assert r.status_code == 403, r.get_json()
    assert r.get_json()["error"] == "staff_email"
    r = _google_sign_in(client, "boss@andrew.cmu.edu")
    assert r.status_code == 200, r.get_json()
    me = client.get("/api/me").get_json()
    assert me["role"] == "admin" and me["role_group"] == "admin"


# Only an admin grants, changes or removes admin access (README 21.1). Faculty keep
# every other directory write.
ADMIN_ENTRY = {"name": "Boss", "role": "admin", "primary_program": "CS", "department": "Computer Science"}


def _admin_rows(client):
    with client.application.app_context():
        return db.session.query(DirectoryEntry).filter_by(role="admin").count()


def test_faculty_cannot_grant_admin(client, professor):
    login(client, professor)
    r = client.post("/api/directory/entries", json=dict(ADMIN_ENTRY, email="boss@andrew.cmu.edu"))
    assert r.status_code == 403, r.get_json()
    assert r.get_json()["error"] == "admin_only"
    # Not to themselves either (the hole README 21.1 described).
    r = client.patch("/api/directory/entries/by-email", json=dict(ADMIN_ENTRY, email="prof@andrew.cmu.edu"))
    assert r.status_code == 403, r.get_json()
    r = client.post("/api/directory/entries", json={"name": "Prof", "email": "prof@andrew.cmu.edu"})
    assert r.status_code == 201, r.get_json()
    r = client.patch(f"/api/directory/entries/{r.get_json()['id']}", json={"role": "admin"})
    assert r.status_code == 403, r.get_json()
    assert _admin_rows(client) == 0


def test_faculty_cannot_change_or_remove_an_admin(client, admin, professor):
    login(client, admin)
    r = client.post("/api/directory/entries", json=dict(ADMIN_ENTRY, email="boss@andrew.cmu.edu"))
    assert r.status_code == 201, r.get_json()
    entry_id = r.get_json()["id"]

    login(client, professor)
    assert client.patch(f"/api/directory/entries/{entry_id}", json={"role": "professor"}).status_code == 403
    assert client.patch("/api/directory/entries/by-email", json={
        "email": "boss@andrew.cmu.edu", "name": "Boss", "role": "professor"}).status_code == 403
    assert client.delete(f"/api/directory/entries/{entry_id}").status_code == 403
    assert client.post("/api/directory/entries/revoke", json={"email": "boss@andrew.cmu.edu"}).status_code == 403
    assert _admin_rows(client) == 1

    login(client, admin)
    assert client.patch(f"/api/directory/entries/{entry_id}", json={"role": "professor", "department": "Computer Science"}).status_code == 200
    assert client.delete(f"/api/directory/entries/{entry_id}").status_code == 200


def test_faculty_cannot_uncover_an_admin_seed(app, client, admin, professor, tmp_path):
    """Removing a database entry that overrides an admin seed would make the person an admin again."""
    import json
    admins = tmp_path / "admins.json"
    admins.write_text(json.dumps({"people": [dict(ADMIN_ENTRY, email="boss@andrew.cmu.edu")]}))
    app.config["ADMIN_SEED_PATH"] = str(admins)
    login(client, admin)
    r = client.patch("/api/directory/entries/by-email", json={
        "email": "boss@andrew.cmu.edu", "name": "Boss", "role": "professor", "department": "Computer Science"})
    assert r.status_code in (200, 201), r.get_json()

    login(client, professor)
    assert client.delete(f"/api/directory/entries/{r.get_json()['id']}").status_code == 403
    assert client.post("/api/directory/entries/revoke", json={"email": "boss@andrew.cmu.edu"}).status_code == 403


def test_admin_can_grant_admin(client, admin):
    login(client, admin)
    r = client.post("/api/directory/entries", json=dict(ADMIN_ENTRY, email="boss@andrew.cmu.edu"))
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["role"] == "admin"
