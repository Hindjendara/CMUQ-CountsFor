"""Every route reads its JSON body as an object: any other JSON value is a 400, never a 500."""
import json

import pytest

from backend.db import db
from backend.models import AdminAuditEvent, CourseOverride, DirectoryEntry, MinorOverride, User

from .conftest import login

INVALID_BODY = {"error": "invalid_body", "message": "The request body must be a JSON object."}
# Each of these used to reach a route's data.get(...) or set(data) and fail with a 500
# (the truthy ones), or was read as an empty object (the falsy ones).
NOT_OBJECTS = ["5", "true", '[{"a": 1}]', "[1, 2]", '"text"', "[]", "0", "false"]
ADMIN_WRITES = [
    ("PATCH", "/api/minors/overrides/psychology"),
    ("POST", "/api/courses/overrides/batch"),
    ("POST", "/api/courses/overrides"),
    ("PATCH", "/api/courses/overrides/15-122"),
    ("PATCH", "/api/users/{admin_id}"),
    ("POST", "/api/directory/entries"),
    ("PATCH", "/api/flags/flg-test"),
]


def _send(client, method, path, raw):
    return client.open(path, method=method, data=raw, content_type="application/json")


def _nothing_written(app):
    with app.app_context():
        assert db.session.query(CourseOverride).count() == 0
        assert db.session.query(MinorOverride).count() == 0
        assert db.session.query(DirectoryEntry).count() == 0
        assert db.session.query(AdminAuditEvent).count() == 0


@pytest.mark.parametrize("method,path", ADMIN_WRITES)
def test_admin_writes_refuse_a_body_that_is_not_an_object(client, admin, app, method, path):
    login(client, admin)
    for raw in NOT_OBJECTS:
        r = _send(client, method, path.format(admin_id=admin.id), raw)
        assert r.status_code == 400, (method, path, raw, r.status_code)
        assert r.get_json() == INVALID_BODY, (method, path, raw)
    _nothing_written(app)
    with app.app_context():
        assert db.session.get(User, admin.id).role == "admin"


def test_public_routes_refuse_it_too(client):
    r = _send(client, "POST", "/api/auth/login", "[1]")
    assert r.status_code == 400 and r.get_json() == INVALID_BODY


def test_null_and_empty_bodies_still_mean_no_fields(client, admin, app):
    login(client, admin)
    # null, no body and a body that is not JSON are read as {} by the route, as before.
    for raw, content_type in (("null", "application/json"), ("", "application/json"), ("[1]", "text/plain")):
        r = client.patch("/api/minors/overrides/psychology", data=raw, content_type=content_type)
        assert r.status_code == 200 and r.get_json() == {"minor_code": "psychology", "fields": {}}, (raw, content_type)
        r = client.patch("/api/courses/overrides/15-122", data=raw, content_type=content_type)
        assert r.status_code == 200 and r.get_json()["fields"] == {}, (raw, content_type)
        r = client.post("/api/courses/overrides/batch", data=raw, content_type=content_type)
        assert r.status_code == 400 and r.get_json()["error"] == "invalid_items", (raw, content_type)
    # GET requests are not checked (they carry no body the routes read).
    assert client.get("/api/courses/overrides", data="[1]", content_type="application/json").status_code == 200
    _nothing_written(app)


def test_course_text_fields_must_be_text(client, admin, app):
    login(client, admin)
    for field in ("course_name", "description", "prerequisites"):
        r = client.patch("/api/courses/overrides/15-122", json={field: 5})
        assert r.status_code == 400, field
        label = field.replace("_", " ").capitalize()
        assert r.get_json() == {"error": "invalid_field", "message": f"{label} must be text."}
    for name in (5, ["Data Structures"], {"en": "x"}, True):
        r = client.post("/api/courses/overrides", data=json.dumps({"course_code": "15-998", "course_name": name}),
                        content_type="application/json")
        assert r.status_code == 400 and r.get_json()["message"] == "Course name must be text.", name
    r = client.post("/api/courses/overrides", json={"course_code": "15-998", "course_name": "X", "description": 7})
    assert r.status_code == 400 and r.get_json()["message"] == "Description must be text."
    _nothing_written(app)
    # null still clears a text field, as before.
    r = client.patch("/api/courses/overrides/15-122", json={"description": None})
    assert r.status_code == 200 and r.get_json()["fields"] == {"description": ""}
