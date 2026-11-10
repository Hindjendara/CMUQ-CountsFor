"""Update admin course edits saved in the old whole-list shape (README 15.8 step 8).

    python -m backend.migrate_override_paths [--baseline FILE] [--apply]
        [--renames FILE] [--catalog FILE]

Run from the folder that holds the backend package, with the API's environment
(DATABASE_URL). Without --apply it is a dry run: it prints what it would change
and writes nothing.

Until November 10, 2026 the course editor saved the whole "counts for" list of
every program of a course (a list value per program), in the bucket names of the
time. The browser now applies such a list to its own program only, but it keeps
the old names (ghost buckets) and freezes the program. For every list value:

  with --baseline FILE (frontend/data/courses.json from before the renames, for
  example `git show 174e856:frontend/data/courses.json > /tmp/courses-2026-11-09.json`):
    the list and that course's baseline rows are both renamed with
    backend/data/requirement_path_renames.json, and only their difference is kept,
    as {"add": [...], "remove": [...]}. A program the old editor saved without a
    change goes back to the catalog, so it follows the daily updates again.
  without it:
    the paths are renamed in place and the list is kept. Open the course in the
    course editor to check it; saving there turns it into a change.

Old "earlier" flags are dropped (they are no longer used). Changes already in the
new shape are left alone. Every row is reported with each program before and
after, and every path that is still not in today's catalog. With --apply the rows
are written, a row left with no edit at all is deleted, and each course gets one
admin_audit_events row (action course.migrate, actor "system: migrate_override_paths",
details {"before", "after"}).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TextIO

REPO = Path(__file__).resolve().parents[1]
DEFAULT_RENAMES = REPO / "backend" / "data" / "requirement_path_renames.json"
DEFAULT_CATALOG = REPO / "frontend" / "data" / "courses.json"
ACTOR = "system: migrate_override_paths"
GENED_ROOT = "GenEd"


def _code(raw) -> str:
    s = str(raw or "").strip()
    if s.endswith(".0"):
        s = s[:-2]
    digits = s.replace("-", "")
    return f"{digits[:2]}-{digits[2:]}" if len(digits) == 5 and digits.isdigit() else s


def load_renames(path: Path) -> tuple[dict, dict]:
    """(programs: {prog: {old: new}}, per_course: {prog: {old: {code: new}}})."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    programs = {p: m for p, m in (data.get("programs") or {}).items() if isinstance(m, dict)}
    per_course = {p: m for p, m in (data.get("per_course") or {}).items() if isinstance(m, dict)}
    return programs, per_course


def load_catalog(path: Path) -> dict[str, dict[str, list[str]]]:
    """{course code: {program: [paths]}} from a courses.json file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, dict[str, list[str]]] = {}
    for course in data.get("courses") or []:
        rows = {}
        for prog, reqs in (course.get("requirements") or {}).items():
            rows[prog] = [r["requirement"] for r in reqs or [] if isinstance(r, dict) and r.get("requirement")]
        out[_code(course.get("course_code"))] = rows
    return out


def _dedupe(paths) -> list[str]:
    return list(dict.fromkeys(p for p in paths if p))


def rename(program: str, path: str, code: str, programs: dict, per_course: dict) -> str:
    special = (per_course.get(program) or {}).get(path)
    if isinstance(special, dict) and code in special:
        return special[code]
    return (programs.get(program) or {}).get(path, path)


def _row(program: str, path: str) -> dict:
    return {"requirement": path, "type": path.split("---", 1)[0] == GENED_ROOT, "major": program}


def migrate_value(program: str, code: str, value: list, programs: dict, per_course: dict,
                  baseline: dict | None):
    """One old list -> its new value: a change, a renamed list, or None (back to the catalog)."""
    paths = [e.get("requirement") if isinstance(e, dict) else e for e in value]
    renamed = _dedupe(rename(program, p, code, programs, per_course) for p in paths if isinstance(p, str))
    if baseline is None:
        return [_row(program, p) for p in renamed]
    base = _dedupe(rename(program, p, code, programs, per_course) for p in baseline.get(code, {}).get(program, []))
    add = [p for p in renamed if p not in base]
    remove = [p for p in base if p not in renamed]
    if not add and not remove:
        return None
    return {"add": [_row(program, p) for p in add], "remove": remove}


def migrate_requirements(code: str, stored: dict, programs: dict, per_course: dict,
                         baseline: dict | None) -> dict:
    """The whole stored map with every list value migrated; other values unchanged."""
    after = {}
    for key, value in stored.items():
        if isinstance(value, list):
            new = migrate_value(key, code, value, programs, per_course, baseline)
            if new is not None:
                after[key] = new
        else:
            after[key] = value
    return after


def _paths_of(value) -> list[str]:
    if isinstance(value, list):
        return [r.get("requirement") for r in value if isinstance(r, dict) and r.get("requirement")]
    if isinstance(value, dict):
        added = [r.get("requirement") if isinstance(r, dict) else r for r in value.get("add") or []]
        return [p for p in added + list(value.get("remove") or []) if isinstance(p, str)]
    return []


def _describe(value) -> str:
    if value is None:
        return "back to the catalog"
    if isinstance(value, list):
        return f"whole list of {len(value)}"
    return f"add {len(value.get('add') or [])}, remove {len(value.get('remove') or [])}"


def run(*, renames: Path = DEFAULT_RENAMES, catalog: Path = DEFAULT_CATALOG, baseline: Path | None = None,
        apply: bool = False, out: TextIO | None = None) -> dict:
    """Migrate (or, without apply, report) every course edit with an old list. Needs an app context."""
    out = out or sys.stdout
    from .db import db
    from .models import AdminAuditEvent, CourseOverride

    programs, per_course = load_renames(renames)
    today = load_catalog(catalog)
    known: dict[str, set[str]] = {}
    for rows in today.values():
        for prog, paths in rows.items():
            known.setdefault(prog, set()).update(paths)
    base = load_catalog(baseline) if baseline else None

    summary = {"rows": 0, "changed": 0, "deleted": 0, "unknown_paths": 0}
    rows = db.session.query(CourseOverride).filter(CourseOverride.requirements.isnot(None)) \
        .order_by(CourseOverride.course_code).all()
    for row in rows:
        try:
            stored = json.loads(row.requirements)
        except ValueError:
            continue
        if not isinstance(stored, dict) or not any(isinstance(v, list) for v in stored.values()):
            continue
        summary["rows"] += 1
        code = row.course_code
        after = migrate_requirements(code, stored, programs, per_course, base)
        who = f" by {row.updated_by_email}" if row.updated_by_email else ""
        when = f", saved {row.updated_at:%Y-%m-%d}" if row.updated_at else ""
        print(f"{code}{' (added here)' if row.is_new else ''}{when}{who}", file=out)
        for key in dict.fromkeys([*stored, *after]):
            if key in after and after[key] == stored.get(key):
                continue
            print(f"  {key}: {_describe(stored.get(key))} -> {_describe(after.get(key))}", file=out)
            new = after.get(key)
            if isinstance(new, dict):
                for r in new.get("add") or []:
                    print(f"      add     {r['requirement']}", file=out)
                for p in new.get("remove") or []:
                    print(f"      remove  {p}", file=out)
        unknown = sorted({(k, p) for k, v in after.items() if not k.startswith("MINOR:")
                          for p in _paths_of(v) if p not in known.get(k, set())})
        for prog, path in unknown:
            print(f"  not in today's catalog: {prog} {path}", file=out)
        summary["unknown_paths"] += len(unknown)
        if after == stored:
            continue
        summary["changed"] += 1
        if not apply:
            continue
        row.requirements = json.dumps(after) if after else None
        deleted = not row.is_new and not row.fields and not after and not row.archived
        if deleted:
            db.session.delete(row)
            summary["deleted"] += 1
        db.session.add(AdminAuditEvent(
            actor_id=None, actor_email=ACTOR, actor_name="Path migration", action="course.migrate", target=code,
            details=json.dumps({"before": stored, "after": after or None, **({"deleted": True} if deleted else {})}),
        ))
    if apply:
        db.session.commit()
    verb = "Updated" if apply else "Would update"
    deleted = summary["deleted"]
    gone = f", deleting {deleted} left with no edit" if deleted else ""
    print(f"{summary['rows']} course edit(s) with old lists. {verb} {summary['changed']}{gone}."
          f" Paths not in today's catalog: {summary['unknown_paths']}.", file=out)
    if not apply:
        print("Dry run: nothing was written. Run again with --apply to write these changes.", file=out)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Update admin course edits saved in the old whole-list shape.")
    parser.add_argument("--baseline", type=Path, help="courses.json from before the 2026-11-10 renames")
    parser.add_argument("--renames", type=Path, default=DEFAULT_RENAMES)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG, help="today's courses.json")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args(argv)

    from .app import create_app
    app = create_app(bootstrap_db=False)
    with app.app_context():
        run(renames=args.renames, catalog=args.catalog, baseline=args.baseline, apply=args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
