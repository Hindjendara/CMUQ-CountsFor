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


def test_roster_names_each_students_minors(client, student, professor):
    from .conftest import login as _login
    _login(client, student)
    assert client.patch("/api/me", json={"primary_program": "CS", "minor_codes": ["psychology"]}).status_code == 200
    assert client.post("/api/wishlist", json={"course_code": "15-112"}).status_code in (200, 201)
    _login(client, professor)
    r = client.get("/api/wishlist/roster")
    assert r.status_code == 200, r.get_json()
    [entry] = r.get_json()["students"]
    assert entry["email"] == "alice@andrew.cmu.edu"
    assert entry["minor_codes"] == ["psychology"]
