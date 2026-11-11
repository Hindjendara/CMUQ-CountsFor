"""The semester list of the app is the SOC's: the scrape records the semesters
the SOC search form lists (soc.json metadata.semesters_on_form), reconcile
writes them to courses.json ("soc_semesters", the semester picker) and the
coverage check fails when the two differ. A semester that left the form keeps
its sections in soc.json and in the offerings, as history, but is not listed.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

import scrape_soc  # noqa: E402
import soc_departments  # noqa: E402
import validate_soc_coverage as vsc  # noqa: E402
from reconcile_offerings import reconcile_file  # noqa: E402
from soc_parse import soc_form_semesters  # noqa: E402

FORM = """<form><select name="SEMESTER">
  <option value="S27">Spring 2027</option><option value="F26" selected>Fall 2026</option>
  <option value="M26">Summer 2026</option><option value="S26">Spring 2026</option>
  <option value="F25">Fall 2025</option></select>
<select name="DEPT"><option value="PSY">Psychology (85XXX)</option></select></form>"""
ON_FORM = [("S27", "Spring 2027"), ("F26", "Fall 2026"), ("M26", "Summer 2026"),
           ("S26", "Spring 2026"), ("F25", "Fall 2025")]


def form_metadata(*codes):
    return {"last_scrape": "2026-11-11T12:00:00+00:00",
            "semesters_on_form": [{"code": c, "label": c} for c in codes]}


def soc_course(num, title, sections):
    return {"course_number": num, "title": title, "units": "9", "department": "Psychology", "sections": sections}


def section(sec, campus="Qatar"):
    loc = "Doha, Qatar" if campus == "Qatar" else "Pittsburgh, Pennsylvania"
    return {"section": sec, "days": "UT", "begin_time": "10:00AM", "end_time": "11:15AM",
            "location": loc, "delivery_mode": "In Person", "campus": campus}


# ── soc.json: the form's list ────────────────────────────────

def test_soc_form_semesters_are_the_form_list_newest_first():
    soc = {"metadata": {"semesters_on_form": [
        {"code": "F25", "label": "Fall 2025"}, {"code": "s27", "label": "Spring 2027"}, "M26",
        {"code": "S27"}, {"code": "Q27"}, {"label": "no code"}, 7, {"code": "F26"},
    ]}}
    assert soc_form_semesters(soc) == ["S27", "F26", "M26", "F25"]


@pytest.mark.parametrize("soc", [
    {}, {"metadata": {}}, {"metadata": {"semesters_on_form": []}},
    {"metadata": {"semesters_on_form": "S27"}}, {"metadata": {"semesters_on_form": [{"code": "2027"}]}}, None,
])
def test_soc_form_semesters_is_none_without_a_list(soc):
    assert soc_form_semesters(soc) is None


# ── The scrape: the form decides, no list in code ────────────

def test_the_semester_list_comes_from_the_form_and_no_list_is_kept_in_code(monkeypatch):
    monkeypatch.delenv("SEMESTERS_TO_TRY", raising=False)
    assert soc_departments.get_semester_list(None, "", form_html=FORM) == ON_FORM
    assert soc_departments.get_semester_list(None, "", form_html="<form>no dropdown</form>") == []

    def offline(url):
        raise OSError("offline")
    assert soc_departments.get_semester_list(offline, "https://soc.example/search") == []
    assert not hasattr(soc_departments, "SOC_SEMESTER_CODES")
    assert not hasattr(soc_departments, "fallback_semester_list")


def test_semesters_to_try_picks_what_to_scrape_not_what_the_form_lists(monkeypatch):
    monkeypatch.delenv("SEMESTERS_TO_TRY", raising=False)
    assert soc_departments.semesters_to_scrape(ON_FORM) == ON_FORM
    monkeypatch.setenv("SEMESTERS_TO_TRY", " s27, F27 ")
    assert soc_departments.semesters_to_scrape(ON_FORM) == [("S27", "Spring 2027"), ("F27", "F27")]


def run_scrape(monkeypatch, tmp_path, form_semesters, prior=None, scraped=None):
    """scrape_soc.main() with the network stubbed; returns the written soc.json (or None)."""
    out = tmp_path / "soc.json"
    if prior is not None:
        out.write_text(json.dumps(prior), encoding="utf-8")
    monkeypatch.setattr(scrape_soc, "OUTPUT_PATH", str(out))
    monkeypatch.setattr(scrape_soc, "load_soc_form", lambda fetch, url: ("<form>", form_semesters, [("PSY", "Psychology")]))
    calls = []

    def fake_semester(code, depts):
        calls.append(code)
        courses = (scraped or {}).get(code)
        return (courses, [{"code": "PSY"}]) if courses else (None, None)
    monkeypatch.setattr(scrape_soc, "scrape_semester", fake_semester)
    scrape_soc.main()
    return (json.loads(out.read_text(encoding="utf-8")) if out.exists() else None), calls


def test_the_scrape_records_the_form_list_and_keeps_older_semesters_as_history(monkeypatch, tmp_path):
    monkeypatch.delenv("SEMESTERS_TO_TRY", raising=False)
    course = soc_course("85211", "Cognitive Psychology", [section("W")])
    prior = {"metadata": form_metadata("F26", "M26", "S26", "F25", "M25"),
             "semesters": {"M25": {"courses": [course], "scraped_at": "2026-08-13"}}}
    soc, calls = run_scrape(monkeypatch, tmp_path, ON_FORM, prior=prior,
                            scraped={c: [copy.deepcopy(course)] for c, _ in ON_FORM})
    assert calls == ["S27", "F26", "M26", "S26", "F25"]
    assert soc["metadata"]["semesters_on_form"] == [{"code": c, "label": label} for c, label in ON_FORM]
    assert sorted(soc["semesters"]) == ["F25", "F26", "M25", "M26", "S26", "S27"], "M25 left the form: kept as history"
    assert soc_form_semesters(soc) == ["S27", "F26", "M26", "S26", "F25"]

    # SEMESTERS_TO_TRY scrapes one semester; the form's list is still what soc.json records.
    monkeypatch.setenv("SEMESTERS_TO_TRY", "S27")
    soc, calls = run_scrape(monkeypatch, tmp_path, ON_FORM, prior=soc, scraped={"S27": [course]})
    assert calls == ["S27"]
    assert soc_form_semesters(soc) == ["S27", "F26", "M26", "S26", "F25"]


def test_without_the_form_semesters_the_scrape_stops_and_writes_nothing(monkeypatch, tmp_path):
    monkeypatch.delenv("SEMESTERS_TO_TRY", raising=False)
    prior = {"metadata": form_metadata("S27", "F26"), "semesters": {}}
    with pytest.raises(SystemExit) as stop:
        run_scrape(monkeypatch, tmp_path, [], prior=prior, scraped={"S27": [soc_course("85211", "x", [section("W")])]})
    assert stop.value.code == 1
    assert json.loads((tmp_path / "soc.json").read_text(encoding="utf-8")) == prior


# ── reconcile: courses.json "soc_semesters" ─────────────────

def catalog_row(code, name, offered=("F24",)):
    return {"course_code": code, "course_name": name, "units": 9, "offered": list(offered),
            "offered_qatar": False, "offered_pitts": False,
            "requirements": {"CS": [], "IS": [], "BA": [], "BS": []}, "offerings": [],
            "description": "", "prerequisites": ""}


def reconcile(tmp_path, soc, catalog):
    soc_path, courses_path = tmp_path / "soc.json", tmp_path / "courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps(catalog), encoding="utf-8")
    stats = reconcile_file(str(courses_path), str(soc_path))
    return stats, json.loads(courses_path.read_text(encoding="utf-8")), courses_path


def left_the_form_soc():
    """F25 has left the form; soc.json still holds its sections."""
    return {
        "metadata": form_metadata("F26", "S27", "M26", "S26"),
        "semesters": {
            "S27": {"courses": [soc_course("85211", "Cognitive Psychology", [section("W")])]},
            "F25": {"courses": [soc_course("85211", "Cognitive Psychology", [section("A", "Pittsburgh")]),
                                soc_course("85213", "Human Memory", [section("W")])]},
        },
    }


def test_reconcile_writes_the_form_semesters_first_and_keeps_older_sections_as_history(tmp_path):
    catalog = {"courses": [catalog_row("85-211", "Cognitive Psychology")], "soc_semesters": ["F25", "F24"]}
    stats, out, path = reconcile(tmp_path, left_the_form_soc(), catalog)
    assert list(out) == ["soc_semesters", "courses"], "the small list first, ahead of the catalog"
    assert out["soc_semesters"] == ["S27", "F26", "M26", "S26"], "newest first; F25 is not on the form"
    assert stats["soc_semesters"] == ["S27", "F26", "M26", "S26"]
    rows = {r["course_code"]: r for r in out["courses"]}
    # The F25 sections stay in the offerings (the card's offering history) ...
    assert [(o["semester_code"], o["campus"]) for o in rows["85-211"]["offerings"]] == [("S27", "Qatar"), ("F25", "Pittsburgh")]
    assert [(o["semester_code"], o["section"]) for o in rows["85-213"]["offerings"]] == [("F25", "W")]
    assert rows["85-213"]["offered"] == ["F25"]
    # ... and a second run changes nothing.
    before = path.read_bytes()
    reconcile_file(str(path), str(tmp_path / "soc.json"))
    assert path.read_bytes() == before


def test_without_a_form_list_reconcile_writes_no_semester_list(tmp_path):
    soc = left_the_form_soc()
    del soc["metadata"]
    _, out, _ = reconcile(tmp_path, soc, {"courses": [catalog_row("85-211", "Cognitive Psychology")], "soc_semesters": ["S27"]})
    assert "soc_semesters" not in out, "an old list is not kept: the app falls back to the offerings"


# ── validate_soc_coverage: the catalog list must be the form's ──

def run_validate(monkeypatch, tmp_path, soc, catalog, capsys):
    soc_path, courses_path = tmp_path / "v-soc.json", tmp_path / "v-courses.json"
    soc_path.write_text(json.dumps(soc), encoding="utf-8")
    courses_path.write_text(json.dumps(catalog), encoding="utf-8")
    monkeypatch.setattr(vsc, "SOC_PATH", str(soc_path))
    monkeypatch.setattr(vsc, "COURSES_PATH", str(courses_path))
    code = vsc.main()
    return code, capsys.readouterr().out


def test_the_coverage_check_fails_when_the_catalog_list_is_not_the_form_list(monkeypatch, tmp_path, capsys):
    soc = left_the_form_soc()
    _, catalog, _ = reconcile(tmp_path, soc, {"courses": [catalog_row("85-211", "Cognitive Psychology")]})
    code, out = run_validate(monkeypatch, tmp_path, soc, catalog, capsys)
    assert code == 0, out
    assert "Semester picker (soc_semesters): S27, F26, M26, S26, as on the SOC form" in out

    stale = dict(catalog, soc_semesters=["S27", "F26", "M26", "S26", "F25"])
    code, out = run_validate(monkeypatch, tmp_path, soc, stale, capsys)
    assert code == 1
    assert "FAIL: courses.json soc_semesters is ['S27', 'F26', 'M26', 'S26', 'F25'], but the SOC form lists" in out

    missing = {"courses": catalog["courses"]}
    code, out = run_validate(monkeypatch, tmp_path, soc, missing, capsys)
    assert code == 1 and "soc_semesters is None" in out


def test_the_served_catalog_lists_the_semesters_of_the_served_soc_form():
    repo = Path(__file__).resolve().parents[3]
    soc = json.loads((repo / "backend" / "data" / "soc.json").read_text(encoding="utf-8"))
    catalog = json.loads((repo / "frontend" / "data" / "courses.json").read_text(encoding="utf-8"))
    assert catalog["soc_semesters"] == soc_form_semesters(soc)
    assert vsc.semester_list_problem(catalog, soc) is None
