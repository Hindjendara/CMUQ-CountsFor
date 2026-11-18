"""Wishlist route tests — student-only, idempotent, isolated per user."""
from .conftest import login


def test_student_can_save_and_list(client, student):
    login(client, student)
    r = client.post("/api/wishlist", json={"course_code": "15-122"})
    assert r.status_code == 201
    r = client.get("/api/wishlist")
    assert r.status_code == 200
    items = r.get_json()["items"]
    assert len(items) == 1
    assert items[0]["course_code"] == "15-122"


def test_duplicate_save_is_idempotent(client, student):
    login(client, student)
    r1 = client.post("/api/wishlist", json={"course_code": "15-122"})
    assert r1.status_code == 201
    r2 = client.post("/api/wishlist", json={"course_code": "15-122"})
    assert r2.status_code == 200  # idempotent
    r = client.get("/api/wishlist")
    assert len(r.get_json()["items"]) == 1


def test_remove_course(client, student):
    login(client, student)
    client.post("/api/wishlist", json={"course_code": "15-122"})
    r = client.delete("/api/wishlist/15-122")
    assert r.status_code == 204
    assert client.get("/api/wishlist").get_json()["items"] == []


def test_remove_unknown_404(client, student):
    login(client, student)
    r = client.delete("/api/wishlist/99-999")
    assert r.status_code == 404


def test_professor_cannot_use_wishlist(client, professor):
    login(client, professor)
    assert client.get("/api/wishlist").status_code == 403
    assert client.post("/api/wishlist", json={"course_code": "15-122"}).status_code == 403


def test_unauthenticated_cannot_use_wishlist(client):
    assert client.get("/api/wishlist").status_code == 401


def test_wishlists_are_user_isolated(app, client, student):
    # Seed a second student via the same helper as the other fixtures.
    from .conftest import _make_user
    bob = _make_user(app, "bob@andrew.cmu.edu", role="student")

    # Alice saves a course
    login(client, student)
    client.post("/api/wishlist", json={"course_code": "15-122"})

    # Bob logs in — Alice's wishlist must NOT be visible
    login(client, bob)
    r = client.get("/api/wishlist")
    assert r.status_code == 200
    assert r.get_json()["items"] == []


def test_staff_see_only_anonymous_interest(app, client, student, professor):
    from .conftest import _make_user, login as _login
    bob = _make_user(app, "bob@andrew.cmu.edu", role="student")
    _login(client, student)
    assert client.post("/api/wishlist", json={"course_code": "15-112", "note": "private note"}).status_code in (200, 201)
    assert client.post("/api/wishlist", json={"course_code": "85-110"}).status_code in (200, 201)
    _login(client, bob)
    assert client.post("/api/wishlist", json={"course_code": "15-112"}).status_code in (200, 201)

    _login(client, professor)
    assert client.get("/api/wishlist/roster").status_code in (404, 405)  # the route is gone
    r = client.get("/api/wishlist/interest")
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["courses"] == [
        {"course_code": "15-112", "students": 2},
        {"course_code": "85-110", "students": 1},
    ]
    assert body["students"] == 2 and body["total_courses"] == 2
    text = r.get_data(as_text=True)
    assert "alice" not in text and "bob" not in text and "private note" not in text

    r = client.get("/api/wishlist/interest?limit=1")
    assert r.get_json()["courses"] == [{"course_code": "15-112", "students": 2}]
    assert r.get_json()["total_courses"] == 2


def test_students_cannot_read_interest(client, student):
    from .conftest import login as _login
    _login(client, student)
    assert client.get("/api/wishlist/interest").status_code == 403
