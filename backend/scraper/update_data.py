#!/usr/bin/env python3
"""Update the live course data in place: the server's daily cron job.

Replaces the old GitHub Actions scrape workflow. Cron runs it through run_scrape.sh:

  1. Lock backend/var/update.lock (exit 75 if another update holds it).
  2. Gate: the SOC parser tests, as the old workflow ran them (--skip-tests skips).
  3. Stage: copy the live soc.json and courses.json into CF_STAGING_DIR.
     scrape_soc.py carries old semesters forward from the file it overwrites,
     so it must start from a copy of the live soc.json. apply_mapping_overlays.py
     writes requirement_buckets.json (the admin course editor's bucket list)
     next to the staged catalog.
  4. Run the pipeline on the staged copies, stopping at the first failure:
     scrape_soc.py -> reconcile_offerings.py -> apply_mapping_overlays.py
     -> validate_soc_coverage.py. --no-scrape skips the scrape (a rebuild after
     a deploy, from the live soc.json).
  5. Gates on the result: both files parse; soc.json has metadata.last_scrape
     (a new one, when this run scraped); for every semester in both the live
     and the new soc.json, each campus keeps at least CF_MIN_SECTION_RATIO of
     its sections; the catalog keeps at least CF_MIN_CATALOG_RATIO of its rows
     and never loses a course code; requirement_buckets.json, when the run
     wrote one, is {program: [bucket paths]}.
  6. Promote with os.replace, keeping <file>.prev copies for rollback:
     courses.json and courses.json.gz (gzip -9, served by Apache to clients
     that accept gzip), requirement_buckets.json (no .prev: it is rebuilt from
     the catalog on every run), then soc.json last. A file that is unchanged
     byte for byte is not touched (its mtime and ETag stay), but soc.json is
     still promoted so the admin overview shows the last successful scrape.

Any failure exits non-zero and leaves the live files untouched; the staged
files stay in CF_STAGING_DIR for inspection until the next run.

Paths: the live files are <CF_DEPLOY_ROOT>/backend/data/soc.json and
<CF_DEPLOY_ROOT>/frontend/data/courses.json (CF_DEPLOY_ROOT defaults to the
folder that holds backend/, so the same script works in a checkout and at
/var/www/html/countsfor). Each step gets SOC_OUTPUT_PATH, SOC_JSON_PATH,
COURSES_JSON_PATH and CATALOG_PATHS pointing at the staged copies, whatever
the environment says; those variables only matter when a script is run by hand.

The cache-busting cf-build bump (scripts/bump_cf_build.py) is not part of this
job: Apache revalidates the data with no-cache + ETag, and the bump stays a
release tool.
"""
from __future__ import annotations

import argparse
import filecmp
import gzip
import json
import os
import shutil
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path

SCRAPER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRAPER_DIR))

from soc_parse import normalize_course_code  # noqa: E402

CODE_ROOT = SCRAPER_DIR.parent.parent

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_LOCKED = 75  # EX_TEMPFAIL: another update is running, try again later

DEFAULT_MIN_SECTION_RATIO = 0.98
DEFAULT_MIN_CATALOG_RATIO = 0.95

TEST_FILES = ("test_scrape_soc.py", "test_soc_parse.py")
# The admin course editor's bucket list, written by apply_mapping_overlays.py
# next to the catalog it updates (its REQUIREMENT_BUCKETS_NAME).
BUCKETS_NAME = "requirement_buckets.json"
STAGED_NAMES = ("soc.json", "courses.json", BUCKETS_NAME)


# ---------- Logging ----------

def log(message: str) -> None:
    """One timestamped line on stdout (cron appends it to the scrape log)."""
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    for line in str(message).splitlines() or [""]:
        print(f"{stamp} {line}", flush=True)


# ---------- Configuration ----------

class Paths:
    """Live, staged and lock file locations under one deploy root."""

    def __init__(self, root: Path, staging: Path):
        self.root = root
        self.live_soc = root / "backend" / "data" / "soc.json"
        self.live_courses = root / "frontend" / "data" / "courses.json"
        self.live_gz = self.live_courses.with_name("courses.json.gz")
        self.overlays = root / "backend" / "data" / "mapping_overlays.json"
        self.lock = root / "backend" / "var" / "update.lock"
        self.live_buckets = self.live_courses.with_name(BUCKETS_NAME)
        self.staging = staging
        self.staged_soc = staging / "soc.json"
        self.staged_courses = staging / "courses.json"
        self.staged_buckets = staging / BUCKETS_NAME

    @classmethod
    def from_env(cls) -> "Paths":
        root = Path(os.environ.get("CF_DEPLOY_ROOT") or CODE_ROOT).resolve()
        staging = os.environ.get("CF_STAGING_DIR") or (root / "backend" / "var" / "staging")
        return cls(root, Path(staging).resolve())


def _ratio(raw: str | None, default: float, name: str) -> float:
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        raise SystemExit(f"{name} must be a number between 0 and 1, got {raw!r}")
    if not 0 <= value <= 1:
        raise SystemExit(f"{name} must be between 0 and 1, got {raw!r}")
    return value


def min_section_ratio() -> float:
    return _ratio(os.environ.get("CF_MIN_SECTION_RATIO"), DEFAULT_MIN_SECTION_RATIO,
                  "CF_MIN_SECTION_RATIO")


def min_catalog_ratio() -> float:
    return _ratio(os.environ.get("CF_MIN_CATALOG_RATIO"), DEFAULT_MIN_CATALOG_RATIO,
                  "CF_MIN_CATALOG_RATIO")


# ---------- Lock ----------

class LockError(Exception):
    """The lock file cannot be created or opened (not: another run holds it)."""


class Lock:
    """An exclusive, non-blocking lock on a file (flock on POSIX, msvcrt on Windows).

    The OS drops it when the process exits, so a crashed run never leaves a
    stale lock behind.
    """

    def __init__(self, path: Path):
        self.path = path
        self._fh = None

    def acquire(self) -> bool:
        """True when locked, False when another run holds the lock. Raises
        LockError when the file cannot be opened at all, typically because a run
        as another user (root) left backend/var/ or the lock file owned by it."""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fh = open(self.path, "a+", encoding="utf-8")
        except OSError as exc:
            raise LockError(f"cannot open the lock file {self.path}: {exc}") from exc
        try:
            if os.name == "nt":
                import msvcrt
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        self._fh = fh
        return True

    def release(self) -> None:
        if self._fh is None:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self._fh.seek(0)
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
        finally:
            self._fh.close()
            self._fh = None


# ---------- Running the steps ----------

def test_gate_command() -> list[str]:
    """The SOC parser tests, run as a gate before scraping."""
    tests = [str(SCRAPER_DIR / "tests" / name) for name in TEST_FILES]
    return [sys.executable, "-m", "pytest", *tests, "-q", "-p", "no:cacheprovider"]


def pipeline_steps(no_scrape: bool) -> list[tuple[str, list[str]]]:
    """(name, argv) for each pipeline step, in order."""
    names = ["scrape_soc", "reconcile_offerings", "apply_mapping_overlays", "validate_soc_coverage"]
    if no_scrape:
        names.remove("scrape_soc")
    return [(name, [sys.executable, str(SCRAPER_DIR / f"{name}.py")]) for name in names]


def step_env(paths: Paths) -> dict[str, str]:
    """The environment for every step: the staged copies replace the live files."""
    env = dict(os.environ)
    env.setdefault("MAPPING_OVERLAYS_PATH", str(paths.overlays))
    env.update({
        "SOC_OUTPUT_PATH": str(paths.staged_soc),
        "SOC_JSON_PATH": str(paths.staged_soc),
        "COURSES_JSON_PATH": str(paths.staged_courses),
        "CATALOG_PATHS": str(paths.staged_courses),
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    })
    return env


def run_step(name: str, argv: list[str], env: dict[str, str], cwd: Path) -> int:
    """Run one step, logging each line of its output under the step name."""
    log(f"[{name}] start")
    proc = subprocess.Popen(
        argv, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        log(f"[{name}] {line.rstrip()}")
    code = proc.wait()
    log(f"[{name}] {'ok' if code == 0 else f'FAILED (exit {code})'}")
    return code


# ---------- Gates ----------

class GateError(Exception):
    pass


def load_json_file(path: Path, label: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise GateError(f"{label}: {path} is missing")
    except (OSError, ValueError) as exc:
        raise GateError(f"{label}: {path} does not parse: {exc}")


def soc_semesters(soc, label: str) -> dict:
    if not isinstance(soc, dict) or not isinstance(soc.get("semesters"), dict):
        raise GateError(f"{label}: not a soc.json (no 'semesters' object)")
    return soc["semesters"]


def catalog_rows(catalog, label: str) -> list:
    rows = catalog.get("courses") if isinstance(catalog, dict) else catalog
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise GateError(f"{label}: not a course catalog (expected a list of course rows)")
    return rows


def check_buckets(buckets, label: str = "new requirement_buckets.json") -> list[str]:
    """Reasons not to publish a bucket list: it must be {program: [paths]}."""
    if not isinstance(buckets, dict) or not buckets:
        return [f"{label}: expected an object of programs"]
    bad = sorted(str(p) for p, paths in buckets.items()
                 if not isinstance(paths, list) or not all(isinstance(x, str) and x for x in paths))
    return [f"{label}: {p} is not a list of bucket paths" for p in bad]


def section_counts(soc, label: str) -> dict[tuple[str, str], int]:
    """{(semester, campus): number of sections} over every course in soc.json."""
    counts: dict[tuple[str, str], int] = {}
    for sem, data in soc_semesters(soc, label).items():
        for course in (data or {}).get("courses") or []:
            for section in course.get("sections") or []:
                campus = (section or {}).get("campus") or "(no campus)"
                counts[(sem, campus)] = counts.get((sem, campus), 0) + 1
    return counts


def course_codes(rows: list) -> set[str]:
    codes = set()
    for row in rows:
        code = normalize_course_code(row.get("course_code"))
        if code:
            codes.add(code)
    return codes


def check_gates(new_soc, new_catalog, live_soc, live_catalog, *, scraped: bool,
                section_ratio: float, catalog_ratio: float) -> list[str]:
    """Every reason not to publish the staged files (empty: publish).

    live_soc may be None (first run on a server without soc.json).
    """
    problems: list[str] = []

    soc_semesters(new_soc, "new soc.json")
    last = (new_soc.get("metadata") or {}).get("last_scrape")
    if not last:
        problems.append("new soc.json has no metadata.last_scrape")
    elif scraped and live_soc is not None and last == (live_soc.get("metadata") or {}).get("last_scrape"):
        problems.append(f"the scrape did not write the staged soc.json (last_scrape is still {last})")

    if live_soc is not None:
        new_counts = section_counts(new_soc, "new soc.json")
        live_counts = section_counts(live_soc, "live soc.json")
        new_sems = set(soc_semesters(new_soc, "new soc.json"))
        for (sem, campus), before in sorted(live_counts.items()):
            if sem not in new_sems or before == 0:
                continue
            after = new_counts.get((sem, campus), 0)
            if after < section_ratio * before:
                problems.append(
                    f"{sem} {campus}: {after} sections, down from {before} "
                    f"(below {section_ratio:.0%} of the live soc.json)"
                )

    new_rows = catalog_rows(new_catalog, "new courses.json")
    live_rows = catalog_rows(live_catalog, "live courses.json")
    if len(new_rows) < catalog_ratio * len(live_rows):
        problems.append(
            f"courses.json has {len(new_rows)} courses, down from {len(live_rows)} "
            f"(below {catalog_ratio:.0%} of the live catalog)"
        )
    lost = sorted(course_codes(live_rows) - course_codes(new_rows))
    if lost:
        shown = ", ".join(lost[:20]) + (f" and {len(lost) - 20} more" if len(lost) > 20 else "")
        problems.append(f"courses.json lost {len(lost)} course row(s): {shown}")
    return problems


# ---------- Promotion ----------

def _temp_beside(target: Path) -> Path:
    # Ends in .tmp so the Apache vhost refuses to serve it during the swap.
    return target.with_name(f".{target.name}.{os.getpid()}.tmp")


def _write_temp(target: Path, data: bytes) -> Path:
    tmp = _temp_beside(target)
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o644)
    return tmp


def _copy_temp(source: Path, target: Path) -> Path:
    tmp = _temp_beside(target)
    shutil.copyfile(source, tmp)
    os.chmod(tmp, 0o644)
    return tmp


def gzip_bytes(data: bytes) -> bytes:
    """gzip -9 with no name or timestamp, so the same catalog gives the same bytes."""
    return gzip.compress(data, compresslevel=9, mtime=0)


def gz_matches(gz_path: Path, data: bytes) -> bool:
    try:
        with open(gz_path, "rb") as f:
            return gzip.decompress(f.read()) == data
    except (OSError, EOFError, gzip.BadGzipFile):
        return False


def promote(paths: Paths) -> dict[str, bool]:
    """Swap the staged files into place. Every copy and write goes to a temp
    file beside its target before the first os.replace, so a failure there
    leaves the live files as they were. Returns which live files changed.
    """
    courses_changed = not filecmp.cmp(paths.staged_courses, paths.live_courses, shallow=False)
    buckets_changed = paths.staged_buckets.exists() and not (
        paths.live_buckets.exists()
        and filecmp.cmp(paths.staged_buckets, paths.live_buckets, shallow=False))
    soc_changed = not (paths.live_soc.exists()
                       and filecmp.cmp(paths.staged_soc, paths.live_soc, shallow=False))
    new_catalog = paths.staged_courses.read_bytes()
    gz_needed = courses_changed or not gz_matches(paths.live_gz, new_catalog)
    courses_prev = paths.live_courses.with_name("courses.json.prev")
    soc_prev = paths.live_soc.with_name("soc.json.prev")

    # (temp, target) in the order they go live: the .prev backups, the catalog,
    # its .gz right after it, the bucket list, and soc.json last.
    swaps: list[tuple[Path, Path]] = []
    try:
        if courses_changed:
            swaps.append((_copy_temp(paths.live_courses, courses_prev), courses_prev))
        if soc_changed and paths.live_soc.exists():
            swaps.append((_copy_temp(paths.live_soc, soc_prev), soc_prev))
        if courses_changed:
            swaps.append((_copy_temp(paths.staged_courses, paths.live_courses), paths.live_courses))
        if gz_needed:
            swaps.append((_write_temp(paths.live_gz, gzip_bytes(new_catalog)), paths.live_gz))
        if buckets_changed:
            swaps.append((_copy_temp(paths.staged_buckets, paths.live_buckets), paths.live_buckets))
        if soc_changed:
            paths.live_soc.parent.mkdir(parents=True, exist_ok=True)
            swaps.append((_copy_temp(paths.staged_soc, paths.live_soc), paths.live_soc))
    except BaseException:
        for tmp, _ in swaps:
            tmp.unlink(missing_ok=True)
        raise

    for tmp, target in swaps:
        os.replace(tmp, target)

    log("courses.json: " + ("updated, previous copy in courses.json.prev" if courses_changed
                            else "unchanged, not rewritten"))
    log("courses.json.gz: " + ("written" if gz_needed else "up to date"))
    log(f"{BUCKETS_NAME}: " + ("updated" if buckets_changed
                               else "unchanged" if paths.staged_buckets.exists()
                               else "not written by this run, left as it was"))
    log("soc.json: " + ("updated" if soc_changed else "unchanged"))
    return {"courses": courses_changed, "gz": gz_needed, "buckets": buckets_changed, "soc": soc_changed}


# ---------- Main ----------

def stage(paths: Paths) -> None:
    paths.staging.mkdir(parents=True, exist_ok=True)
    for name in STAGED_NAMES:
        (paths.staging / name).unlink(missing_ok=True)
    shutil.copyfile(paths.live_courses, paths.staged_courses)
    if paths.live_soc.exists():
        shutil.copyfile(paths.live_soc, paths.staged_soc)


def update(args, paths: Paths) -> int:
    section_ratio, catalog_ratio = min_section_ratio(), min_catalog_ratio()
    scraped = not args.no_scrape

    if not paths.live_courses.exists():
        log(f"ERROR: the live catalog {paths.live_courses} is missing")
        return EXIT_FAILED
    live_soc = None
    if paths.live_soc.exists():
        try:
            live_soc = load_json_file(paths.live_soc, "live soc.json")
            soc_semesters(live_soc, "live soc.json")
        except GateError as exc:
            # scrape_soc.py would start from nothing and drop the old semesters.
            log(f"ERROR: {exc}")
            return EXIT_FAILED
    elif not scraped:
        log(f"ERROR: --no-scrape needs the live {paths.live_soc}")
        return EXIT_FAILED
    else:
        log(f"WARNING: no live soc.json at {paths.live_soc}; this scrape starts from nothing")

    if args.skip_tests:
        log("Parser tests skipped (--skip-tests)")
    elif run_step("tests", test_gate_command(), step_env(paths), CODE_ROOT) != 0:
        log("FAILED: parser tests; nothing scraped, live files untouched")
        return EXIT_FAILED

    stage(paths)
    log(f"Staged the live files in {paths.staging}")
    env = step_env(paths)
    for name, argv in pipeline_steps(args.no_scrape):
        if run_step(name, argv, env, paths.root) != 0:
            log(f"FAILED: {name}; live files untouched, staged files left in {paths.staging}")
            return EXIT_FAILED

    try:
        new_soc = load_json_file(paths.staged_soc, "new soc.json")
        new_catalog = load_json_file(paths.staged_courses, "new courses.json")
        live_catalog = load_json_file(paths.live_courses, "live courses.json")
        problems = check_gates(new_soc, new_catalog, live_soc, live_catalog, scraped=scraped,
                               section_ratio=section_ratio, catalog_ratio=catalog_ratio)
        if paths.staged_buckets.exists():
            problems += check_buckets(load_json_file(paths.staged_buckets, "new requirement_buckets.json"))
    except GateError as exc:
        problems = [str(exc)]
    if problems:
        for problem in problems:
            log(f"GATE FAILED: {problem}")
        log(f"Not published; live files untouched, staged files left in {paths.staging}")
        return EXIT_FAILED
    log(f"Gates passed (last_scrape {new_soc['metadata']['last_scrape']}, "
        f"{len(catalog_rows(new_catalog, 'new courses.json'))} courses)")

    promote(paths)
    for name in STAGED_NAMES:
        (paths.staging / name).unlink(missing_ok=True)
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--skip-tests", action="store_true", help="skip the SOC parser tests")
    parser.add_argument("--no-scrape", action="store_true",
                        help="rebuild the catalog from the live soc.json without scraping")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")

    paths = Paths.from_env()
    lock = Lock(paths.lock)
    try:
        locked = lock.acquire()
    except LockError as exc:
        log(f"ERROR: {exc}")
        log("Not run. If an earlier run was made as root, give the files back to the "
            f"deploy user: sudo chown -R countsfor:countsfor {paths.lock.parent} "
            f"{paths.live_soc.parent} {paths.live_courses.parent}")
        log(f"Update FAILED (exit {EXIT_FAILED})")
        return EXIT_FAILED
    if not locked:
        log(f"Another update holds {paths.lock}; exiting")
        return EXIT_LOCKED
    started = datetime.now()
    log(f"Update start ({'no scrape' if args.no_scrape else 'scrape'}) in {paths.root}")
    try:
        code = update(args, paths)
    except SystemExit as exc:
        log(f"ERROR: {exc}")
        code = EXIT_FAILED
    except Exception:
        log("ERROR: unexpected failure; live files untouched unless promotion had begun")
        log(traceback.format_exc())
        code = EXIT_FAILED
    finally:
        lock.release()
    minutes = (datetime.now() - started).total_seconds() / 60
    log(f"Update {'done' if code == EXIT_OK else 'FAILED'} in {minutes:.1f} min (exit {code})")
    return code


if __name__ == "__main__":
    sys.exit(main())
