"""frontend/data/minors.json against the official minor files in backend/data/minors/.

minors.json is built by hand from the official CMU-Q minor files (one audit export
per minor). These tests keep it tied to them: every course code comes from the
minor's own file (an old Psychology number appears as its current number), no
listed code is lost, the number ranges are the file's ranges, every category has
a rule, and no category lists a code twice.
"""
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend/scraper

from pipeline_paths import BACKEND_DATA_DIR, FRONTEND_DATA_DIR  # noqa: E402

MINORS_JSON = FRONTEND_DATA_DIR / "minors.json"
OFFICIAL_DIR = BACKEND_DATA_DIR / "minors"
SCOTTY_MD = OFFICIAL_DIR / "Minors_general-information_Scotty.md"

# Removed from the catalog on 2026-11-09; the minor files still list some of them.
# Same mapping as test_mapping_overlay_sections.py and the README cutover steps.
OLD_PSYCHOLOGY_NUMBERS = {
    "85-104": "85-190", "85-253": "85-190", "85-261": "85-190", "85-211": "85-110",
    "85-219": "85-170", "85-221": "85-130", "85-241": "85-150", "85-377": "85-452",
    "85-442": "85-454", "85-359": "85-411", "85-340": "85-350",
}

EXPECTED_MINORS = {
    "arabic", "biology", "business", "business_analytics", "comp_bio", "cs",
    "economics", "finance", "history", "math", "neuroscience", "writing",
    "psychology", "sociology", "tech_entre", "self_defined",
}
# No minor in the student's own major field (cs, biology, business), and the
# 2026-27 catalog page of the Business Administration major also bars BA majors
# from the Business Analytics and Optimization and Financial Management minors.
BLOCKED_MAJORS = {
    "cs": ["CS"], "biology": ["BS"], "business": ["BA"],
    "business_analytics": ["BA"], "finance": ["BA"],
}
MAJORS = {"CS", "IS", "BA", "BS", "AI", "GS"}
RULE_TYPES = {"take_all", "required", "pick", "min_units", "max_units", "max_courses"}
CAP_TYPES = {"max_units", "max_courses"}

CODE_RE = re.compile(r"(?:\d{2}|[A-Z]{2})-\d{3}")
DASH_RE = re.compile("[\u2012\u2013\u2014\u2015]")
SPACED_HYPHEN_RE = re.compile(r"[A-Za-z0-9)]\s+-{1,2}\s+[A-Za-z0-9(]")

MINOR_KEYS = {
    "name", "title", "source_file", "version", "campus_note", "blocked_majors",
    "total_units", "double_count", "grade_rules", "notes", "categories",
}
DOUBLE_COUNT_KEYS = {
    "text", "max_with_major", "max_with_other_minors", "gen_ed_exempt",
    "no_limit_categories", "no_sharing_categories", "by_major", "notes",
}
CATEGORY_KEYS = {"id", "name", "rule", "courses", "select", "children", "notes"}
SELECT_KEYS = {
    "prefixes", "min_number", "max_number", "exclude", "exclude_ranges",
    "min_units_per_course",
}


@pytest.fixture(scope="module")
def doc():
    return json.loads(MINORS_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def minors(doc):
    return doc["minors"]


def official(minor):
    return json.loads((OFFICIAL_DIR / minor["source_file"]).read_text(encoding="utf-8"))


def with_file(minors):
    return {code: m for code, m in minors.items() if m["source_file"]}


def walk_categories(categories, parent=None):
    """(category, parent category or None), depth first."""
    for cat in categories:
        yield cat, parent
        yield from walk_categories(cat["children"], cat)


def leaves(minor):
    return [c for c, _ in walk_categories(minor["categories"]) if not c["children"]]


def official_codes(data):
    """(listed, excluded): the codes the file offers and the codes it excludes.

    Only program_requirements is read, so a code that the Description or Notes
    prose merely mentions does not count; range bounds (start, end) are skipped.
    """
    listed, excluded = set(), set()

    def walk(node, key):
        if isinstance(node, dict):
            for k, v in node.items():
                if k not in ("start", "end"):
                    walk(v, k)
        elif isinstance(node, list):
            for item in node:
                walk(item, key)
        elif isinstance(node, str) and CODE_RE.fullmatch(node):
            (excluded if key == "excluded_courses" else listed).add(node)

    walk(data["program_requirements"], None)
    return listed, excluded


def _split(code):
    prefix, number = code.split("-")
    return prefix, int(number)


def official_ranges(data):
    """({(prefix, low, high, unit floor)}, {(prefix, low, high) excluded}) from the
    file's course_range, subject_code(s) with excluded_ranges, course_pattern,
    excluded_patterns and min_units_per_course."""
    ranges, excluded = set(), set()

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        floor = node.get("min_units_per_course")
        if "course_range" in node:
            (p, low), (p2, high) = _split(node["course_range"]["start"]), _split(node["course_range"]["end"])
            assert p == p2
            ranges.add((p, low, high, floor))
        subjects = node.get("subject_codes") or ([node["subject_code"]] if "subject_code" in node else [])
        for p in subjects:
            low = 0
            for cut in node.get("excluded_ranges", []):
                (cp, cut_low), (_, cut_high) = _split(cut["start"]), _split(cut["end"])
                if cp == p:
                    assert cut_low <= 1, cut  # the files only cut off the bottom of a subject
                    low = cut_high + 1
            ranges.add((p, low, 999, floor))
        if "course_pattern" in node:
            m = re.fullmatch(r"(\d{2})-(\d)XX", node["course_pattern"])
            ranges.add((m[1], int(m[2]) * 100, int(m[2]) * 100 + 99, floor))
        for pattern in node.get("excluded_patterns", []):
            m = re.fullmatch(r"(\d{2})-(\d)\*\*", pattern)
            excluded.add((m[1], int(m[2]) * 100, int(m[2]) * 100 + 99))
        for value in node.values():
            walk(value)

    walk(data["program_requirements"])
    return ranges, excluded


def all_strings(node):
    if isinstance(node, dict):
        for v in node.values():
            yield from all_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from all_strings(v)
    elif isinstance(node, str):
        yield node


def test_file_shape(doc, minors):
    assert set(doc) == {"schema_version", "note", "minors"}
    assert doc["schema_version"] == 1
    assert set(minors) == EXPECTED_MINORS  # product has no official file and is dropped
    for code, m in minors.items():
        assert set(m) == MINOR_KEYS, code
        assert set(m["double_count"]) == DOUBLE_COUNT_KEYS, code
        assert m["title"].startswith("Minor in ") or code == "self_defined", code
        for cat, _ in walk_categories(m["categories"]):
            assert set(cat) == CATEGORY_KEYS, (code, cat["id"])
            assert cat["select"] is None or set(cat["select"]) == SELECT_KEYS, (code, cat["id"])
            group_pick = bool(cat["children"]) and cat["rule"]["type"] == "pick"
            assert set(cat["rule"]) == {"type", "n", "units"} | ({"count"} if group_pick else set()), \
                (code, cat["id"])


def test_each_official_file_is_one_minor(minors):
    files = sorted(p.name for p in OFFICIAL_DIR.glob("cmu_minor_*.json"))
    assert sorted(m["source_file"] for m in with_file(minors).values()) == files
    for code, m in minors.items():
        if not m["source_file"]:
            assert code == "self_defined"
            assert m["categories"] == [] and m["version"] is None
            continue
        info = official(m)["minor"]
        assert m["title"] == info["name"], code
        assert m["version"] == info["version"], code
        campus = info.get("campus")
        expected = None if campus in ("Doha", "Qatar") else {
            None: "Campus not stated", "Pittsburgh": "Pittsburgh version"}[campus]
        assert m["campus_note"] == expected, code


def test_course_codes_come_from_the_minor_file(minors):
    for code, m in with_file(minors).items():
        listed, excluded = official_codes(official(m))
        allowed = {OLD_PSYCHOLOGY_NUMBERS.get(c, c) for c in listed}
        for cat in leaves(m):
            for c in cat["courses"]:
                assert c in allowed, (code, cat["id"], c)
            for c in (cat["select"] or {}).get("exclude", []):
                assert c in excluded, (code, cat["id"], c)


def test_no_listed_code_is_lost(minors):
    for code, m in with_file(minors).items():
        listed, excluded = official_codes(official(m))
        courses = {c for cat in leaves(m) for c in cat["courses"]}
        excludes = {c for cat in leaves(m) for c in (cat["select"] or {}).get("exclude", [])}
        missing = {c for c in listed if OLD_PSYCHOLOGY_NUMBERS.get(c, c) not in courses}
        assert not missing, (code, sorted(missing))
        assert excluded == excludes, code


def test_old_psychology_numbers_appear_as_current_numbers(minors):
    for code, m in minors.items():
        codes = {c for cat in leaves(m) for c in cat["courses"] + (cat["select"] or {}).get("exclude", [])}
        assert not codes & set(OLD_PSYCHOLOGY_NUMBERS), code
        if m["source_file"]:
            listed, _ = official_codes(official(m))
            for old in listed & set(OLD_PSYCHOLOGY_NUMBERS):
                assert OLD_PSYCHOLOGY_NUMBERS[old] in codes, (code, old)


def test_number_ranges_match_the_minor_file(minors):
    for code, m in with_file(minors).items():
        ranges, excluded = official_ranges(official(m))
        selects = [cat["select"] for cat in leaves(m) if cat["select"]]
        assert {(p, s["min_number"], s["max_number"], s["min_units_per_course"])
                for s in selects for p in s["prefixes"]} == ranges, code
        assert {(r["prefix"], r["min_number"], r["max_number"])
                for s in selects for r in s["exclude_ranges"]} == excluded, code
        for s in selects:
            assert all(re.fullmatch(r"\d{2}", p) for p in s["prefixes"]), code
            assert 0 <= s["min_number"] <= s["max_number"] <= 999, code


def test_every_category_has_a_rule(minors):
    for code, m in minors.items():
        ids, names = [], []
        for cat, parent in walk_categories(m["categories"]):
            where = (code, cat["id"])
            ids.append(cat["id"])
            names.append(cat["name"])
            assert cat["name"] and "---" not in cat["name"], where
            rule = cat["rule"]
            assert rule["type"] in RULE_TYPES, where
            if rule["type"] in ("pick", "max_courses"):
                assert isinstance(rule["n"], int) and rule["n"] >= 1, where
            if rule["type"] in ("min_units", "max_units"):
                assert isinstance(rule["units"], int) and rule["units"] >= 1, where
            if cat["children"]:
                assert not cat["courses"] and cat["select"] is None, where
                assert rule["type"] in ("take_all", "pick", "min_units"), where
                if rule["type"] == "pick":
                    assert rule["count"] in ("children", "courses"), where
                    if rule["count"] == "children":
                        assert rule["n"] <= len(cat["children"]), where
            else:
                assert cat["courses"] or cat["select"], where
                assert "count" not in rule, where
                if rule["type"] == "required":
                    assert len(cat["courses"]) == 1 and cat["select"] is None, where
                if rule["type"] == "pick" and cat["select"] is None:
                    assert rule["n"] <= len(cat["courses"]), where
            if rule["type"] in CAP_TYPES:
                prule = parent and parent["rule"]
                assert prule and (prule["type"] == "min_units" or prule.get("count") == "courses"), where
        assert len(ids) == len(set(ids)), code
        assert len(names) == len(set(names)), code


def test_rule_numbers_come_from_the_minor_file(minors):
    """Every unit amount and every course count above 1 that the file states is a
    rule number in minors.json, and minors.json has no other ones."""
    count_re = re.compile(
        r"\b(?:Take (?:at least|any|exactly)|Choose any) (\d+|two|three|four|five|six) courses?\b")
    words = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
    for code, m in with_file(minors).items():
        data = official(m)["program_requirements"]
        units, counts = set(), set()

        def walk(node):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k == "min_units":
                        units.add(v)
                    elif k == "max_units_from_creative_writing":
                        units.add(v["limit"])
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)
            elif isinstance(node, str):
                for n in count_re.findall(node):
                    counts.add(words.get(n) or int(n))

        walk(data)
        rules = [cat["rule"] for cat, _ in walk_categories(m["categories"])]
        assert {r["units"] for r in rules} - {None} == units, code
        assert {r["n"] for r in rules if r["n"] and r["n"] > 1} == {n for n in counts if n > 1}, code


def test_no_code_twice_in_a_category(minors):
    for code, m in minors.items():
        for cat in leaves(m):
            assert len(cat["courses"]) == len(set(cat["courses"])), (code, cat["id"])
            exclude = (cat["select"] or {}).get("exclude", [])
            assert len(exclude) == len(set(exclude)), (code, cat["id"])
            for c in cat["courses"] + exclude:
                assert CODE_RE.fullmatch(c), (code, cat["id"], c)


def test_blocked_majors(minors):
    for code, m in minors.items():
        assert m["blocked_majors"] == BLOCKED_MAJORS.get(code, []), code


def test_double_count_limits(minors):
    for code, m in minors.items():
        dc = m["double_count"]
        assert dc["gen_ed_exempt"] is True, code
        assert dc["max_with_major"] == dc["max_with_other_minors"], code
        assert dc["max_with_major"] is None or dc["max_with_major"] >= 0, code
        ids = {cat["id"] for cat, _ in walk_categories(m["categories"])}
        for lists in [dc] + list(dc["by_major"].values()):
            assert set(lists["no_limit_categories"]) <= ids, code
            assert set(lists["no_sharing_categories"]) <= ids, code
            assert not set(lists["no_limit_categories"]) & set(lists["no_sharing_categories"]), code
        assert set(dc["by_major"]) <= MAJORS, code
        assert dc["notes"] or code == "self_defined", code


def test_double_count_text_is_verbatim(minors):
    for code, m in with_file(minors).items():
        data = official(m)
        text = m["double_count"]["text"]
        rules = data["program_requirements"].get("double_counting_rules")
        if text is None:
            assert rules is None and "double_count" not in json.dumps(data), code
            continue
        strings = list(all_strings(data))
        for piece in text.split(" | "):
            assert any(piece in s for s in strings), (code, piece)
        # A file with only a minor wide "Up to N" or "without any limit" sentence
        # keeps that limit, unchanged.
        if isinstance(rules, dict) and set(rules) <= {
                "general", "description", "max_courses_double_count",
                "unlimited_double_count_with_programs", "cannot_double_count_with_programs",
                "restrictions"}:
            sentence = rules.get("general") or rules.get("description")
            limit = re.search(r"Up to (\d+) courses? may double count", sentence)
            expected = int(limit[1]) if limit else None
            assert limit or "without any limit" in sentence, code
            assert m["double_count"]["max_with_major"] == expected, code


def test_total_units_follow_the_files(minors):
    scotty = SCOTTY_MD.read_text(encoding="utf-8")
    for code, m in with_file(minors).items():
        stated = official(m)["program_requirements"].get("total_min_units")
        if stated is not None:
            assert m["total_units"] == stated, code
        elif m["total_units"] is not None:  # the audit states none: Scotty's minimum
            assert re.search(rf"Minimum of\s+{m['total_units']}\s+units", scotty, re.I), code


def test_user_facing_text_has_no_dashes(minors):
    # version and double_count.text are verbatim source strings and are not checked.
    texts = []
    for code, m in minors.items():
        texts += [m["name"], m["title"], m["campus_note"] or ""]
        texts += m["grade_rules"] + m["notes"] + m["double_count"]["notes"]
        for cat, _ in walk_categories(m["categories"]):
            texts += [cat["name"]] + cat["notes"]
    for text in texts:
        assert not DASH_RE.search(text), text
        assert not SPACED_HYPHEN_RE.search(text), text
        assert not re.search(r"\bQ\d+\b", text), text  # no review question ids
