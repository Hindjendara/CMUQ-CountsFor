"""User management route tests."""
from .conftest import login


def test_list_users_requires_manager(client, student):
    login(client, student)
    r = client.get("/api/users")
    assert r.status_code == 403


def test_admin_lists_users(client, admin, student):
    login(client, admin)
    r = client.get("/api/users")
    assert r.status_code == 200
    emails = {u["email"] for u in r.get_json()["items"]}
    assert student.email in emails


def test_area_head_can_patch_user_role(client, area_head):
    from backend.db import db
    from backend.models import User

    with client.application.app_context():
        u = User(
            email="newbie@andrew.cmu.edu",
            name="New",
            role="student",
            google_sub="g-new",
        )
        db.session.add(u)
        db.session.commit()
        uid = u.id

    login(client, area_head)
    r = client.patch(
        f"/api/users/{uid}",
        json={"role": "professor", "primary_program": "CS"},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["role"] == "professor"
    assert r.get_json()["profile_completed"] is True


def test_seeded_professor_skips_incomplete_on_login(client):
    from unittest.mock import patch
    from backend.db import db
    from backend.models import User

    with client.application.app_context():
        u = User(
            email="prof@andrew.cmu.edu",
            name="Prof",
            role="professor",
            primary_program="CS",
            profile_completed=True,
            google_sub="g-prof2",
        )
        db.session.add(u)
        db.session.commit()

    with patch(
        "backend.auth.id_token.verify_oauth2_token",
        return_value={
            "sub": "g-prof2",
            "email": "prof@andrew.cmu.edu",
            "email_verified": True,
            "name": "Prof",
        },
    ):
        r = client.post("/api/auth/google", json={"credential": "stub"})
    body = r.get_json()
    assert body["role"] == "professor"
    assert body["profile_completed"] is True


# GET /api/users/students: faculty and admins open one student's major and minors (README 8.10).
def _give_minors(client, student, codes):
    login(client, student)
    r = client.patch("/api/me", json={"primary_program": "CS", "minor_codes": codes})
    assert r.status_code == 200, r.get_json()


def test_faculty_and_admins_list_students_with_their_programs(client, app, student, professor, admin):
    from .conftest import _make_user
    _make_user(app, "bob@andrew.cmu.edu", role="student", primary_program="BA", name="Bob Builder")
    _give_minors(client, student, ["psychology", "economics"])
    for viewer in (professor, admin):
        login(client, viewer)
        r = client.get("/api/users/students")
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["total"] == 2
        by_email = {s["email"]: s for s in body["items"]}
        # Students only, with their programs; no faculty or admins in the list.
        assert set(by_email) == {"alice@andrew.cmu.edu", "bob@andrew.cmu.edu"}
        assert by_email["alice@andrew.cmu.edu"]["primary_program"] == "CS"
        assert by_email["alice@andrew.cmu.edu"]["minor_codes"] == ["psychology", "economics"]
        assert set(by_email["alice@andrew.cmu.edu"]) == {"id", "name", "email", "primary_program", "minor_codes"}
    r = client.get("/api/users/students?search=builder")
    assert [s["email"] for s in r.get_json()["items"]] == ["bob@andrew.cmu.edu"]
    r = client.get("/api/users/students?limit=1")
    assert len(r.get_json()["items"]) == 1 and r.get_json()["total"] == 2


def test_students_cannot_list_students(client, student):
    assert client.get("/api/users/students").status_code == 401
    login(client, student)
    assert client.get("/api/users/students").status_code == 403
