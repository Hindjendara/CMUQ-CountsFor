"""Admin console API tests."""
from .conftest import login, _make_user


def _add_flag(client, user, code="15-122", **kw):
    login(client, user)
    r = client.post("/api/flags", json={
        "course_code": code,
        "course_name": kw.get("name", "Principles of Imperative Computation"),
        "reason_code": "requirement_mismatch",
        "reason_label": "Counts for the wrong requirement",
    })
    assert r.status_code == 201, r.get_json()
    return r.get_json()["id"]


def _register(client, email, password="testpass12"):
    """Sign in for real through the password registration route."""
    client.post("/api/auth/logout")
    return client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "confirm_password": password,
    })


def test_admin_endpoints_require_admin(client, student, professor):
    for user in (student, professor):
        login(client, user)
        for path in ("/api/admin/overview", "/api/admin/insights", "/api/admin/activity"):
            assert client.get(path).status_code == 403, (user.role, path)


def test_admin_endpoints_require_login(client):
    assert client.get("/api/admin/overview").status_code == 401


def test_overview_counts(client, app, admin, student, professor):
    _make_user(app, "bob@andrew.cmu.edu", role="student", primary_program="IS")
    _add_flag(client, professor)
    login(client, student)
    client.post("/api/wishlist", json={"course_code": "15-122"})

    login(client, admin)
    r = client.get("/api/admin/overview")
    assert r.status_code == 200
    body = r.get_json()
    assert body["users"]["total"] == 4
    assert body["users"]["by_group"] == {"student": 2, "faculty": 1, "admin": 1}
    assert body["users"]["new_7d"] == 4
    assert body["flags"]["pending"] == 1
    assert body["wishlist"] == {"items": 1, "students": 1}
    assert "last_scrape" in body["course_data"]
    assert len(body["recent_signups"]) == 4


def test_insights_aggregates_lookups_saves_and_flags(client, app, admin, student, professor):
    login(client, student)
    for _ in range(3):
        client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "F26"})
    client.post("/api/search-analytics/events", json={"course_code": "67-262", "semester_code": "S26"})
    client.post("/api/wishlist", json={"course_code": "67-262"})
    flag_id = _add_flag(client, professor)
    _add_flag(client, professor)
    login(client, admin)
    client.patch(f"/api/flags/{flag_id}", json={"status": "resolved"})

    body = client.get("/api/admin/insights").get_json()
    assert body["top_lookups"][0] == {"course_code": "15-122", "count": 3}
    assert body["lookups_by_program"]["CS"][0]["course_code"] == "15-122"
    assert body["most_saved"] == [{"course_code": "67-262", "count": 1}]
    assert body["most_flagged"][0]["total"] == 2
    assert body["most_flagged"][0]["open"] == 1
    assert body["students_by_program"] == {"CS": 1}
    assert sum(body["signups_by_week"]["counts"]) == 3
    assert body["semesters"] == ["F26", "S26"]

    fall = client.get("/api/admin/insights?semester=F26").get_json()
    assert [r["course_code"] for r in fall["top_lookups"]] == ["15-122"]


def test_user_role_change_is_logged(client, admin, student):
    login(client, admin)
    r = client.patch(f"/api/users/{student.id}", json={"role": "professor", "department": "Computer Science", "primary_program": "CS"})
    assert r.status_code == 200, r.get_json()

    items = client.get("/api/admin/activity").get_json()["items"]
    assert len(items) == 1
    event = items[0]
    assert event["action"] == "user.update"
    assert event["target"] == student.email
    assert event["actor_email"] == admin.email
    assert event["details"]["changes"]["role"] == {"from": "student", "to": "professor"}


def test_saving_without_changes_is_not_logged(client, admin, student):
    login(client, admin)
    client.patch(f"/api/users/{student.id}", json={"role": "student", "primary_program": "CS"})
    assert client.get("/api/admin/activity").get_json()["total"] == 0


def test_flag_review_and_directory_changes_are_logged(client, admin, professor):
    flag_id = _add_flag(client, professor)
    login(client, admin)
    client.patch(f"/api/flags/{flag_id}", json={"status": "reviewed"})
    client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "Checked with the registrar"})
    r = client.post("/api/directory/entries", json={
        "email": "newprof@andrew.cmu.edu", "name": "New Prof", "role": "professor",
        "department": "Computer Science", "primary_program": "CS",
    })
    assert r.status_code == 201, r.get_json()
    client.delete(f"/api/directory/entries/{r.get_json()['id']}")

    actions = [e["action"] for e in client.get("/api/admin/activity").get_json()["items"]]
    assert actions == ["directory.remove", "directory.add", "flag.note", "flag.status"]

    only_flags = client.get("/api/admin/activity?action=flag.").get_json()
    assert only_flags["total"] == 2


def test_user_list_filters_and_reports_total(client, app, admin, student, professor):
    _make_user(app, "carol@andrew.cmu.edu", role="student", primary_program="BA")
    login(client, admin)
    body = client.get("/api/users?role_group=student").get_json()
    assert body["total"] == 2
    assert {u["role"] for u in body["items"]} == {"student"}
    assert body["items"][0]["created_at"]
    assert client.get("/api/users?role_group=faculty").get_json()["total"] == 1
    limited = client.get("/api/users?limit=1").get_json()
    assert limited["total"] == 4 and len(limited["items"]) == 1


# ── Sign-in analytics ────────────────────────────────────────
def test_sign_ins_requires_admin(client, student, professor):
    for user in (student, professor):
        login(client, user)
        assert client.get("/api/admin/sign-ins").status_code == 403
    client.post("/api/auth/logout")
    assert client.get("/api/admin/sign-ins").status_code == 401


def test_sign_in_and_visits_are_tracked(client, app, admin):
    # A real sign-in (account registration) records an event and a day row.
    r = _register(client, "newkid@andrew.cmu.edu")
    assert r.status_code == 201, r.get_json()
    client.get("/api/me")
    client.get("/api/me")

    login(client, admin)
    body = client.get("/api/admin/sign-ins?days=7").get_json()
    assert body["days"] == 7
    assert len(body["daily"]) == 7
    people = {p["email"]: p for p in body["users"]}
    kid = people["newkid@andrew.cmu.edu"]
    assert kid["sign_ins"] == 1
    assert kid["visits"] == 2
    assert kid["days_active"] == 1
    assert kid["last_method"] == "register"
    assert kid["is_new"] is True
    assert body["by_method"].get("register") == 1
    assert body["totals"]["active_users"] >= 1
    assert body["daily"][-1]["users"] >= 1
    assert sum(body["by_hour"]) >= 1


def test_overview_active_week_matches_sign_ins(client, app, admin):
    _register(client, "a1@andrew.cmu.edu")
    _register(client, "a2@andrew.cmu.edu")
    login(client, admin)
    overview = client.get("/api/admin/overview").get_json()
    sign_ins = client.get("/api/admin/sign-ins").get_json()
    assert overview["users"]["active_7d"] >= 2
    tracked = {p["email"] for p in sign_ins["users"]}
    assert {"a1@andrew.cmu.edu", "a2@andrew.cmu.edu"} <= tracked


def test_sign_ins_window_falls_back_to_seven(client, admin):
    login(client, admin)
    assert client.get("/api/admin/sign-ins?days=12").get_json()["days"] == 7
    assert client.get("/api/admin/sign-ins?days=nope").get_json()["days"] == 7
    assert len(client.get("/api/admin/sign-ins?days=30").get_json()["daily"]) == 30


def test_backfill_turns_last_login_into_history(app):
    from datetime import datetime, timedelta, timezone
    from backend.db import db
    from backend.migrate import _backfill_sign_in_history
    from backend.models import SignInEvent, User, UserActivityDay

    with app.app_context():
        when = datetime.now(timezone.utc) - timedelta(days=2)
        db.session.add(User(email="old@andrew.cmu.edu", name="Old", role="student", last_login=when))
        db.session.commit()
        assert _backfill_sign_in_history() == 1
        assert db.session.query(SignInEvent).filter_by(method="before_tracking").count() == 1
        assert db.session.query(UserActivityDay).count() == 1
        # Runs only once.
        assert _backfill_sign_in_history() == 0
