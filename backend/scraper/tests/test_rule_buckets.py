"""Rule buckets (the "rule_buckets" section of backend/data/mapping_overlays.json)
and requirement_buckets.json.

Small synthetic catalogs check how a rule is expanded against the course rows:
matching courses get a row tagged "source": "rule", stale rule rows go, rows
without the tag are never touched, remove_mappings still wins, and a second
run changes nothing. The last tests check the real rules against the archived
catalog pages and the served frontend/data files.
"""
import copy
import json
import re
from pathlib import Path

import pytest

import apply_mapping_overlays as amo
from apply_mapping_overlays import (
    OverlayError,
    apply_file,
    apply_overlay_document,
    course_max_units,
    requirement_buckets,
)
from pipeline_paths import COURSES_JSON, MAPPING_OVERLAYS_JSON, ROOT

SCS = "BS in Computer Science---Computer Science---Two School of Computer Science electives"
CORE = "BS in Computer Science---Computer Science---Computer Science Core"
HA = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"
SR = "GenEd---University Core---Scientific Reasoning"
AI_SCS = "BS in Artificial Intelligence---School of Computer Science Electives"
SOURCE = [{"file": "backend/data/sources/catalog-2026-27/majors/computer-science-bs.html",
           "heading": "Computer Science > Two School of Computer Science electives"}]


def req(major, path, gened, **extra):
    return {"requirement": path, "type": gened, "major": major, **extra}


def tagged(major, path, gened):
    return req(major, path, gened, source="rule")


def course(code, units=9, offerings=(), reqs=None, **extra):
    """A catalog row; offerings is a list of SOC unit strings ("12", "3-12", "VAR")."""
    row = {
        "course_code": code,
        "course_name": code,
        "units": units,
        "offerings": [{"semester_code": "F26", "campus": "Pittsburgh", "section": "A", "units": u}
                      for u in offerings],
        "requirements": {"CS": [], "IS": [], "BA": [], "BS": []},
    }
    for r in reqs or []:
        row["requirements"].setdefault(r["major"], []).append(dict(r))
    row.update(extra)
    return row


def scs_rule(**select):
    """An SCS electives rule: 15 and 17, 200 to 599, at least 9 units."""
    sel = {"prefixes": ["15", "17"], "min_number": 200, "max_number": 599, "min_units_per_course": 9,
           "include": ["15-195"], "exclude": ["15-351", {"from": "17-300", "to": "17-399"}]}
    sel.update(select)
    return {"id": "cs-scs", "program": "CS", "path": SCS, "type": False, "select": sel, "source": SOURCE}


def sr_rule(program="BA"):
    return {"id": f"{program.lower()}-sr", "program": program, "path": SR, "type": True,
            "select": {"ranges": [{"from": "85-102", "to": "85-599"}]}, "source": SOURCE}


def by_code(courses):
    return {c["course_code"]: c for c in courses}


def rows(c, major):
    return [(r["requirement"], r.get("source")) for r in c["requirements"].get(major, [])]


# ── Expansion ────────────────────────────────────────────────

def test_every_matching_course_gets_a_tagged_row():
    courses = [
        course("15-213", 12),                 # 200 level or above, 12 units
        course("17-200", 9),                  # the other prefix, exactly 9 units
        course("15-150", 12),                 # below 200
        course("15-610", 12),                 # graduate: above max_number
        course("15-300", 6),                  # too few units
        course("15-351", 12),                 # excluded by code
        course("17-313", 12),                 # excluded by range
        course("02-251", 12),                 # prefix not in the rule
        course("15-195", 5),                  # include: counts below the level and units
    ]
    stats = apply_overlay_document(courses, {"rule_buckets": [scs_rule()]})
    got = {c["course_code"] for c in courses if rows(c, "CS")}
    assert got == {"15-213", "17-200", "15-195"}
    assert by_code(courses)["15-213"]["requirements"]["CS"] == [tagged("CS", SCS, False)]
    assert stats["rule_rows_added"] == 3 and stats["rule_rows_removed"] == 0
    assert stats["rule_buckets"]["cs-scs"] == {"matched": 3, "added": 3}


def test_ranges_select_by_number_without_prefixes():
    courses = [course("85-102"), course("85-101"), course("85-599"), course("85-600"), course("09-105")]
    apply_overlay_document(courses, {"rule_buckets": [sr_rule()]})
    assert {c["course_code"] for c in courses if rows(c, "BA")} == {"85-102", "85-599"}


def test_units_are_the_most_a_course_can_carry():
    assert course_max_units(course("15-300", 3, ["3-12"])) == 12
    assert course_max_units(course("15-300", 3, ["3,6,9,12"])) == 12
    assert course_max_units(course("15-300", 9, ["VAR"])) == 9     # VAR: the numeric units
    assert course_max_units(course("15-300", 0, ["VAR"])) == 0
    assert course_max_units(course("15-300", 6, ["6", "9"])) == 9   # the most of any offering
    cancelled = course("15-300", 6, ["12"])
    cancelled["offerings"][0]["cancelled"] = True
    assert course_max_units(cancelled) == 6                          # a cancelled section is not an offering
    assert course_max_units({"course_code": "15-300"}) is None

    courses = [course("15-410", 3, ["3-12"]), course("15-411", 0, ["VAR"]), course("15-412", 9, ["VAR"])]
    apply_overlay_document(courses, {"rule_buckets": [scs_rule()]})
    assert {c["course_code"] for c in courses if rows(c, "CS")} == {"15-410", "15-412"}


def test_a_course_that_already_has_the_bucket_gets_no_second_row():
    plain = course("15-213", 12, reqs=[req("CS", SCS, False), req("CS", CORE, False)])
    courses = [plain]
    stats = apply_overlay_document(courses, {"rule_buckets": [scs_rule()]})
    assert rows(plain, "CS") == [(SCS, None), (CORE, None)]
    assert stats["rule_rows_added"] == 0 and stats["rule_buckets"]["cs-scs"]["matched"] == 1


def test_stale_rule_rows_go_and_untagged_rows_stay():
    courses = [
        course("15-300", 6, reqs=[tagged("CS", SCS, False)]),             # now below 9 units: goes
        course("15-351", 12, reqs=[req("CS", SCS, False)]),               # excluded, but untagged: stays
        course("15-352", 12, reqs=[tagged("CS", HA, True), req("CS", CORE, False)]),  # no rule for HA: goes
        course("15-213", 12, reqs=[tagged("CS", SCS, False)]),            # still matches: stays
    ]
    stats = apply_overlay_document(courses, {"rule_buckets": [scs_rule()]})
    rows_by = {c["course_code"]: rows(c, "CS") for c in courses}
    assert rows_by["15-300"] == []
    assert rows_by["15-351"] == [(SCS, None)]
    assert rows_by["15-352"] == [(CORE, None), (SCS, "rule")]
    assert rows_by["15-213"] == [(SCS, "rule")]
    assert stats["rule_rows_removed"] == 2


def test_a_rule_that_is_dropped_takes_its_rows_with_it():
    courses = [course("15-213", 12)]
    apply_overlay_document(courses, {"rule_buckets": [scs_rule()]})
    assert rows(courses[0], "CS") == [(SCS, "rule")]
    stats = apply_overlay_document(courses, {"rule_buckets": []})
    assert rows(courses[0], "CS") == [] and stats["rule_rows_removed"] == 1


def test_ai_rows_get_their_own_key_and_an_emptied_ai_list_goes():
    ai = dict(scs_rule(), id="ai-scs", program="AI", path=AI_SCS)
    courses = [course("15-213", 12)]
    apply_overlay_document(courses, {"rule_buckets": [ai]})
    assert courses[0]["requirements"]["AI"] == [tagged("AI", AI_SCS, False)]
    apply_overlay_document(courses, {"rule_buckets": [dict(ai, select=dict(ai["select"], exclude=["15-213"]))]})
    assert set(courses[0]["requirements"]) == {"CS", "IS", "BA", "BS"}


def test_remove_mappings_still_win():
    courses = [course("85-414", 9, reqs=[tagged("BA", SR, True)]), course("85-426", 9), course("85-310", 9)]
    doc = {"rule_buckets": [sr_rule()],
           "remove_mappings": [{"course_code": "85-414", "programs": "all"},
                               {"course_code": "85-426", "programs": ["BA"]}]}
    for _ in range(2):
        apply_overlay_document(courses, doc)
        got = by_code(courses)
        assert rows(got["85-414"], "BA") == [] and rows(got["85-426"], "BA") == []
        assert rows(got["85-310"], "BA") == [(SR, "rule")]


def test_an_overlay_row_takes_over_a_rule_row():
    courses = [course("85-310", 9, reqs=[tagged("BA", SR, True)])]
    overlay = {"id": "sheet", "course_codes": ["85-310"], "create_missing": False,
               "requirements": {"BA": [req("BA", SR, True)]}}
    apply_overlay_document(courses, {"overlays": [overlay], "rule_buckets": [sr_rule()]})
    assert courses[0]["requirements"]["BA"] == [req("BA", SR, True)]
    # The row is the overlay's now: a rule that no longer selects the course leaves it alone.
    apply_overlay_document(courses, {"rule_buckets": []})
    assert courses[0]["requirements"]["BA"] == [req("BA", SR, True)]


def test_rows_the_overlay_step_created_never_match():
    seed = course("85-310", 12, reqs=[tagged("BA", SR, True)], manual_seed=True)
    courses = [seed]
    apply_overlay_document(courses, {"rule_buckets": [sr_rule()]})
    assert rows(seed, "BA") == []


def test_second_run_changes_nothing():
    courses = [course("15-213", 12), course("15-300", 6, reqs=[tagged("CS", SCS, False)]),
               course("85-310", 9), course("85-414", 9)]
    doc = {"rule_buckets": [scs_rule(), sr_rule()],
           "remove_mappings": [{"course_code": "85-414", "programs": "all"}]}
    apply_overlay_document(courses, doc)
    once = copy.deepcopy(courses)
    stats = apply_overlay_document(courses, doc)
    assert courses == once
    assert stats["rule_rows_added"] == 0 and stats["rule_rows_removed"] == 0


def test_apply_file_twice_gives_identical_files(tmp_path):
    path = tmp_path / "courses.json"
    path.write_text(json.dumps({"_meta": {}, "courses": [course("15-213", 12), course("85-310")]}),
                    encoding="utf-8")
    doc = {"rule_buckets": [scs_rule(), sr_rule()],
           "catalog_buckets": {"CS": [SCS.rsplit("---", 1)[0], SCS], "BA": ["GenEd---University Core", SR]}}
    apply_file(path, doc)
    first = path.read_bytes(), (tmp_path / "requirement_buckets.json").read_bytes()
    apply_file(path, doc)
    assert (path.read_bytes(), (tmp_path / "requirement_buckets.json").read_bytes()) == first


def test_includes_missing_from_the_catalog_are_reported_not_created():
    courses = [course("15-213", 12)]
    stats = apply_overlay_document(courses, {"rule_buckets": [scs_rule(include=["15-195", "15-295"])]})
    assert stats["rule_includes_missing"] == ["cs-scs: 15-195", "cs-scs: 15-295"]
    assert [c["course_code"] for c in courses] == ["15-213"]


# ── Validation ───────────────────────────────────────────────

def _with(rule, **changes):
    out = copy.deepcopy(rule)
    for key, value in changes.items():
        if key.startswith("select_"):
            out["select"][key[len("select_"):]] = value
        else:
            out[key] = value
    return out


BAD_RULES = {
    "unknown field": _with(scs_rule(), units=9),
    "unknown select field": _with(scs_rule(), select_level=200),
    "bad id": _with(scs_rule(), id="CS SCS"),
    "unknown program": _with(scs_rule(), program="XX"),
    "type does not match the root": _with(scs_rule(), type=True),
    "path without a bucket": _with(scs_rule(), path="GenEd"),
    "one digit prefix": _with(scs_rule(), select_prefixes=["5"]),
    "min above max": _with(scs_rule(), select_min_number=500, select_max_number=200),
    "prefixes without numbers": {**scs_rule(), "select": {"prefixes": ["15"]}},
    "range across subjects": _with(scs_rule(), select_exclude=[{"from": "17-300", "to": "18-399"}]),
    "include and exclude overlap": _with(scs_rule(), select_include=["15-351"]),
    "bad code": _with(scs_rule(), select_include=["15122"]),
    "zero units": _with(scs_rule(), select_min_units_per_course=0),
    "non technical without its list": _with(scs_rule(), select_exclude=[], select_non_technical=True),
    "no source": _with(scs_rule(), source=[]),
    "source without heading": _with(scs_rule(), source=[{"file": "x.html"}]),
}


@pytest.mark.parametrize("case", list(BAD_RULES))
def test_invalid_rules_are_refused(case):
    with pytest.raises(OverlayError):
        apply_overlay_document([course("15-213", 12)], {"rule_buckets": [BAD_RULES[case]]})


def test_duplicate_ids_and_overlay_id_clashes_are_refused():
    with pytest.raises(OverlayError):
        apply_overlay_document([], {"rule_buckets": [scs_rule(), scs_rule()]})
    overlay = {"id": "cs-scs", "course_codes": ["15-213"], "requirements": {}}
    with pytest.raises(OverlayError):
        apply_overlay_document([], {"overlays": [overlay], "rule_buckets": [scs_rule()]})


def test_a_rule_bucket_must_be_a_catalog_bucket():
    doc = {"rule_buckets": [scs_rule()], "catalog_buckets": {"CS": [CORE]}}
    with pytest.raises(OverlayError):
        apply_overlay_document([course("15-213", 12)], doc)


def test_an_invalid_rule_saves_nothing(tmp_path, monkeypatch, capsys):
    path = tmp_path / "courses.json"
    original = json.dumps({"courses": [course("15-213", 12)]})
    path.write_text(original, encoding="utf-8")
    overlays = tmp_path / "overlays.json"
    overlays.write_text(json.dumps({"rule_buckets": [BAD_RULES["one digit prefix"]]}), encoding="utf-8")
    monkeypatch.setattr(amo, "OVERLAYS_PATH", overlays)
    monkeypatch.setenv("CATALOG_PATHS", str(path))
    assert amo.main() == 1
    assert "catalog not saved" in capsys.readouterr().out
    assert path.read_text(encoding="utf-8") == original
    assert not (tmp_path / "requirement_buckets.json").exists()


# ── requirement_buckets.json ─────────────────────────────────

def test_bucket_list_keeps_catalog_order_and_adds_unlisted_paths():
    courses = [
        course("15-122", reqs=[req("CS", CORE, False)]),
        course("76-101", reqs=[req("CS", "GenEd---Humanities and Arts---A. First Year Writing Requirement", True)]),
        course("82-101", reqs=[req("IS", "GenEd---Foundations---Intercultural and Global Inquiry", True)]),
    ]
    doc = {
        "catalog_buckets": {"CS": ["BS in Computer Science---Computer Science", CORE,
                                   "BS in Computer Science---Free Electives"]},
        "rule_buckets": [scs_rule()],
    }
    out = requirement_buckets(courses, doc)
    assert list(out) == ["CS", "IS"]
    # catalog order first (with Free Electives, which has no rows), then every
    # row or rule path, or parent of one, that the list lacks, sorted
    assert out["CS"] == [
        "BS in Computer Science---Computer Science", CORE, "BS in Computer Science---Free Electives",
        SCS,
        "GenEd---Humanities and Arts",
        "GenEd---Humanities and Arts---A. First Year Writing Requirement",
    ]
    assert out["IS"] == ["GenEd---Foundations", "GenEd---Foundations---Intercultural and Global Inquiry"]


@pytest.mark.parametrize("bad", [
    {"XX": ["GenEd---A"]},
    {"CS": "GenEd---A"},
    {"CS": ["GenEd"]},
    {"CS": ["GenEd---A", "GenEd---A"]},
])
def test_bad_catalog_buckets_are_refused(bad):
    with pytest.raises(OverlayError):
        requirement_buckets([], {"catalog_buckets": bad})


def test_apply_file_writes_the_bucket_list_next_to_the_catalog(tmp_path):
    path = tmp_path / "courses.json"
    path.write_text(json.dumps({"courses": [course("15-213", 12)]}), encoding="utf-8")
    stats = apply_file(path, {"rule_buckets": [scs_rule()]})
    out = json.loads((tmp_path / "requirement_buckets.json").read_text(encoding="utf-8"))
    assert out == {"CS": ["BS in Computer Science---Computer Science", SCS]}
    assert stats["bucket_paths"] == 2


# ── The real rules, catalog and bucket list ──────────────────

DOC = json.loads(MAPPING_OVERLAYS_JSON.read_text(encoding="utf-8"))
RULES = DOC["rule_buckets"]
SOURCES = ROOT / "backend" / "data" / "sources"
BUCKETS_JSON = COURSES_JSON.with_name("requirement_buckets.json")
CODE_RE = re.compile(r"\b\d{2}-\d{3}\b")


@pytest.fixture(scope="module")
def real_courses():
    return json.loads(COURSES_JSON.read_text(encoding="utf-8"))["courses"]


def _page_text(rel):
    raw = (ROOT / rel).read_text(encoding="utf-8")
    return re.sub(r"<[^>]+>", " ", raw)


def test_every_rule_cites_archived_catalog_pages():
    manifest = json.loads((SOURCES / "catalog-2026-27" / "manifest.json").read_text(encoding="utf-8"))
    listed = {entry["file"] for entry in manifest}
    for rule in RULES:
        for src in rule["source"]:
            assert src["file"].startswith("backend/data/sources/catalog-2026-27/"), rule["id"]
            assert (ROOT / src["file"]).is_file(), (rule["id"], src["file"])
            assert src["file"].split("catalog-2026-27/", 1)[1] in listed, (rule["id"], src["file"])


def test_every_listed_code_is_on_a_cited_page_or_explained_in_the_note():
    """Additions and deletions come from the catalog; a code the pages do not
    print (a cross-listed or renumbered course) is named in the rule's note."""
    for rule in RULES:
        text = " ".join(_page_text(s["file"]) for s in rule["source"])
        on_pages = set(CODE_RE.findall(text))
        for field in ("include", "exclude"):
            for code in rule["select"].get(field, []):
                if isinstance(code, str):
                    assert code in on_pages or code in rule["note"], (rule["id"], field, code)


def test_rules_leave_graduate_courses_out():
    for rule in RULES:
        sel = rule["select"]
        if sel.get("prefixes"):
            assert sel["max_number"] <= 599, rule["id"]
        for rng in sel.get("ranges", []):
            assert int(rng["to"][3:]) <= 599, rule["id"]


def test_rule_buckets_are_the_settled_ones():
    assert [(r["id"], r["program"], r["path"].split("---")[-1]) for r in RULES] == [
        ("cs-scs-electives", "CS", "Two School of Computer Science electives"),
        ("cs-science-engineering", "CS", "Science and Engineering"),
        ("cs-humanities-arts-c", "CS", "C. Humanities and Arts Electives"),
        ("ai-scs-electives", "AI", "School of Computer Science Electives"),
        ("ai-science-engineering", "AI", "Science and Engineering"),
        ("ai-humanities-arts-c", "AI", "C. Humanities and Arts Electives"),
        ("ba-scientific-reasoning", "BA", "Scientific Reasoning"),
        ("ba-information-literacy", "BA", "Information Literacy"),
        ("ba-global-perspectives", "BA", "Global, Cultural, and Diverse Perspectives"),
        ("ba-business-electives", "BA", "Business Electives"),
        ("bs-cultural-global-languages", "BS", "D. Cultural/Global Understanding Course"),
        ("bs-nontechnical-electives", "BS", "E. Nontechnical Elective Courses"),
    ]
    by_id = {r["id"]: r for r in RULES}
    # AI uses the SCS general education rules because its page sends it there,
    # and its own School of Computer Science Electives lists.
    for gened in ("science-engineering", "humanities-arts-c"):
        assert by_id[f"ai-{gened}"]["select"] == by_id[f"cs-{gened}"]["select"]
        assert "majors/artificial-intelligence-bs.html" in by_id[f"ai-{gened}"]["source"][0]["file"]
    assert set(by_id["ai-scs-electives"]["select"]["exclude"]) < set(by_id["cs-scs-electives"]["select"]["exclude"])


def test_served_catalog_is_the_pipeline_output(real_courses):
    """courses.json is what the overlay step makes of it: a run changes nothing."""
    courses = copy.deepcopy(real_courses)
    stats = apply_overlay_document(courses, DOC)
    assert stats["rule_rows_added"] == 0 and stats["rule_rows_removed"] == 0
    assert stats["requirements_added"] == 0 and stats["mappings_removed"] == 0
    assert courses == real_courses


def test_rule_rows_sit_only_on_rule_buckets(real_courses):
    rule_paths = {(r["program"], r["path"]) for r in RULES}
    stray = sorted({(prog, row["requirement"]) for c in real_courses
                    for prog, reqs in c["requirements"].items() for row in reqs
                    if row.get("source") == "rule" and (prog, row["requirement"]) not in rule_paths})
    assert stray == []


def test_rule_rows_follow_the_catalog_decisions(real_courses):
    rows_of = {c["course_code"]: c["requirements"] for c in real_courses}

    def has(code, prog, leaf):
        return any(r["requirement"].endswith("---" + leaf) for r in rows_of[code].get(prog, []))

    assert has("85-458", "BA", "Scientific Reasoning")        # a Doha psychology course, by the 85-102 rule
    for code in ("85-414", "85-426"):                          # explicit removals win over every rule
        assert not any(rows_of[code].values()), code
    ai_scs = [c["course_code"] for c in real_courses for r in c["requirements"].get("AI", [])
              if r["requirement"] == AI_SCS]
    assert ai_scs and all(int(code[3:]) < 600 for code in ai_scs)
    assert not has("15-351", "AI", "School of Computer Science Electives")  # an AI deletion


def test_only_the_ai_scs_electives_rows_were_handed_to_their_rule(real_courses):
    """The AI School of Computer Science Electives rows were that rule written
    out once, so they are all rule rows. Every other row that was there before
    the rules stays untagged and counts as it is, also where its rule would not
    select it (a mini course in the CS and AI Humanities and Arts electives)."""
    ai_scs = [r for c in real_courses for r in c["requirements"].get("AI", []) if r["requirement"] == AI_SCS]
    assert ai_scs and all(r.get("source") == "rule" for r in ai_scs)
    compiled = {r.id: r for r in amo.compile_rule_buckets(RULES)}
    for rule_id in ("cs-humanities-arts-c", "ai-science-engineering", "ai-humanities-arts-c"):
        rule = compiled[rule_id]
        kept = [c["course_code"] for c in real_courses for r in c["requirements"].get(rule.program, [])
                if r["requirement"] == rule.path and "source" not in r and not rule.select.matches(c)]
        assert kept, rule_id


def test_served_bucket_list_covers_every_row(real_courses):
    served = json.loads(BUCKETS_JSON.read_text(encoding="utf-8"))
    assert served == requirement_buckets(real_courses, DOC)
    for c in real_courses:
        for prog, reqs in c["requirements"].items():
            for row in reqs:
                assert row["requirement"] in served[prog], (c["course_code"], prog, row["requirement"])
    for prog, paths in served.items():
        assert len(paths) == len(set(paths)), prog
        assert paths[:len(DOC["catalog_buckets"][prog])] == DOC["catalog_buckets"][prog], prog
    assert "GenEd---University Core---Free Electives" in served["BA"]  # a catalog bucket with no rows
