"""Minor settings (unit total, double counting limits, a note) and the /health table check."""
from sqlalchemy import text

from backend.db import db
from backend.db_schema import REQUIRED_TABLES
from backend.tokens import make_auth_token

from .conftest import login


def _items(client):
    return client.get("/api/minors/overrides").get_json()["items"]


def _events(client):
    return client.get("/api/admin/activity?action=minor.").get_json()["items"]


def test_reads_are_public_and_writes_admin_only(client, student, professor):
    r = client.get("/api/minors/overrides")
    assert r.status_code == 200 and r.get_json() == {"items": []}
    assert r.headers["Cache-Control"] == "no-cache"
    for user in (student, professor):
        login(client, user)
        assert client.patch("/api/minors/overrides/psychology", json={"total_units": 63}).status_code == 403
        assert client.delete("/api/minors/overrides/psychology").status_code == 403


def test_list_shows_who_saved_to_admins_only(app, client, admin, student, professor):
    login(client, admin)
    assert client.patch("/api/minors/overrides/psychology", json={"max_with_major": 1}).status_code == 200
    [item] = _items(client)
    assert item["updated_by_email"] == "admin@andrew.cmu.edu" and item["updated_at"]
    # A guest, a student and a professor get the settings, but not who saved them.
    for user in (None, student, professor):
        viewer = app.test_client()
        if user:
            login(viewer, user)
        [item] = _items(viewer)
        assert item["fields"] == {"max_with_major": 1} and item["updated_at"], user
        assert "updated_by_email" not in item, user
    # An admin signed in with the bearer token alone (how the pages call the API) sees it.
    with app.app_context():
        token = make_auth_token(admin.id)
    r = app.test_client().get("/api/minors/overrides", headers={"Authorization": f"Bearer {token}"})
    assert r.get_json()["items"][0]["updated_by_email"] == "admin@andrew.cmu.edu"


def test_note_refuses_long_dashes(client, admin):
    """Students read the note in the minor header, so it follows the minor file's rule: plain hyphens only."""
    login(client, admin)
    for dash in "‒–—―":
        r = client.patch("/api/minors/overrides/psychology", json={"admin_note": f"Ask the advisor {dash} early."})
        assert r.status_code == 400, dash
        assert r.get_json() == {"error": "invalid_field", "message": "Use plain hyphens in the note, not long dashes."}
    assert _items(client) == []
    r = client.patch("/api/minors/overrides/psychology", json={"admin_note": "Ask the advisor - early."})
    assert r.status_code == 200 and r.get_json()["fields"] == {"admin_note": "Ask the advisor - early."}


def test_edit_merge_and_undo(client, admin):
    login(client, admin)
    # Psychology in minors.json: 72 units, no double counting limit.
    r = client.patch("/api/minors/overrides/psychology", json={"max_with_major": 1, "admin_note": "  Ask the advisor first.  "})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["fields"] == {"max_with_major": 1, "admin_note": "Ask the advisor first."}
    r = client.patch("/api/minors/overrides/psychology", json={"total_units": 63, "max_with_other_minors": 0})
    assert r.get_json()["fields"] == {"max_with_major": 1, "admin_note": "Ask the advisor first.",
                                      "total_units": 63, "max_with_other_minors": 0}
    event = _events(client)[0]
    assert event["action"] == "minor.update" and event["target"] == "psychology"
    assert event["details"]["changes"] == {"total_units": {"from": 72, "to": 63},
                                           "max_with_other_minors": {"from": None, "to": 0}}

    # The file's own value is not stored: setting it back removes the field.
    r = client.patch("/api/minors/overrides/psychology", json={"total_units": 72, "max_with_other_minors": None, "admin_note": ""})
    assert r.get_json()["fields"] == {"max_with_major": 1}
    # The same values again change nothing and log nothing.
    n = len(_events(client))
    client.patch("/api/minors/overrides/psychology", json={"max_with_major": 1})
    assert len(_events(client)) == n

    r = client.delete("/api/minors/overrides/psychology")
    assert r.status_code == 200
    assert _items(client) == []
    revert = _events(client)[0]
    assert revert["action"] == "minor.revert" and revert["details"]["before"] == {"max_with_major": 1}
    assert client.delete("/api/minors/overrides/psychology").status_code == 404


def test_back_to_the_file_deletes_the_row(client, admin):
    login(client, admin)
    client.patch("/api/minors/overrides/arabic", json={"max_with_major": 1})
    r = client.patch("/api/minors/overrides/arabic", json={"max_with_major": 2})  # the file says 2
    assert r.get_json()["fields"] == {}
    assert _items(client) == []
    assert _events(client)[0]["details"]["reason"] == "matches the minor file"


def test_validation(client, admin, app, tmp_path):
    login(client, admin)
    for body in ({"max_with_major": 11}, {"max_with_major": -1}, {"max_with_major": 1.5}, {"max_with_major": True},
                 {"max_with_major": "two"}, {"total_units": 401}, {"admin_note": "x" * 1001}, {"admin_note": 5},
                 {"campus_note": "Pittsburgh"}, {"name": "Psych"}):
        assert client.patch("/api/minors/overrides/psychology", json=body).status_code == 400, body
    assert client.patch("/api/minors/overrides/klingon", json={"total_units": 9}).status_code == 400
    assert client.patch("/api/minors/overrides/psychology", json={"total_units": "54"}).get_json()["fields"] == {"total_units": 54}
    # Without the minor file: the fallback list of minors, and nothing to compare with.
    app.config["MINORS_JSON_PATH"] = str(tmp_path / "missing.json")
    r = client.patch("/api/minors/overrides/history", json={"max_with_major": 2, "admin_note": ""})
    assert r.status_code == 200 and r.get_json()["fields"] == {"max_with_major": 2}
    # Product Management is in that list too (auth.VALID_MINORS_FOR_PATCH); a code outside it is refused.
    r = client.patch("/api/minors/overrides/product", json={"total_units": 9})
    assert r.status_code == 200 and r.get_json()["fields"] == {"total_units": 9}
    assert client.patch("/api/minors/overrides/klingon", json={"total_units": 9}).status_code == 400


def test_health_lists_the_tables(client, app):
    r = client.get("/health")
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["status"] == "ok" and body["database"] == "sqlite"
    assert REQUIRED_TABLES <= set(body["table_names"])
    assert "minor_overrides" in body["table_names"]
    with app.app_context():
        db.session.execute(text("DROP TABLE minor_overrides"))
        db.session.commit()
    r = client.get("/health")
    assert r.status_code == 503
    assert r.get_json()["missing"] == ["minor_overrides"]
