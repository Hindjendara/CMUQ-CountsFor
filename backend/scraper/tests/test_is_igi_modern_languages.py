"""Tests for IS GenEd Intercultural and Global Inquiry modern-language mappings."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

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
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON  # noqa: E402
from soc_parse import normalize_course_code  # noqa: E402


def _load_courses(path: Path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data["courses"] if isinstance(data, dict) else data


def test_normalize_course_code_variants():
    assert normalize_course_code("82-101") == "82-101"
    assert normalize_course_code("82101") == "82-101"
    assert normalize_course_code("82101.0") == "82-101"
    assert normalize_course_code(82101.0) == "82-101"


def test_modern_languages_mapped_in_courses_json():
    result = verify_modern_languages(COURSES_JSON)
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
    courses = _load_courses(COURSES_JSON)
    before = set(query_is_igi_courses(courses))
    assert before.issuperset(set(MODERN_LANGUAGE_CODES))
    # Re-apply overlays on copy — count should not drop
    copy = json.loads(json.dumps(courses))
    overlays = json.loads(MAPPING_OVERLAYS_JSON.read_text(encoding="utf-8"))["overlays"]
    apply_overlays_to_courses(copy, overlays)
    after = set(query_is_igi_courses(copy))
    assert after.issuperset(before)


def test_spreadsheet_gened_audit_passes():
    result = verify_expected_geneds(COURSES_JSON)
    assert result["ok"], result["missing"]


def test_79_286_has_contextual_thinking():
    courses = _load_courses(COURSES_JSON)
    course = next(c for c in courses if c["course_code"] == "79-286")
    is_paths = {
        r["requirement"]
        for r in (course.get("requirements") or {}).get("IS") or []
        if r.get("type") is True
    }
    assert IS_CONTEXTUAL_PATH in is_paths


def test_79_232_has_contextual_thinking():
    courses = _load_courses(COURSES_JSON)
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


# ── is-igi-hss-sheet: the H&SS Course Offerings sheet list (2026-11-07) ──

HSS_IGI_CODES = [
    "76-324", "76-357", "76-386", "79-284", "79-293", "79-391",
    "82-101", "82-102", "82-111", "82-112", "82-141", "82-142",
    "82-201", "82-241", "82-242", "82-283", "82-313",
]


def _overlay(overlay_id):
    doc = json.loads(MAPPING_OVERLAYS_JSON.read_text(encoding="utf-8"))
    hits = [o for o in doc["overlays"] if o["id"] == overlay_id]
    assert len(hits) == 1, overlay_id
    return doc, hits[0]


def test_is_igi_hss_sheet_entry_lists_the_17_courses():
    doc, entry = _overlay("is-igi-hss-sheet")
    assert not [o for o in doc["overlays"] if o["id"] == "is-igi-modern-languages-core"]
    assert entry["course_codes"] == HSS_IGI_CODES
    assert entry["requirements"] == {"IS": [{"requirement": IS_IGI_PATH, "type": True, "major": "IS"}]}
    # Defaults (offered_qatar) only for the codes the old modern languages entry had.
    assert sorted(entry["ensure_course_defaults_codes"]) == sorted(MODERN_LANGUAGE_CODES)
    for code in ("76-386", "79-391", "82-201"):
        assert code not in entry["ensure_course_defaults_codes"]


def test_is_igi_hss_sheet_already_mapped_and_keeps_other_courses():
    courses = _load_courses(COURSES_JSON)
    before = set(query_is_igi_courses(courses))
    assert before.issuperset(HSS_IGI_CODES), "all 17 are mapped in the catalog already"
    copy = json.loads(json.dumps(courses))
    _, entry = _overlay("is-igi-hss-sheet")
    stats = apply_overlays_to_courses(copy, [entry])
    assert stats["requirements_added"] == 0
    assert stats["courses_created"] == 0
    assert set(query_is_igi_courses(copy)) == before, "the other mapped courses stay"


def test_is_igi_hss_sheet_does_not_set_offered_qatar_outside_defaults():
    courses = [
        {"course_code": code, "offered_qatar": False, "requirements": {"CS": [], "IS": [], "BA": [], "BS": []}}
        for code in HSS_IGI_CODES
    ]
    _, entry = _overlay("is-igi-hss-sheet")
    apply_overlays_to_courses(courses, [entry])
    flagged = sorted(c["course_code"] for c in courses if c["offered_qatar"])
    assert flagged == sorted(MODERN_LANGUAGE_CODES)
