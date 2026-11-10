"""Course catalog edit tests."""
from .conftest import login

CS_CORE = {"requirement": "BS in Computer Science---Computer Science---Computer Science Core", "type": False}
GENED = {"requirement": "GenEd---Humanities and Arts---C. Humanities and Arts Electives", "type": True}


def test_writes_require_admin(client, student, professor):
    for user in (student, professor):
        login(client, user)
        assert client.post("/api/courses/overrides", json={"course_code": "15-999", "course_name": "X"}).status_code == 403
        assert client.patch("/api/courses/overrides/15-122", json={"course_name": "X"}).status_code == 403
        assert client.post("/api/courses/overrides/15-122/archive").status_code == 403
        assert client.delete("/api/courses/overrides/15-122").status_code == 403


def test_list_is_public(client):
    r = client.get("/api/courses/overrides")
    assert r.status_code == 200
    assert r.get_json() == {"items": []}


def test_edit_catalog_course_and_counts_for(client, admin):
    login(client, admin)
    r = client.patch("/api/courses/overrides/15-122", json={
        "course_name": "Imperative Computation",
        "units": "10",
        "requirements": {"CS": [CS_CORE, CS_CORE], "IS": [GENED]},
    })
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["is_new"] is False
    assert body["fields"] == {"course_name": "Imperative Computation", "units": 10}
    assert body["requirements"]["CS"] == [{**CS_CORE, "major": "CS"}]  # duplicate dropped
    assert body["requirements"]["IS"][0]["major"] == "IS"

    # A second edit merges with the first instead of replacing it.
    client.patch("/api/courses/overrides/15-122", json={"description": "New text"})
    items = client.get("/api/courses/overrides").get_json()["items"]
    assert items[0]["fields"] == {"course_name": "Imperative Computation", "units": 10, "description": "New text"}
    assert items[0]["requirements"]["IS"]


def test_counts_for_keeps_the_earlier_flag(client, admin):
    login(client, admin)
    earlier = {**CS_CORE, "earlier": True, "earlier_reason": "older degree version"}
    r = client.patch("/api/courses/overrides/15-122", json={
        "requirements": {"CS": [earlier, {**GENED, "earlier": False, "earlier_reason": "ignored"}]},
    })
    assert r.status_code == 200, r.get_json()
    rows = r.get_json()["requirements"]["CS"]
    assert rows[0] == {**CS_CORE, "major": "CS", "earlier": True, "earlier_reason": "older degree version"}
    assert rows[1] == {**GENED, "major": "CS"}  # no flag stored for a current row
    long_reason = {**CS_CORE, "earlier": True, "earlier_reason": "x" * 201}
    r = client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": [long_reason]}})
    assert r.status_code == 400


def test_renumber_catalog_course(client, admin):
    login(client, admin)
    # Same number written without the dash is not a change, and stores nothing.
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15122"})
    assert r.get_json()["fields"] == {}
    assert client.get("/api/courses/overrides").get_json()["items"] == []
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15-123"})
    assert r.get_json()["fields"]["course_code"] == "15-123"
    # Renumbering back to the original removes the change, and the now-empty row.
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15-122"})
    assert "course_code" not in r.get_json()["fields"]
    assert client.get("/api/courses/overrides").get_json()["items"] == []


def test_add_course_and_renumber_it(client, admin):
    login(client, admin)
    r = client.post("/api/courses/overrides", json={
        "course_code": "76-999", "course_name": "Special Topics in Writing", "department": "076",
        "units": 9, "offered_qatar": True, "offered": ["F26", "F26"], "requirements": {"IS": [GENED]},
    })
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["is_new"] is True
    assert body["fields"]["department"] == "76"
    assert body["fields"]["offered"] == ["F26"]

    assert client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "Dup"}).status_code == 409

    r = client.patch("/api/courses/overrides/76-999", json={"new_code": "76-998"})
    assert r.status_code == 200
    assert r.get_json()["course_code"] == "76-998"
    assert r.get_json()["fields"]["course_code"] == "76-998"
    assert client.get("/api/courses/overrides").get_json()["items"][0]["course_code"] == "76-998"


def test_validation_errors(client, admin):
    login(client, admin)
    assert client.post("/api/courses/overrides", json={"course_code": "abc", "course_name": "X"}).status_code == 400
    assert client.post("/api/courses/overrides", json={"course_code": "15-998"}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"units": "lots"}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"course_name": ""}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"requirements": {"XX": []}}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"offered": ["Fall"]}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"secret": 1}).status_code == 400
    assert client.get("/api/courses/overrides").get_json()["items"] == []


def test_archive_restore_and_revert(client, admin):
    login(client, admin)
    r = client.post("/api/courses/overrides/15-122/archive")
    assert r.status_code == 200 and r.get_json()["archived"] is True
    r = client.post("/api/courses/overrides/15-122/restore")
    assert r.get_json()["archived"] is False
    # Restored with no other edits, so nothing is stored any more.
    assert client.get("/api/courses/overrides").get_json()["items"] == []
    assert client.delete("/api/courses/overrides/15-122").status_code == 404

    client.patch("/api/courses/overrides/15-122", json={"course_name": "Renamed"})
    client.post("/api/courses/overrides/15-122/archive")
    client.post("/api/courses/overrides/15-122/restore")
    assert client.get("/api/courses/overrides").get_json()["items"][0]["fields"] == {"course_name": "Renamed"}
    assert client.delete("/api/courses/overrides/15-122").status_code == 200
    assert client.get("/api/courses/overrides").get_json()["items"] == []

    client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "New"})
    assert client.delete("/api/courses/overrides/76-999").status_code == 400


def test_course_changes_are_logged(client, admin):
    login(client, admin)
    client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "New"})
    client.patch("/api/courses/overrides/15-122", json={"course_name": "Renamed", "requirements": {"CS": [CS_CORE]}})
    client.post("/api/courses/overrides/15-122/archive")
    items = client.get("/api/admin/activity?action=course.").get_json()["items"]
    assert [e["action"] for e in items] == ["course.archive", "course.update", "course.add"]
    assert items[1]["details"]["fields"] == ["course_name", "counts for"]
