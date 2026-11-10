"""update_data.py: the cron job that scrapes, checks and publishes the data in place.

Most tests swap the pipeline steps for a small fake script, so nothing touches
the network: a fake step records the paths it was given and copies prepared
files over the staged copies. One test runs the real reconcile, overlay and
validation steps (and the real parser test gate) on a copy of the repo's data.
"""
import gzip
import json
import os
import sys
from pathlib import Path

import pytest

import update_data

REPO_ROOT = Path(__file__).resolve().parents[3]
PATH_VARS = ("SOC_OUTPUT_PATH", "SOC_JSON_PATH", "COURSES_JSON_PATH", "CATALOG_PATHS",
             "MAPPING_OVERLAYS_PATH")

FAKE_STEP = r'''
import json, os, shutil, sys
name, action = sys.argv[1], sys.argv[2]
record = {"name": name, "env": {k: os.environ.get(k) for k in %(vars)r}}
soc = os.environ.get("SOC_OUTPUT_PATH")
record["staged_soc_at_start"] = open(soc, encoding="utf-8").read() if soc and os.path.exists(soc) else None
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(record) + "\n")
print(f"fake {name}: {action}")
if action == "fail":
    sys.exit(3)
if action.startswith("copy:"):
    _, src, var = action.split("|")
    shutil.copyfile(src, os.environ[var])
if action.startswith("beside:"):
    _, src, name = action.split("|")
    shutil.copyfile(src, os.path.join(os.path.dirname(os.environ["COURSES_JSON_PATH"]), name))
''' % {"vars": PATH_VARS}


def make_soc(last_scrape, counts):
    """counts: {semester: {campus: number of sections}}."""
    semesters = {}
    for sem, by_campus in counts.items():
        courses = []
        for campus, n in by_campus.items():
            courses.append({
                "course_number": "15122",
                "campus": [campus],
                "sections": [{"section": f"S{i}", "campus": campus} for i in range(n)],
            })
        semesters[sem] = {"courses": courses, "scraped_at": last_scrape}
    meta = {"last_scrape": last_scrape} if last_scrape else {}
    return {"metadata": meta, "semesters": semesters}


LIVE_COUNTS = {"F26": {"Pittsburgh": 100, "Qatar": 50}, "M25": {"Pittsburgh": 10, "Qatar": 4}}
LIVE_SOC = make_soc("2026-11-01T12:00:00+00:00", LIVE_COUNTS)
NEW_SOC = make_soc("2026-11-02T12:00:00+00:00", LIVE_COUNTS)
LIVE_CATALOG = {"_meta": {}, "courses": [{"course_code": f"15-{100 + i}"} for i in range(40)]}
NEW_CATALOG = {"_meta": {}, "courses": LIVE_CATALOG["courses"] + [{"course_code": "15-999"}]}
BUCKETS = {"CS": ["BS in Computer Science---Computer Science", "GenEd---Science and Engineering"]}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = data if isinstance(data, str) else json.dumps(data, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


class Deploy:
    def __init__(self, root, tmp):
        self.root = root
        self.tmp = tmp
        self.soc = root / "backend" / "data" / "soc.json"
        self.courses = root / "frontend" / "data" / "courses.json"
        self.gz = root / "frontend" / "data" / "courses.json.gz"
        self.buckets = root / "frontend" / "data" / "requirement_buckets.json"
        self.staging = root / "backend" / "var" / "staging"
        self.log = tmp / "fake_log.jsonl"
        self.script = tmp / "fake_step.py"
        self.script.write_text(FAKE_STEP, encoding="utf-8")

    def prepared(self, name, data):
        path = self.tmp / "prepared" / name
        dump(path, data)
        return path

    def fake_steps(self, monkeypatch, *, soc=None, catalog=None, buckets=None, fail=None):
        """Replace the pipeline: the scrape writes `soc`, reconcile writes `catalog`,
        the overlay step writes `buckets` (requirement_buckets.json) beside it."""
        actions = {"scrape_soc": "noop", "reconcile_offerings": "noop",
                   "apply_mapping_overlays": "noop", "validate_soc_coverage": "noop"}
        if soc is not None:
            actions["scrape_soc"] = f"copy:|{self.prepared('soc.json', soc)}|SOC_OUTPUT_PATH"
        if catalog is not None:
            actions["reconcile_offerings"] = (
                f"copy:|{self.prepared('courses.json', catalog)}|COURSES_JSON_PATH")
        if buckets is not None:
            actions["apply_mapping_overlays"] = (
                f"beside:|{self.prepared('requirement_buckets.json', buckets)}|requirement_buckets.json")
        if fail:
            actions[fail] = "fail"

        def steps(no_scrape):
            names = [n for n in actions if not (no_scrape and n == "scrape_soc")]
            return [(n, [sys.executable, str(self.script), n, actions[n]]) for n in names]

        monkeypatch.setattr(update_data, "pipeline_steps", steps)

    def records(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def snapshot(self):
        """Bytes and mtime of every file in the live data folders."""
        out = {}
        for folder in (self.soc.parent, self.courses.parent):
            for p in sorted(folder.iterdir()):
                if p.is_file():
                    out[str(p)] = (p.read_bytes(), p.stat().st_mtime_ns)
        return out


@pytest.fixture
def deploy(tmp_path, monkeypatch):
    root = tmp_path / "countsfor"
    dump(root / "backend" / "data" / "soc.json", LIVE_SOC)
    dump(root / "frontend" / "data" / "courses.json", LIVE_CATALOG)
    for name in PATH_VARS + ("CF_STAGING_DIR", "CF_MIN_SECTION_RATIO", "CF_MIN_CATALOG_RATIO"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CF_DEPLOY_ROOT", str(root))
    d = Deploy(root, tmp_path)
    monkeypatch.setenv("FAKE_LOG", str(d.log))
    return d


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------- Success ----------

def test_success_publishes_the_staged_files(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG, buckets=BUCKETS)
    old_soc, old_courses = deploy.soc.read_bytes(), deploy.courses.read_bytes()

    assert update_data.main(["--skip-tests"]) == 0

    assert read_json(deploy.soc) == NEW_SOC
    assert read_json(deploy.courses) == NEW_CATALOG
    assert read_json(deploy.buckets) == BUCKETS
    assert not (deploy.buckets.parent / "requirement_buckets.json.prev").exists()
    assert not (deploy.staging / "requirement_buckets.json").exists()
    assert (deploy.soc.parent / "soc.json.prev").read_bytes() == old_soc
    assert (deploy.courses.parent / "courses.json.prev").read_bytes() == old_courses
    assert gzip.decompress(deploy.gz.read_bytes()) == deploy.courses.read_bytes()
    # no temp files left beside the live files, staged copies cleaned up
    assert not [p for p in deploy.courses.parent.iterdir() if p.name.endswith(".tmp")]
    assert not [p for p in deploy.soc.parent.iterdir() if p.name.endswith(".tmp")]
    assert not (deploy.staging / "soc.json").exists()
    assert not (deploy.staging / "courses.json").exists()
    if os.name == "posix":
        for p in (deploy.soc, deploy.courses, deploy.gz, deploy.buckets):
            assert (p.stat().st_mode & 0o777) == 0o644


def test_unchanged_bucket_list_is_not_rewritten(deploy, monkeypatch):
    old = 1_600_000_000
    dump(deploy.buckets, BUCKETS)
    os.utime(deploy.buckets, (old, old))
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG, buckets=BUCKETS)
    assert update_data.main(["--skip-tests"]) == 0
    assert deploy.buckets.stat().st_mtime == old

    changed = {**BUCKETS, "BA": ["GenEd---University Core---Free Electives"]}
    deploy.fake_steps(monkeypatch, soc=make_soc("2026-11-03T12:00:00+00:00", LIVE_COUNTS), buckets=changed)
    assert update_data.main(["--skip-tests"]) == 0
    assert read_json(deploy.buckets) == changed


def test_a_run_that_writes_no_bucket_list_leaves_the_live_one(deploy, monkeypatch, capsys):
    dump(deploy.buckets, BUCKETS)
    before = deploy.buckets.read_bytes()
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    assert update_data.main(["--skip-tests"]) == 0
    assert deploy.buckets.read_bytes() == before
    assert "requirement_buckets.json: not written by this run" in capsys.readouterr().out


def test_steps_run_in_order_on_seeded_staging_copies(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    assert update_data.main(["--skip-tests"]) == 0

    records = deploy.records()
    assert [r["name"] for r in records] == [
        "scrape_soc", "reconcile_offerings", "apply_mapping_overlays", "validate_soc_coverage"]
    staging = str(deploy.staging.resolve())
    for r in records:
        env = r["env"]
        assert env["SOC_OUTPUT_PATH"] == env["SOC_JSON_PATH"] == str(deploy.staging.resolve() / "soc.json")
        assert env["COURSES_JSON_PATH"] == env["CATALOG_PATHS"] == str(deploy.staging.resolve() / "courses.json")
        assert all(env[k].startswith(staging) for k in PATH_VARS[:4])
        assert env["MAPPING_OVERLAYS_PATH"] == str(deploy.root.resolve() / "backend" / "data" / "mapping_overlays.json")
    # the scrape starts from a copy of the live soc.json (old semesters carry forward)
    assert json.loads(records[0]["staged_soc_at_start"]) == LIVE_SOC


def test_environment_paths_cannot_point_steps_at_live_files(deploy, monkeypatch):
    monkeypatch.setenv("SOC_OUTPUT_PATH", str(deploy.soc))
    monkeypatch.setenv("COURSES_JSON_PATH", str(deploy.courses))
    monkeypatch.setenv("CATALOG_PATHS", str(deploy.courses))
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    assert update_data.main(["--skip-tests"]) == 0
    for r in deploy.records():
        assert r["env"]["SOC_OUTPUT_PATH"] != str(deploy.soc)
        assert r["env"]["CATALOG_PATHS"] != str(deploy.courses)


def test_unchanged_catalog_is_not_rewritten_but_soc_is_promoted(deploy, monkeypatch):
    old = 1_600_000_000
    os.utime(deploy.courses, (old, old))
    deploy.fake_steps(monkeypatch, soc=NEW_SOC)  # reconcile leaves the catalog as it was

    assert update_data.main(["--skip-tests"]) == 0

    assert deploy.courses.stat().st_mtime == old
    assert read_json(deploy.courses) == LIVE_CATALOG
    assert not (deploy.courses.parent / "courses.json.prev").exists()
    assert read_json(deploy.soc) == NEW_SOC
    assert (deploy.soc.parent / "soc.json.prev").exists()
    # the .gz did not exist yet, so it is written from the unchanged catalog
    assert gzip.decompress(deploy.gz.read_bytes()) == deploy.courses.read_bytes()

    # a second run leaves both the catalog and its .gz alone
    os.utime(deploy.gz, (old, old))
    deploy.fake_steps(monkeypatch, soc=make_soc("2026-11-03T12:00:00+00:00", LIVE_COUNTS))
    assert update_data.main(["--skip-tests"]) == 0
    assert deploy.courses.stat().st_mtime == old
    assert deploy.gz.stat().st_mtime == old
    assert read_json(deploy.soc)["metadata"]["last_scrape"] == "2026-11-03T12:00:00+00:00"


def test_stale_gz_is_rewritten_when_catalog_is_unchanged(deploy, monkeypatch):
    # a deploy shipped a new courses.json but left yesterday's .gz behind
    deploy.gz.write_bytes(gzip.compress(b'{"courses": []}'))
    deploy.fake_steps(monkeypatch)
    assert update_data.main(["--skip-tests", "--no-scrape"]) == 0
    assert gzip.decompress(deploy.gz.read_bytes()) == deploy.courses.read_bytes()


def test_no_scrape_skips_the_scrape_and_keeps_soc(deploy, monkeypatch):
    soc_before = deploy.soc.stat().st_mtime_ns
    deploy.fake_steps(monkeypatch, catalog=NEW_CATALOG)

    assert update_data.main(["--skip-tests", "--no-scrape"]) == 0

    assert [r["name"] for r in deploy.records()] == [
        "reconcile_offerings", "apply_mapping_overlays", "validate_soc_coverage"]
    assert deploy.soc.stat().st_mtime_ns == soc_before
    assert not (deploy.soc.parent / "soc.json.prev").exists()
    assert read_json(deploy.courses) == NEW_CATALOG


def test_real_pipeline_steps_list():
    names = [n for n, _ in update_data.pipeline_steps(False)]
    assert names == ["scrape_soc", "reconcile_offerings", "apply_mapping_overlays", "validate_soc_coverage"]
    assert [n for n, _ in update_data.pipeline_steps(True)] == names[1:]
    for _, argv in update_data.pipeline_steps(False):
        assert Path(argv[1]).is_file()
    for path in update_data.test_gate_command()[3:5]:
        assert Path(path).is_file()


# ---------- Failures leave the live files untouched ----------

@pytest.mark.parametrize("step", [
    "scrape_soc", "reconcile_offerings", "apply_mapping_overlays", "validate_soc_coverage"])
def test_failing_step_leaves_live_files_untouched(deploy, monkeypatch, step):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG, fail=step)
    before = deploy.snapshot()
    assert update_data.main(["--skip-tests"]) == 1
    assert deploy.snapshot() == before
    names = [r["name"] for r in deploy.records()]
    assert names[-1] == step  # stops at the first failure


def test_failing_parser_tests_stop_before_the_pipeline(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    monkeypatch.setattr(update_data, "test_gate_command",
                        lambda: [sys.executable, "-c", "import sys; sys.exit(1)"])
    before = deploy.snapshot()
    assert update_data.main([]) == 1
    assert deploy.snapshot() == before
    assert deploy.records() == []


def test_passing_parser_tests_let_the_pipeline_run(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    monkeypatch.setattr(update_data, "test_gate_command", lambda: [sys.executable, "-c", "pass"])
    assert update_data.main([]) == 0
    assert read_json(deploy.soc) == NEW_SOC


def _drop(courses, code):
    return {"_meta": {}, "courses": [c for c in courses["courses"] if c["course_code"] != code]}


GATE_CASES = {
    "soc does not parse": dict(soc="{ not json"),
    "catalog does not parse": dict(soc=NEW_SOC, catalog="[1, 2"),
    "soc is not a soc file": dict(soc={"metadata": {"last_scrape": "x"}}),
    "no last_scrape": dict(soc=make_soc(None, LIVE_COUNTS)),
    "scrape did not write": dict(soc=LIVE_SOC),
    "campus lost sections": dict(soc=make_soc("2026-11-02T12:00:00+00:00", {
        "F26": {"Pittsburgh": 100, "Qatar": 48}, "M25": {"Pittsburgh": 10, "Qatar": 4}})),
    "campus vanished": dict(soc=make_soc("2026-11-02T12:00:00+00:00", {
        "F26": {"Pittsburgh": 100}, "M25": {"Pittsburgh": 10, "Qatar": 4}})),
    "catalog lost one row": dict(soc=NEW_SOC, catalog=_drop(NEW_CATALOG, "15-120")),
    "catalog shrank": dict(soc=NEW_SOC, catalog={"courses": LIVE_CATALOG["courses"][:30]}),
    "bucket list does not parse": dict(soc=NEW_SOC, catalog=NEW_CATALOG, buckets="{ not json"),
    "bucket list is not a list per program": dict(soc=NEW_SOC, catalog=NEW_CATALOG,
                                                  buckets={"CS": "GenEd---Science and Engineering"}),
}


@pytest.mark.parametrize("case", list(GATE_CASES))
def test_failing_gate_leaves_live_files_untouched(deploy, monkeypatch, capsys, case):
    deploy.fake_steps(monkeypatch, **GATE_CASES[case])
    before = deploy.snapshot()
    assert update_data.main(["--skip-tests"]) == 1
    assert deploy.snapshot() == before
    assert not deploy.gz.exists()
    assert not deploy.buckets.exists()
    assert "GATE FAILED" in capsys.readouterr().out


def test_section_ratio_is_configurable(deploy, monkeypatch):
    monkeypatch.setenv("CF_MIN_SECTION_RATIO", "0.9")
    deploy.fake_steps(monkeypatch, **GATE_CASES["campus lost sections"])
    assert update_data.main(["--skip-tests"]) == 0


def test_corrupt_live_soc_stops_before_scraping(deploy, monkeypatch):
    dump(deploy.soc, "{ truncated")
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    before = deploy.snapshot()
    assert update_data.main(["--skip-tests"]) == 1
    assert deploy.snapshot() == before
    assert deploy.records() == []


def test_no_scrape_needs_a_live_soc(deploy, monkeypatch):
    deploy.soc.unlink()
    deploy.fake_steps(monkeypatch)
    assert update_data.main(["--skip-tests", "--no-scrape"]) == 1
    assert deploy.records() == []


def test_first_scrape_without_live_soc_publishes(deploy, monkeypatch):
    deploy.soc.unlink()
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    assert update_data.main(["--skip-tests"]) == 0
    assert read_json(deploy.soc) == NEW_SOC
    assert not (deploy.soc.parent / "soc.json.prev").exists()


def test_bad_ratio_setting_fails(deploy, monkeypatch):
    monkeypatch.setenv("CF_MIN_CATALOG_RATIO", "lots")
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    before = deploy.snapshot()
    assert update_data.main(["--skip-tests"]) == 1
    assert deploy.snapshot() == before


# ---------- Gate details ----------

def gates(new_soc=NEW_SOC, new_catalog=NEW_CATALOG, live_soc=LIVE_SOC, live_catalog=LIVE_CATALOG,
          scraped=True):
    return update_data.check_gates(new_soc, new_catalog, live_soc, live_catalog, scraped=scraped,
                                   section_ratio=0.98, catalog_ratio=0.95)


def test_gates_pass_on_good_data():
    assert gates() == []


def test_gates_compare_only_semesters_in_both_files():
    new = make_soc("2026-11-02T12:00:00+00:00", {"F26": LIVE_COUNTS["F26"], "S27": {"Qatar": 1}})
    assert gates(new_soc=new) == []


def test_section_gate_threshold_is_inclusive():
    exactly = make_soc("2026-11-02T12:00:00+00:00", {"F26": {"Pittsburgh": 98, "Qatar": 50}})
    assert gates(new_soc=exactly) == []
    below = make_soc("2026-11-02T12:00:00+00:00", {"F26": {"Pittsburgh": 97, "Qatar": 50}})
    [problem] = gates(new_soc=below)
    assert problem.startswith("F26 Pittsburgh: 97 sections, down from 100")


def test_catalog_gates_report_count_and_lost_codes():
    problems = gates(new_catalog={"courses": LIVE_CATALOG["courses"][:30]})
    assert any("30 courses, down from 40" in p for p in problems)
    assert any("lost 10 course row(s)" in p for p in problems)


def test_catalog_codes_are_compared_normalized():
    live = {"courses": [{"course_code": "15122"}, {"course_code": "82101.0"}]}
    new = {"courses": [{"course_code": "15-122"}, {"course_code": "82-101"}]}
    assert gates(new_catalog=new, live_catalog=live) == []


def test_unchanged_last_scrape_is_fine_without_a_scrape():
    assert gates(new_soc=LIVE_SOC, scraped=False) == []
    assert any("did not write" in p for p in gates(new_soc=LIVE_SOC, scraped=True))


def test_bucket_list_gate():
    assert update_data.check_buckets(BUCKETS) == []
    assert update_data.check_buckets({}) != []
    assert update_data.check_buckets(["GenEd---A"]) != []
    assert update_data.check_buckets({"CS": ["GenEd---A", ""]}) == [
        "new requirement_buckets.json: CS is not a list of bucket paths"]


def test_gzip_is_deterministic():
    data = json.dumps(NEW_CATALOG).encode()
    assert update_data.gzip_bytes(data) == update_data.gzip_bytes(data)
    assert gzip.decompress(update_data.gzip_bytes(data)) == data


# ---------- Lock ----------

def test_lock_held_exits_75(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    holder = update_data.Lock(deploy.root / "backend" / "var" / "update.lock")
    assert holder.acquire()
    try:
        before = deploy.snapshot()
        assert update_data.main(["--skip-tests"]) == update_data.EXIT_LOCKED == 75
        assert deploy.snapshot() == before
        assert deploy.records() == []
    finally:
        holder.release()


def test_lock_is_released_after_a_run(deploy, monkeypatch):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG, fail="reconcile_offerings")
    assert update_data.main(["--skip-tests"]) == 1
    lock = update_data.Lock(deploy.root / "backend" / "var" / "update.lock")
    assert lock.acquire()
    lock.release()


def test_unopenable_lock_file_fails_with_a_clear_message(deploy, monkeypatch, capsys):
    """A lock file the run cannot open (left owned by root by a run as root) is
    exit 1 with an explanation, not a traceback, and touches nothing."""
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    lock_path = deploy.root / "backend" / "var" / "update.lock"
    real_open = open

    def guarded_open(path, *args, **kwargs):
        if Path(path) == lock_path:
            raise PermissionError(13, "Permission denied", str(path))
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", guarded_open)
    before = deploy.snapshot()
    assert update_data.main(["--skip-tests"]) == update_data.EXIT_FAILED == 1
    monkeypatch.undo()
    out = capsys.readouterr().out
    assert "cannot open the lock file" in out and "Permission denied" in out
    assert "sudo chown -R countsfor:countsfor" in out
    assert "Traceback" not in out
    assert deploy.snapshot() == before
    assert deploy.records() == []


def test_log_lines_are_timestamped(deploy, monkeypatch, capsys):
    deploy.fake_steps(monkeypatch, soc=NEW_SOC, catalog=NEW_CATALOG)
    assert update_data.main(["--skip-tests"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines
    for line in lines:
        stamp = line.split(" ", 1)[0]
        assert len(stamp) >= 19 and stamp[4] == "-" and stamp[10] == "T", line
    assert any("[reconcile_offerings] fake reconcile_offerings" in line for line in lines)


# ---------- The real steps on the repo's data ----------

REAL_FILES = ("backend/data/soc.json", "backend/data/mapping_overlays.json",
              "frontend/data/courses.json")


@pytest.mark.skipif(not all((REPO_ROOT / f).exists() for f in REAL_FILES),
                    reason="needs the repo's soc.json, overlays and catalog")
def test_real_steps_on_repo_data_with_a_fake_scrape(deploy, monkeypatch):
    """Parser tests, reconcile, overlays and validation as cron runs them; only
    the network scrape is faked (it re-stamps the staged soc.json)."""
    for rel in REAL_FILES:
        (deploy.root / rel).write_bytes((REPO_ROOT / rel).read_bytes())
    restamp = deploy.tmp / "restamp.py"
    restamp.write_text(
        "import json, os\n"
        "p = os.environ['SOC_OUTPUT_PATH']\n"
        "d = json.load(open(p, encoding='utf-8'))\n"
        "d['metadata']['last_scrape'] = '2099-01-01T00:00:00+00:00'\n"
        "json.dump(d, open(p, 'w', encoding='utf-8'), indent=2)\n",
        encoding="utf-8")
    real = update_data.pipeline_steps

    def steps(no_scrape):
        out = real(no_scrape)
        return [(n, [sys.executable, str(restamp)] if n == "scrape_soc" else argv) for n, argv in out]

    monkeypatch.setattr(update_data, "pipeline_steps", steps)
    live_catalog = deploy.courses.read_bytes()
    repo_stat = {rel: (REPO_ROOT / rel).stat().st_mtime_ns for rel in REAL_FILES}

    assert update_data.main([]) == 0

    assert read_json(deploy.soc)["metadata"]["last_scrape"] == "2099-01-01T00:00:00+00:00"
    assert gzip.decompress(deploy.gz.read_bytes()) == deploy.courses.read_bytes()
    buckets = read_json(deploy.buckets)
    assert update_data.check_buckets(buckets) == []
    assert set(buckets) == {"CS", "IS", "BA", "BS", "AI"}
    if deploy.courses.read_bytes() == live_catalog:
        assert not (deploy.courses.parent / "courses.json.prev").exists()
    # the checkout's own data files are not touched
    assert {rel: (REPO_ROOT / rel).stat().st_mtime_ns for rel in REAL_FILES} == repo_stat
