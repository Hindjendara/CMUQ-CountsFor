"""Directory API — name + email adds grant faculty view on login."""
from backend.db import db
from backend.models import DirectoryEntry, User
from .conftest import login


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

    r = client.post(
        "/api/auth/register",
        json={
            "email": "listed@andrew.cmu.edu",
            "password": "SecurePass1!",
            "confirm_password": "SecurePass1!",
            "name": "Listed Person",
        },
    )
    assert r.status_code == 201, r.get_json()
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
    assert r.status_code in (200, 201), r.get_json()
    me = client.get("/api/me").get_json()
    assert me["role"] == "admin" and me["role_group"] == "admin"
