"""Flag route tests — role gating, schema, faculty review."""
from .conftest import login


VALID_FLAG = {
    "course_code": "15-122",
    "course_name": "Principles of Imperative Computation",
    "reason_code": "metadata_outdated",
    "reason_label": "Course title, number, or units are outdated",
    "notes": "Units changed in Spring 2025.",
}


# ── Authorization ───────────────────────────────────────────

def test_student_cannot_flag(client, student):
    login(client, student)
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 403


def test_unauthenticated_cannot_flag(client):
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 401


def test_professor_can_flag(client, professor):
    login(client, professor)
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["course_code"] == "15-122"
    assert body["submitted_by_role"] == "professor"
    assert body["submitted_program"] == "IS"
    assert body["status"] == "pending"


def test_area_head_can_flag(client, area_head):
    login(client, area_head)
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 201


def test_advisor_can_flag(client, advisor):
    login(client, advisor)
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 201


def test_admin_can_flag(client, admin):
    login(client, admin)
    r = client.post("/api/flags", json=VALID_FLAG)
    assert r.status_code == 201


# ── Schema validation ───────────────────────────────────────

def test_missing_required_field_400(client, professor):
    login(client, professor)
    payload = dict(VALID_FLAG)
    del payload["reason_code"]
    r = client.post("/api/flags", json=payload)
    assert r.status_code == 400
    assert r.get_json()["error"] == "missing_fields"


def test_invalid_reason_code_400(client, professor):
    login(client, professor)
    payload = dict(VALID_FLAG, reason_code="not_a_real_reason")
    r = client.post("/api/flags", json=payload)
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_reason"


# ── Idempotency ─────────────────────────────────────────────

def test_re_post_with_same_id_is_idempotent(client, professor):
    login(client, professor)
    payload = dict(VALID_FLAG, id="flg-imported-from-localstorage")
    r1 = client.post("/api/flags", json=payload)
    assert r1.status_code == 201
    r2 = client.post("/api/flags", json=payload)
    assert r2.status_code == 200
    assert r1.get_json()["id"] == r2.get_json()["id"]


# ── Faculty shared queue ─────────────────────────────────────

def test_faculty_sees_all_flags(client, professor, advisor):
    login(client, professor)
    client.post("/api/flags", json=dict(VALID_FLAG, id="flg-prof-1"))
    login(client, advisor)
    client.post("/api/flags", json=dict(VALID_FLAG, id="flg-adv-1"))

    login(client, professor)
    r = client.get("/api/flags")
    assert r.status_code == 200
    assert r.get_json()["total"] == 2


def test_faculty_mine_filter(client, professor, advisor):
    login(client, professor)
    client.post("/api/flags", json=dict(VALID_FLAG, id="flg-prof-1"))
    login(client, advisor)
    client.post("/api/flags", json=dict(VALID_FLAG, id="flg-adv-1"))

    login(client, professor)
    r = client.get("/api/flags?mine=1")
    assert r.status_code == 200
    body = r.get_json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == "flg-prof-1"


def test_student_can_list_public_flags(client, student, professor):
    login(client, professor)
    client.post("/api/flags", json=dict(VALID_FLAG, id="flg-pub-1"))
    login(client, student)
    r = client.get("/api/flags")
    assert r.status_code == 200
    body = r.get_json()
    assert body["total"] >= 1
    assert body["items"][0]["course_code"] == "15-122"
    assert "submitted_by_email" not in body["items"][0]


def test_faculty_can_resolve_flags(client, professor, advisor):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, advisor)
    r = client.patch(f"/api/flags/{flag_id}", json={"status": "resolved", "admin_notes": "Fixed."})
    assert r.status_code == 200
    assert r.get_json()["status"] == "resolved"
    assert r.get_json()["resolved_by"] == advisor.id


def test_admin_can_list_flags(client, professor, admin):
    login(client, professor)
    client.post("/api/flags", json=VALID_FLAG)
    login(client, admin)
    r = client.get("/api/flags")
    assert r.status_code == 200
    assert r.get_json()["total"] == 1


def test_admin_patch_404_for_unknown_flag(client, admin):
    login(client, admin)
    r = client.patch("/api/flags/flg-nope", json={"status": "resolved"})
    assert r.status_code == 404


def test_admin_patch_rejects_invalid_status(client, professor, admin):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, admin)
    r = client.patch(f"/api/flags/{flag_id}", json={"status": "weird"})
    assert r.status_code == 400


# ── Admin notes: private unless an admin shows them to students ──

def _student_note(client, student, flag_id):
    login(client, student)
    [item] = [f for f in client.get("/api/flags").get_json()["items"] if f["id"] == flag_id]
    return item["admin_notes"]


def test_admin_notes_are_private_by_default(client, student, professor, admin):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, admin)
    r = client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "Checked with the department."})
    assert r.status_code == 200 and r.get_json()["admin_notes_public"] is False
    assert _student_note(client, student, flag_id) is None


def test_admin_can_show_a_note_to_students(client, student, professor, admin):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, admin)
    r = client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "Units fixed for Fall 2026.", "admin_notes_public": True})
    assert r.status_code == 200 and r.get_json()["admin_notes_public"] is True
    assert _student_note(client, student, flag_id) == "Units fixed for Fall 2026."
    login(client, admin)
    assert client.patch(f"/api/flags/{flag_id}", json={"admin_notes_public": False}).get_json()["admin_notes_public"] is False
    assert _student_note(client, student, flag_id) is None


def test_faculty_cannot_show_a_note_to_students(client, professor):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    r = client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "x", "admin_notes_public": True})
    assert r.status_code == 403 and r.get_json()["error"] == "admin_only"


def test_a_note_changed_by_faculty_goes_back_to_private(client, student, professor, admin):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, admin)
    client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "Approved text.", "admin_notes_public": True})
    login(client, professor)
    r = client.patch(f"/api/flags/{flag_id}", json={"admin_notes": "Changed by faculty."})
    assert r.status_code == 200 and r.get_json()["admin_notes_public"] is False
    assert _student_note(client, student, flag_id) is None


def test_an_empty_note_cannot_be_public(client, professor, admin):
    login(client, professor)
    flag_id = client.post("/api/flags", json=VALID_FLAG).get_json()["id"]
    login(client, admin)
    r = client.patch(f"/api/flags/{flag_id}", json={"admin_notes_public": True})
    assert r.get_json()["admin_notes_public"] is False
