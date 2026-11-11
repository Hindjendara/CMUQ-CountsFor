"""Reconcile must not attach SOC sections when titles disagree (reused numbers)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

from reconcile_offerings import reconcile_file, resolve_catalog_soc_offerings  # noqa: E402


def test_resolve_mismatch_adopts_soc_title():
    course = {
        "course_code": "76-322",
        "course_name": "Gender and Sexuality in Performance",
        "units": 4,
        "soc_title": "Arranged Marriage",
    }
    offerings = [
        {
            "semester_code": "F26",
            "campus": "Qatar",
            "section": "W1",
        }
    ]
    meta = {"title": "Arranged Marriage", "units": "3"}

    resolved = resolve_catalog_soc_offerings(course, offerings, meta)

    assert resolved == offerings
    assert course["course_name"] == "Arranged Marriage"
    assert course["previous_course_name"] == "Gender and Sexuality in Performance"
    assert course["units"] == 3
    assert "soc_title" not in course


def test_reconcile_76_322_from_soc(tmp_path):
    soc = {
        "semesters": {
            "F26": {
                "courses": [
                    {
                        "course_number": "76322",
                        "title": "Arranged Marriage",
                        "units": "3",
                        "sections": [
                            {
                                "section": "W1",
                                "days": "UMT",
                                "begin_time": "06:00PM",
                                "end_time": "07:30PM",
                                "location": "Doha, Qatar",
                                "delivery_mode": "In-person + remote",
                                "campus": "Qatar",
                            }
                        ],
                    }
                ]
            }
        }
    }
    courses = [
        {
            "course_code": "76-322",
            "course_name": "Gender and Sexuality in Performance",
            "units": 4,
            "offered": ["S18"],
            "offered_qatar": True,
            "offered_pitts": False,
            "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
            "offerings": [],
        }
    ]
    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps(courses), encoding="utf-8")

    reconcile_file(str(courses_path), str(soc_path))
    updated = json.loads(courses_path.read_text(encoding="utf-8"))[0]

    assert updated["course_name"] == "Arranged Marriage"
    assert updated["previous_course_name"] == "Gender and Sexuality in Performance"
    assert len(updated["offerings"]) == 1
    assert updated["offerings"][0]["semester_code"] == "F26"
