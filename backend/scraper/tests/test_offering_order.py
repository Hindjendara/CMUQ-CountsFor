"""The pipeline keeps the Schedule of Classes row order of a course's offerings.

The schedule planner links each section to the nearest lecture listed before
it in the same semester and campus (linkOfferingGroups in frontend/js/data.js),
so scraping both campus pages, reconcile_offerings and apply_mapping_overlays
must keep every lecture ahead of its own sections, in page order.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

import scrape_soc  # noqa: E402
from apply_mapping_overlays import apply_file  # noqa: E402
from reconcile_offerings import reconcile_file  # noqa: E402

HEADER = (
    '<table><thead><tr>'
    '<th class="col-course">Course</th><th class="col-title">Course Title</th>'
    '<th class="col-units">Units</th><th class="col-section">Sec</th>'
    '<th class="col-mini">Mini</th><th class="col-days">Days</th>'
    '<th class="col-begin">Begin</th><th class="col-end">End</th>'
    '<th class="col-location">Teaching Location</th>'
    '<th class="col-deliverymode">Delivery Mode</th>'
    '</tr></thead><tbody>'
)
TITLE = "Techniques in Quantitative Analysis"


def _row(*values, open_tr=False):
    """One table row. Real SOC rows after a course's first have no opening <tr>."""
    return ("<tr>" if open_tr else "") + "".join(f"<td>{v}</td>" for v in values) + "</tr>"


def _page(*rows):
    return HEADER + "".join(rows) + "</tbody></table>"


# 09-207 for Fall 2026 as the Pittsburgh and Doha result pages list it. The
# second A row is a continuation row (blank section cell, another meeting).
PAGES = {
    "PIT": _page(
        _row("09207", TITLE, "9", "Lec 1", "", "T", "03:30PM", "04:50PM", "Pittsburgh, Pennsylvania", "In-person only", open_tr=True),
        _row("", "", "", "A", "", "MW", "02:00PM", "04:20PM", "Pittsburgh, Pennsylvania", "In-person only"),
        _row("", "", "", "", "", "MW", "02:00PM", "02:50PM", "", ""),
        _row("", "", "", "B", "", "MW", "06:30PM", "07:20PM", "Pittsburgh, Pennsylvania", "In-person only"),
    ),
    "DOH": _page(
        _row("09207", TITLE, "9", "Lec 2", "", "U", "04:00PM", "04:50PM", "Doha, Qatar", "In-person only", open_tr=True),
        _row("", "", "", "W", "", "MW", "02:30PM", "05:30PM", "Doha, Qatar", "In-person only"),
    ),
}


def test_lectures_stay_ahead_of_their_sections_through_the_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape_soc, "fetch_post", lambda params: PAGES[params["PRG_LOCATION"]])
    monkeypatch.setattr(scrape_soc.time, "sleep", lambda _s: None)
    courses, _ = scrape_soc.scrape_semester("F26", [("CHE", "Chemistry")], min_courses=1)

    soc_path = tmp_path / "soc.json"
    courses_path = tmp_path / "courses.json"
    soc_path.write_text(json.dumps({"semesters": {"F26": {"courses": courses}}}), encoding="utf-8")
    catalog_row = {
        "course_code": "09-207", "course_name": TITLE, "units": 9, "offered": ["F26"],
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
        "offerings": [], "description": "", "prerequisites": "",
    }
    courses_path.write_text(json.dumps({"_meta": {}, "courses": [catalog_row]}), encoding="utf-8")

    reconcile_file(str(courses_path), str(soc_path))
    apply_file(courses_path, {"overlays": []})

    row = json.loads(courses_path.read_text(encoding="utf-8"))["courses"][0]
    assert [(o["campus"], o["section"], o["days_times"]) for o in row["offerings"]] == [
        ("Pittsburgh", "Lec 1", "T 03:30PM-04:50PM"),
        ("Pittsburgh", "A", "MW 02:00PM-04:20PM"),
        ("Pittsburgh", "A", "MW 02:00PM-02:50PM"),
        ("Pittsburgh", "B", "MW 06:30PM-07:20PM"),
        ("Qatar", "Lec 2", "U 04:00PM-04:50PM"),
        ("Qatar", "W", "MW 02:30PM-05:30PM"),
    ]
