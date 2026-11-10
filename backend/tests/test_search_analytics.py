"""Tests for course search popularity analytics."""
from backend.db import db
from backend.models import CourseSearchCount
from backend.tests.conftest import login
from backend.tests.test_semesters import write_soc


def stored_semesters(app) -> dict[str, int]:
    """{semester_code: search_count} over every counted lookup."""
    with app.app_context():
        rows = db.session.query(CourseSearchCount.semester_code, CourseSearchCount.search_count).all()
    return {sem: n for sem, n in rows}


def test_record_requires_student(client, professor):
    login(client, professor)
    r = client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "F26"})
    assert r.status_code == 403


def test_record_and_popular(client, student):
    login(client, student)
    r1 = client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "F26"})
    assert r1.status_code == 201
    assert r1.get_json()["course_code"] == "15-122"
    assert r1.get_json()["search_count"] == 1

    r2 = client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "F26"})
    assert r2.status_code == 201
    assert r2.get_json()["search_count"] == 2

    client.post("/api/search-analytics/events", json={"course_code": "21-120", "semester_code": "F26"})

    pop = client.get("/api/search-analytics/popular?program=CS&semester=F26&limit=5")
    assert pop.status_code == 200
    data = pop.get_json()
    assert data["program"] == "CS"
    assert data["items"][0]["course_code"] == "15-122"
    assert data["items"][0]["search_count"] == 2


def test_popular_scoped_by_program(client, app):
    from backend.tests.conftest import _make_user, login

    cs = _make_user(app, "cs@andrew.cmu.edu", role="student", primary_program="CS")
    is_user = _make_user(app, "is@andrew.cmu.edu", role="student", primary_program="IS")

    login(client, cs)
    client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "F26"})

    login(client, is_user)
    client.post("/api/search-analytics/events", json={"course_code": "67-250", "semester_code": "F26"})

    cs_pop = client.get("/api/search-analytics/popular?program=CS&semester=F26")
    assert cs_pop.get_json()["items"][0]["course_code"] == "15-122"

    is_pop = client.get("/api/search-analytics/popular?program=IS&semester=F26")
    assert is_pop.get_json()["items"][0]["course_code"] == "67-250"


def test_any_semester_code_is_accepted(client, app, student, tmp_path):
    app.config["SOC_JSON_PATH"] = str(tmp_path / "missing.json")  # no default needed
    login(client, student)
    for sent in ("S27", "m26", "F31"):
        r = client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": sent})
        assert r.status_code == 201, sent
    assert stored_semesters(app) == {"S27": 1, "M26": 1, "F31": 1}
    pop = client.get("/api/search-analytics/popular?program=CS&semester=S27").get_json()
    assert pop["semester"] == "S27"
    assert pop["items"][0]["course_code"] == "15-122"


def test_default_semester_comes_from_soc_json(client, app, student, tmp_path):
    """Without a semester code the newest fall or spring with Qatar sections in
    soc.json is used: S27 here, then F27 once the scrape has Qatar sections for it."""
    soc = write_soc(tmp_path / "soc.json", {"F26": ["Qatar"], "M27": ["Qatar"], "S27": ["Pittsburgh", "Qatar"]},
                    mtime=1_000_000_000)
    app.config["SOC_JSON_PATH"] = str(soc)
    login(client, student)
    sent_codes = (None, "", "all", "Spring 2027", "F2026", 27)
    for sent in sent_codes:
        body = {"course_code": "15-122"} if sent is None else {"course_code": "15-122", "semester_code": sent}
        r = client.post("/api/search-analytics/events", json=body)
        assert r.status_code == 201, sent
    assert stored_semesters(app) == {"S27": len(sent_codes)}
    assert client.get("/api/search-analytics/popular?program=CS").get_json()["semester"] == "S27"
    assert client.get("/api/search-analytics/popular?program=CS&semester=all").get_json()["semester"] == "S27"

    write_soc(soc, {"F26": ["Qatar"], "S27": ["Qatar"], "F27": ["Pittsburgh"]}, mtime=2_000_000_000)
    assert client.get("/api/search-analytics/popular?program=CS").get_json()["semester"] == "S27"
    write_soc(soc, {"F26": ["Qatar"], "S27": ["Qatar"], "F27": ["Pittsburgh", "Qatar"]}, mtime=3_000_000_000)
    assert client.get("/api/search-analytics/popular?program=CS").get_json()["semester"] == "F27"


def test_no_semester_and_no_soc_json_is_an_error(client, app, student, tmp_path):
    app.config["SOC_JSON_PATH"] = str(tmp_path / "missing.json")
    login(client, student)
    r = client.post("/api/search-analytics/events", json={"course_code": "15-122", "semester_code": "all"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_semester"
    assert client.get("/api/search-analytics/popular?program=CS").status_code == 400
    assert client.get("/api/search-analytics/popular?program=CS&semester=S27").status_code == 200
