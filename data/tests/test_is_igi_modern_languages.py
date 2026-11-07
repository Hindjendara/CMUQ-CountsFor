"""Tests for IS GenEd Intercultural and Global Inquiry modern-language mappings."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "data"))

from apply_mapping_overlays import (  # noqa: E402
    EXPECTED_GENED_MAPPINGS,
    IS_CONTEXTUAL_PATH,
    IS_IGI_PATH,
    MODERN_LANGUAGE_CODES,
    apply_overlays_to_courses,
    query_is_igi_courses,
    verify_expected_geneds,
    verify_modern_languages,
)
from soc_parse import normalize_course_code  # noqa: E402


def _load_courses(name: str):
    path = ROOT / name
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data["courses"] if isinstance(data, dict) else data


def test_normalize_course_code_variants():
    assert normalize_course_code("82-101") == "82-101"
    assert normalize_course_code("82101") == "82-101"
    assert normalize_course_code("82101.0") == "82-101"
    assert normalize_course_code(82101.0) == "82-101"


def test_modern_languages_mapped_in_courses_json():
    result = verify_modern_languages(ROOT / "data" / "courses.json")
    assert result["ok"], result
    assert result["igi_total"] >= 60


def test_overlay_is_additive_only():
    courses = [
        {
            "course_code": "82-101",
            "requirements": {
                "CS": [{"requirement": "BS in Computer Science---SCS Electives", "type": False, "major": "CS"}],
                "IS": [],
                "BA": [],
                "BS": [],
            },
        }
    ]
    overlays = [
        {
            "course_codes": ["82-101"],
            "requirements": {
                "IS": [{"requirement": IS_IGI_PATH, "type": True, "major": "IS"}],
            },
        }
    ]
    apply_overlays_to_courses(courses, overlays)
    is_reqs = courses[0]["requirements"]["IS"]
    assert len(is_reqs) == 1
    assert is_reqs[0]["requirement"] == IS_IGI_PATH
    assert len(courses[0]["requirements"]["CS"]) == 1


def test_query_includes_all_six_without_dropping_existing():
    courses = _load_courses("data/courses.json")
    before = set(query_is_igi_courses(courses))
    assert before.issuperset(set(MODERN_LANGUAGE_CODES))
    # Re-apply overlays on copy — count should not drop
    copy = json.loads(json.dumps(courses))
    overlays = json.loads((ROOT / "data" / "mapping_overlays.json").read_text(encoding="utf-8"))["overlays"]
    apply_overlays_to_courses(copy, overlays)
    after = set(query_is_igi_courses(copy))
    assert after.issuperset(before)


def test_spreadsheet_gened_audit_passes():
    result = verify_expected_geneds(ROOT / "data" / "courses.json")
    assert result["ok"], result["missing"]


def test_79_286_has_contextual_thinking():
    courses = _load_courses("data/courses.json")
    course = next(c for c in courses if c["course_code"] == "79-286")
    is_paths = {
        r["requirement"]
        for r in (course.get("requirements") or {}).get("IS") or []
        if r.get("type") is True
    }
    assert IS_CONTEXTUAL_PATH in is_paths


def test_79_232_has_contextual_thinking():
    courses = _load_courses("data/courses.json")
    course = next(c for c in courses if c["course_code"] == "79-232")
    is_paths = {
        r["requirement"]
        for r in (course.get("requirements") or {}).get("IS") or []
        if r.get("type") is True
    }
    assert IS_CONTEXTUAL_PATH in is_paths


def test_expected_mapping_table_covers_user_courses():
    assert "82-314" in EXPECTED_GENED_MAPPINGS
    assert "79-286" in EXPECTED_GENED_MAPPINGS
    assert "79-232" in EXPECTED_GENED_MAPPINGS
    assert "82-411" not in EXPECTED_GENED_MAPPINGS
