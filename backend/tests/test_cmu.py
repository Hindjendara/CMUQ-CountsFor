"""The single backend CMU email check (backend/cmu.py).

frontend/js/utils.js normalizeCmuEmail follows the same rules; frontend/tests/data.test.js
covers the frontend side with the same cases.
"""
import pytest

from backend.cmu import email_in_domain, normalize_cmu_email
from backend.tests.conftest import login


@pytest.mark.parametrize("raw, expected", [
    ("alice@andrew.cmu.edu", "alice@andrew.cmu.edu"),
    ("  Alice@Andrew.CMU.edu  ", "alice@andrew.cmu.edu"),
    ("alice@cmu.edu", "alice@andrew.cmu.edu"),
    ("alice@qatar.cmu.edu", "alice@andrew.cmu.edu"),
    ("alice@gmail.com", None),
    ("alice@notcmu.edu", None),
    ("alice", None),
    ("", None),
    (None, None),
    ("@andrew.cmu.edu", None),
    ("al ice@andrew.cmu.edu", None),
    ("a@b@andrew.cmu.edu", None),
])
def test_normalize_cmu_email(raw, expected):
    assert normalize_cmu_email(raw) == expected


def test_email_in_domain():
    assert email_in_domain("alice@andrew.cmu.edu", "")
    assert email_in_domain("alice@andrew.cmu.edu", None)
    assert email_in_domain("alice@andrew.cmu.edu", "Andrew.CMU.edu")
    assert not email_in_domain("alice@gmail.com", "andrew.cmu.edu")


def test_share_plan_accepts_cmu_alias_for_recipient(client, student, professor):
    login(client, student)
    r = client.post("/api/plans/share", json={
        "recipient_email": "PROF@qatar.cmu.edu",
        "name": "Fall plan",
        "items": [{"course_code": "15-112", "semester_code": "F26", "section": "A"}],
    })
    assert r.status_code in (200, 201), r.get_json()
