"""Course catalog edit tests."""
import json

from backend.db import db
from backend.models import CourseOverride
from backend.tokens import make_auth_token

from .conftest import login

CS_CORE = "BS in Computer Science---Computer Science---Computer Science Core"
GENED = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
AI_SCS = "BS in Artificial Intelligence---School of Computer Science Electives"
IS_CORE = "BS in Information Systems---Information Systems Core"


def _row(path, program):
    return {"requirement": path, "type": path.startswith("GenEd---"), "major": program}


def _items(client):
    return client.get("/api/courses/overrides").get_json()["items"]


def _events(client):
    return client.get("/api/admin/activity?action=course.").get_json()["items"]


def test_writes_require_admin(client, student, professor):
    for user in (student, professor):
        login(client, user)
        assert client.post("/api/courses/overrides", json={"course_code": "15-999", "course_name": "X"}).status_code == 403
        assert client.patch("/api/courses/overrides/15-122", json={"course_name": "X"}).status_code == 403
        assert client.post("/api/courses/overrides/15-122/archive").status_code == 403
        assert client.delete("/api/courses/overrides/15-122").status_code == 403
        assert client.post("/api/courses/overrides/batch", json={"items": []}).status_code == 403


def test_list_is_public(client):
    r = client.get("/api/courses/overrides")
    assert r.status_code == 200
    assert r.get_json() == {"items": []}


def test_list_shows_who_saved_an_edit_to_admins_only(app, client, admin, student, professor):
    login(client, admin)
    assert client.patch("/api/courses/overrides/15-122", json={"units": 10}).status_code == 200
    [item] = _items(client)
    assert item["updated_by_email"] == "admin@andrew.cmu.edu" and item["updated_at"]
    # A guest, a student and a professor get the edit, but not who made it.
    for user in (None, student, professor):
        viewer = app.test_client()
        if user:
            login(viewer, user)
        [item] = _items(viewer)
        assert item["fields"] == {"units": 10} and item["updated_at"], user
        assert "updated_by_email" not in item, user
    # An admin signed in with the bearer token alone (how the pages call the API) sees it.
    with app.app_context():
        token = make_auth_token(admin.id)
    r = app.test_client().get("/api/courses/overrides", headers={"Authorization": f"Bearer {token}"})
    assert r.get_json()["items"][0]["updated_by_email"] == "admin@andrew.cmu.edu"


def test_edit_catalog_course_and_counts_for(client, admin):
    login(client, admin)
    r = client.patch("/api/courses/overrides/15-122", json={
        "course_name": "Imperative Computation",
        "units": "10",
        "requirements": {
            "CS": {"add": [{"requirement": GENED}, {"requirement": GENED}], "remove": [CS_CORE, CS_CORE]},
            "IS": {"add": [IS_CORE], "remove": []},
        },
    })
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["is_new"] is False
    assert body["fields"] == {"course_name": "Imperative Computation", "units": 10}
    assert body["requirements"]["CS"] == {"add": [_row(GENED, "CS")], "remove": [CS_CORE]}  # duplicates dropped
    assert body["requirements"]["IS"] == {"add": [_row(IS_CORE, "IS")], "remove": []}

    # A second edit merges with the first instead of replacing it.
    client.patch("/api/courses/overrides/15-122", json={"description": "New text"})
    items = _items(client)
    assert items[0]["fields"] == {"course_name": "Imperative Computation", "units": 10, "description": "New text"}
    assert set(items[0]["requirements"]) == {"CS", "IS"}


def test_list_value_is_refused_as_stale_page(client, admin):
    """A tab opened before the change still sends whole lists; it must not freeze every program again."""
    login(client, admin)
    r = client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": [_row(CS_CORE, "CS")]}})
    assert r.status_code == 400
    assert r.get_json()["error"] == "stale_page"
    assert r.get_json()["message"] == "This page is out of date. Reload it and try again."
    r = client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "New",
                                                    "requirements": {"IS": [_row(GENED, "IS")]}})
    assert r.status_code == 400 and r.get_json()["error"] == "stale_page"
    assert _items(client) == []


def test_delta_edits_one_program_only(client, admin):
    login(client, admin)
    r = client.patch("/api/courses/overrides/15-122", json={"requirements": {
        "CS": {"add": [{"requirement": GENED, "type": False, "major": "IS", "earlier": True,
                        "earlier_reason": "older degree version"}], "remove": []},
    }})
    assert r.status_code == 200, r.get_json()
    stored = _items(client)[0]["requirements"]
    assert list(stored) == ["CS"]
    # The Gen Ed flag comes from the root, the program from the key; old earlier flags are dropped.
    assert stored["CS"] == {"add": [{"requirement": GENED, "type": True, "major": "CS"}], "remove": []}


def test_per_key_merge_and_reset(client, admin):
    login(client, admin)
    client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": {"remove": [CS_CORE]}}})
    client.patch("/api/courses/overrides/15-122", json={"requirements": {"AI": {"add": [AI_SCS]}}})
    stored = _items(client)[0]["requirements"]
    assert set(stored) == {"CS", "AI"}
    assert stored["CS"] == {"add": [], "remove": [CS_CORE]}

    client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": None}})
    assert set(_items(client)[0]["requirements"]) == {"AI"}

    r = client.patch("/api/courses/overrides/15-122", json={"requirements": {"AI": None}})
    assert r.status_code == 200
    assert r.get_json()["requirements"] is None
    assert _items(client) == []  # nothing left that differs from the catalog
    last = _events(client)[0]
    assert last["action"] == "course.revert"
    assert last["details"]["reason"] == "matches the catalog"
    assert last["details"]["before"]["requirements"] == {"AI": {"add": [_row(AI_SCS, "AI")], "remove": []}}


def test_empty_change_resets_the_key(client, admin):
    login(client, admin)
    client.patch("/api/courses/overrides/15-122", json={"course_name": "X", "requirements": {"CS": {"remove": [CS_CORE]}}})
    client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": {"add": [], "remove": []}}})
    assert _items(client)[0]["requirements"] is None
    assert _items(client)[0]["fields"] == {"course_name": "X"}


def test_path_validation(client, admin):
    login(client, admin)
    bad = [
        {"CS": {"add": ["BS in Information Systems---Information Systems Core"]}},  # another major's root
        {"CS": {"add": ["BS in Computer Science---Computer Science – Core"]}},  # dash punctuation
        {"CS": {"add": ["GenEd"]}},  # one segment
        {"CS": {"add": ["GenEd---"]}},  # empty segment
        {"CS": {"add": ["GenEd---" + "x" * 400]}},  # too long
        {"CS": {"add": [GENED], "remove": [GENED]}},  # both added and removed
        {"CS": {"add": [GENED], "keep": []}},  # unknown part
        {"CS": "GenEd---Foundations"},  # not an object
        {"XX": {"add": [GENED]}},  # unknown program
        {"AI": {"add": [{"type": True}]}},  # no path
    ]
    for reqs in bad:
        r = client.patch("/api/courses/overrides/15-122", json={"requirements": reqs})
        assert r.status_code == 400, reqs
        assert r.get_json()["error"] == "invalid_requirements", reqs
    # Paths are trimmed part by part.
    r = client.patch("/api/courses/overrides/15-122", json={"requirements": {"CS": {"add": ["GenEd --- Humanities and Arts---C. Humanities and Arts Electives "]}}})
    assert r.get_json()["requirements"]["CS"]["add"][0]["requirement"] == GENED
    client.delete("/api/courses/overrides/15-122")
    events_before = len(_events(client))
    # Nothing to change: no row and no event.
    for body in ({}, {"requirements": {}}, {"requirements": {"CS": None}}):
        r = client.patch("/api/courses/overrides/15-122", json=body)
        assert r.status_code == 200
    assert _items(client) == []
    assert len(_events(client)) == events_before


def test_same_edit_twice_logs_once(client, admin):
    login(client, admin)
    edit = {"units": 10, "requirements": {"CS": {"remove": [CS_CORE]}}}
    client.patch("/api/courses/overrides/15-122", json=edit)
    stamp = _items(client)[0]["updated_at"]
    client.patch("/api/courses/overrides/15-122", json=edit)
    assert [e["action"] for e in _events(client)] == ["course.update"]
    assert _items(client)[0]["updated_at"] == stamp


def test_minor_edits(client, admin, app, tmp_path):
    login(client, admin)
    r = client.patch("/api/courses/overrides/85-110", json={"requirements": {
        "MINOR:psychology": {"add": ["survey", "survey"], "remove": ["advanced"]},
    }})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["requirements"] == {"MINOR:psychology": {"add": ["survey"], "remove": ["advanced"]}}
    # A leaf under a group is a path of category ids.
    r = client.patch("/api/courses/overrides/36-200", json={"requirements": {"MINOR:psychology": {"add": ["statistics---intro_stats"]}}})
    assert r.status_code == 200, r.get_json()

    for reqs in (
        {"MINOR:klingon": {"add": ["survey"]}},  # unknown minor
        {"MINOR:psychology": {"add": ["statistics"]}},  # a group, not a category that lists courses
        {"MINOR:psychology": {"add": ["no_such_category"]}},
        {"MINOR:psychology": {"add": ["survey"], "remove": ["survey"]}},
        {"MINOR:psychology": ["survey"]},
        {"MINOR:Bad Code": {"add": ["survey"]}},
    ):
        r = client.patch("/api/courses/overrides/85-110", json={"requirements": reqs})
        assert r.status_code == 400, reqs

    # Without the minor file: the fallback list of minors and the shape of a path.
    app.config["MINORS_JSON_PATH"] = str(tmp_path / "missing.json")
    r = client.patch("/api/courses/overrides/85-130", json={"requirements": {"MINOR:psychology": {"add": ["any_shape---ok"]}}})
    assert r.status_code == 200, r.get_json()
    assert client.patch("/api/courses/overrides/85-130", json={"requirements": {"MINOR:klingon": {"add": ["x"]}}}).status_code == 400
    assert client.patch("/api/courses/overrides/85-130", json={"requirements": {"MINOR:psychology": {"add": ["Not A Path"]}}}).status_code == 400


def test_a_minor_added_to_the_file_is_accepted(client, admin, app, tmp_path):
    minors = tmp_path / "minors.json"
    minors.write_text(json.dumps({"minors": {"product": {"name": "Product Management", "categories": [
        {"id": "core", "name": "Core", "courses": ["67-250"], "children": []},
        {"id": "electives", "name": "Electives", "children": [{"id": "design", "name": "Design", "children": []}]},
    ]}}}), encoding="utf-8")
    app.config["MINORS_JSON_PATH"] = str(minors)
    login(client, admin)
    r = client.patch("/api/courses/overrides/67-272", json={"requirements": {"MINOR:product": {"add": ["electives---design"]}}})
    assert r.status_code == 200, r.get_json()
    assert client.patch("/api/courses/overrides/67-272", json={"requirements": {"MINOR:psychology": {"add": ["survey"]}}}).status_code == 400


def test_legacy_row_is_read_and_merged_per_key(client, admin, app):
    """A row saved in the old shape (whole lists, earlier flags) still reads, and a new change keeps its other keys."""
    legacy = {p: [{"requirement": f"{'BS in Computer Science' if p == 'CS' else GENED.split('---')[0]}---Old Name",
                   "type": p != "CS", "major": p, "earlier": True, "earlier_reason": "older degree version"}]
              for p in ("CS", "IS", "BA", "BS")}
    with app.app_context():
        db.session.add(CourseOverride(course_code="02-261", is_new=False, requirements=json.dumps(legacy)))
        db.session.commit()
    assert _items(client)[0]["requirements"] == legacy
    login(client, admin)
    r = client.patch("/api/courses/overrides/02-261", json={"requirements": {"CS": {"add": [CS_CORE]}}})
    assert r.status_code == 200, r.get_json()
    stored = r.get_json()["requirements"]
    assert stored["CS"] == {"add": [_row(CS_CORE, "CS")], "remove": []}
    assert stored["IS"] == legacy["IS"]  # untouched until the editor saves that program


def test_renumber_catalog_course(client, admin):
    login(client, admin)
    # Same number written without the dash is not a change, and stores nothing.
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15122"})
    assert r.get_json()["fields"] == {}
    assert _items(client) == []
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15-123"})
    assert r.get_json()["fields"]["course_code"] == "15-123"
    # Renumbering back to the original removes the change, and the now-empty row.
    r = client.patch("/api/courses/overrides/15-122", json={"new_code": "15-122"})
    assert "course_code" not in r.get_json()["fields"]
    assert _items(client) == []


def test_add_course_and_renumber_it(client, admin):
    login(client, admin)
    r = client.post("/api/courses/overrides", json={
        "course_code": "76-999", "course_name": "Special Topics in Writing", "department": "076",
        "units": 9, "offered_qatar": True, "offered": ["F26", "F26"], "requirements": {"IS": {"add": [GENED]}},
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
    assert _items(client)[0]["course_code"] == "76-998"


def test_add_course_with_deltas(client, admin):
    login(client, admin)
    r = client.post("/api/courses/overrides", json={
        "course_code": "76-997", "course_name": "New Writing Course",
        "requirements": {"IS": {"add": [GENED], "remove": []}, "CS": None, "MINOR:writing": {"add": ["english_elective"]}},
    })
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["requirements"] == {"IS": {"add": [_row(GENED, "IS")], "remove": []},
                                            "MINOR:writing": {"add": ["english_elective"], "remove": []}}
    event = _events(client)[0]
    assert event["action"] == "course.add"
    assert set(event["details"]["requirements"]) == {"IS", "MINOR:writing"}
    r = client.post("/api/courses/overrides", json={"course_code": "76-996", "course_name": "Plain"})
    assert r.get_json()["requirements"] is None


def test_validation_errors(client, admin):
    login(client, admin)
    assert client.post("/api/courses/overrides", json={"course_code": "abc", "course_name": "X"}).status_code == 400
    assert client.post("/api/courses/overrides", json={"course_code": "15-998"}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"units": "lots"}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"course_name": ""}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"requirements": {"XX": []}}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"requirements": ["CS"]}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"offered": ["Fall"]}).status_code == 400
    assert client.patch("/api/courses/overrides/15-122", json={"secret": 1}).status_code == 400
    assert _items(client) == []


def test_archive_restore_and_revert(client, admin):
    login(client, admin)
    r = client.post("/api/courses/overrides/15-122/archive")
    assert r.status_code == 200 and r.get_json()["archived"] is True
    r = client.post("/api/courses/overrides/15-122/restore")
    assert r.get_json()["archived"] is False
    # Restored with no other edits, so nothing is stored any more.
    assert _items(client) == []
    assert client.delete("/api/courses/overrides/15-122").status_code == 404

    client.patch("/api/courses/overrides/15-122", json={"course_name": "Renamed"})
    client.post("/api/courses/overrides/15-122/archive")
    client.post("/api/courses/overrides/15-122/restore")
    assert _items(client)[0]["fields"] == {"course_name": "Renamed"}
    assert client.delete("/api/courses/overrides/15-122").status_code == 200
    assert _items(client) == []

    client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "New"})
    assert client.delete("/api/courses/overrides/76-999").status_code == 400


def test_course_changes_are_logged(client, admin):
    login(client, admin)
    client.post("/api/courses/overrides", json={"course_code": "76-999", "course_name": "New"})
    client.patch("/api/courses/overrides/15-122", json={"course_name": "Renamed", "requirements": {"CS": {"remove": [CS_CORE]}}})
    client.post("/api/courses/overrides/15-122/archive")
    items = _events(client)
    assert [e["action"] for e in items] == ["course.archive", "course.update", "course.add"]
    assert items[1]["details"]["fields"] == ["course_name", "counts for"]


def test_audit_details(client, admin):
    login(client, admin)
    client.patch("/api/courses/overrides/85-110", json={"units": 6, "description": "y" * 400})
    client.patch("/api/courses/overrides/85-110", json={
        "units": 9, "requirements": {"CS": {"add": [GENED]}, "MINOR:psychology": {"remove": ["survey"]}},
    })
    second, first = _events(client)[:2]
    assert first["details"]["changes"]["units"] == {"from": None, "to": 6}  # null: the Schedule of Classes value
    assert len(first["details"]["changes"]["description"]["to"]) == 300
    assert first["details"]["fields"] == ["description", "units"]
    assert "requirements" not in first["details"]
    d = second["details"]
    assert d["fields"] == ["units", "counts for", "minors"]
    assert d["changes"] == {"units": {"from": 6, "to": 9}}
    assert d["requirements"] == {"CS": {"add": [_row(GENED, "CS")], "remove": []},
                                 "MINOR:psychology": {"add": [], "remove": ["survey"]}}

    client.patch("/api/courses/overrides/85-110", json={"requirements": {"CS": None}})
    assert _events(client)[0]["details"]["requirements"] == {"CS": None}

    assert client.delete("/api/courses/overrides/85-110").status_code == 200
    revert = _events(client)[0]
    assert revert["action"] == "course.revert"
    assert revert["details"]["before"]["fields"] == {"units": 9, "description": "y" * 400}
    assert revert["details"]["before"]["requirements"] == {"MINOR:psychology": {"add": [], "remove": ["survey"]}}
    assert revert["details"]["before"]["archived"] is False


def test_batch_edits_in_one_transaction(client, admin):
    login(client, admin)
    client.patch("/api/courses/overrides/15-122", json={"units": 10})
    r = client.post("/api/courses/overrides/batch", json={"items": [
        {"course_code": "15-122", "requirements": {"AI": {"add": [AI_SCS]}}},
        {"course_code": "15151", "requirements": {"AI": {"add": [AI_SCS]}}},
    ]})
    assert r.status_code == 200, r.get_json()
    assert [i["course_code"] for i in r.get_json()["items"]] == ["15-122", "15-151"]
    items = {i["course_code"]: i for i in _items(client)}
    assert items["15-122"]["fields"] == {"units": 10}  # the other edit stays
    assert items["15-151"]["requirements"] == {"AI": {"add": [_row(AI_SCS, "AI")], "remove": []}}
    events = _events(client)
    assert [(e["action"], e["target"]) for e in events[:2]] == [("course.update", "15-151"), ("course.update", "15-122")]

    # One bad item saves nothing.
    r = client.post("/api/courses/overrides/batch", json={"items": [
        {"course_code": "21-127", "requirements": {"CS": {"add": [GENED]}}},
        {"course_code": "21-128", "requirements": {"CS": {"add": ["Nowhere---x"]}}},
    ]})
    assert r.status_code == 400 and r.get_json()["index"] == 1
    assert "21-127" not in {i["course_code"] for i in _items(client)}
    for body in ({"items": []}, {"items": [{"course_code": "21-127"}]},
                 {"items": [{"course_code": "21-127", "requirements": {}, "units": 9}]},
                 {"items": [{"course_code": "21-127", "requirements": {}}, {"course_code": "21127", "requirements": {}}]}):
        assert client.post("/api/courses/overrides/batch", json=body).status_code == 400, body
