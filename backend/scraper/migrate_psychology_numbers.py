#!/usr/bin/env python3
"""One-time migration: apply the Psychology renumbering list to courses.json by course.

backend/data/psychology_renumbering.json is the department's official list
(see psychology_renumbering.py for its terms: renumbered, reused, retired,
discontinued). The requirement rows that came from the old 2023-24 audits
belong to the course that had the number then, the old course. Their
provenance is the catalog at commit 79e29ec (data/courses.json, before any of
the November 2026 changes), with its requirement paths translated to the
2026-27 bucket names by backend/data/requirement_path_renames.json (programs,
then per_course exceptions), plus the AI general education rows that mirror
those CS rows (README 14.10: AI has the SCS rows CS has, Category 1A in place
of Category 1).

For each renumbered code Y with new number Z:

- The old course's rows go to Z: Y's current rows with a provenance key, and
  the provenance rows Y no longer has (85-414 lost its rows to remove_mappings).
- A retired Y (no course's new number) also gives Z every other requirement
  row it has, fills Z's empty description and prerequisites, and its row is
  deleted, as the daily step does (psychology_renumbering.apply_renumbering).
- A reused Y keeps its row for the course that has the number now, with the
  rows of that course: the provenance rows of its own old number (85-314 for
  85-370), and the rows that did not come from the old audits (the 2026-27
  catalog lists and the H&SS sheet overlays name current numbers, so they
  added them for the number as it is now). The old course's other rows are
  removed from Y. Rule rows ("source": "rule") stay: the rule step recomputes
  them for the number as it is now.

New numbers without a row get one from the list, as the daily step does; a
number the Schedule of Classes lists must already have its row from reconcile.
Discontinued courses ("x") keep their row and rows as past courses (85-426
keeps none: remove_mappings).

The result depends only on the provenance, the list and the catalog's current
rows, so the script can run on a catalog that other changes reshaped (with rule
rows, which the rule step owns), and a second run changes nothing. A moved row
is a plain {requirement, type, major} row: older audit rows count like the rest.

Usage (from the repo root):
  python backend/scraper/migrate_psychology_numbers.py             # dry run: print the summary
  python backend/scraper/migrate_psychology_numbers.py --apply     # write frontend/data/courses.json
  options: --catalog PATH, --provenance PATH (a courses.json; default: git show
  79e29ec:data/courses.json), --soc PATH, --report PATH (Markdown).
"""
from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from json_io import load_json, save_json  # noqa: E402
from pipeline_paths import BACKEND_DATA_DIR, COURSES_JSON, MAPPING_OVERLAYS_JSON, ROOT, SOC_JSON  # noqa: E402
from psychology_renumbering import (  # noqa: E402
    DISCONTINUED,
    NO_OLD_NUMBER,
    Renumbering,
    create_missing_rows,
    default_path,
    is_rule_row,
    load_renumbering,
    merge_requirement_rows,
    requirement_key,
    retire_old_rows,
    retired_codes_named,
)
from soc_parse import clean_soc_title, normalize_course_code, normalize_title  # noqa: E402

PROVENANCE_COMMIT = "79e29ec"
PROVENANCE_FILE = "data/courses.json"  # the layout before frontend/ and backend/
RENAMES_JSON = BACKEND_DATA_DIR / "requirement_path_renames.json"
BASE_PROGRAMS = ("CS", "IS", "BA", "BS")

CS_CATEGORY_1 = "GenEd---Humanities and Arts---B. Breadth Requirement---Category 1: Cognition, Choice and Behavior"
AI_CATEGORY_1A = "GenEd---Humanities and Arts---B. Breadth Requirement---Category 1A: Cognitive Studies"
OLD_CS_COGNITIVE_STUDIES = "GenEd---Category 1: Cognition---Cognitive Studies (AI)"
HAC = "GenEd---Humanities and Arts---C. Humanities and Arts Electives"

# Why an old course row that leaves a reused number does not belong to the
# course that has the number now (report text; any other row gets GENERIC_MOVED).
MOVED_EVIDENCE: dict[tuple[str, str, str], str] = {
    ("85-370", "CS", CS_CATEGORY_1): "the 2026-27 SCS Category 1 list has 85-413 Perception, not 85-370",
    ("85-370", "AI", AI_CATEGORY_1A): "the 2026-27 SCS Category 1A list has 85-413 Perception, not 85-370",
    ("85-370", "CS", HAC): "85-370 is on the 2026-27 SCS Humanities and Arts Deletions list",
    ("85-370", "AI", HAC): "85-370 is on the 2026-27 SCS Humanities and Arts Deletions list",
    ("85-350", "IS", "GenEd---Special Seminars---Perspectives on Justice and Injustice"):
        "the 2026-27 IS catalog lists no courses for this bucket; the H&SS sheet gives it to 85-450",
    ("85-350", "BS", "GenEd---Nontechnical Breadth Requirements---D. Cultural/Global Understanding Course"):
        "the MCS Cultural/Global list names 85-350 Psychology of Prejudice, which is now 85-450",
}
GENERIC_MOVED = ("an old audit mapping of the old course; no 2026-27 course list or H&SS sheet "
                 "entry names this number for it (a 2026-27 rule may still cover the course that "
                 "has the number now: rule rows are the rule step's)")


class MigrationError(Exception):
    """The catalog and the list or the provenance disagree in a way the script will not guess about."""


# ---------- Provenance ----------

def load_provenance(path: str | None) -> list[dict]:
    """The catalog the old audit rows come from: a file, or 79e29ec:data/courses.json from git."""
    if path:
        data = load_json(path)
    else:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "show", f"{PROVENANCE_COMMIT}:{PROVENANCE_FILE}"],
            capture_output=True, check=True)
        data = json.loads(out.stdout.decode("utf-8"))
    return data["courses"] if isinstance(data, dict) else data


def translate_path(renames: dict, program: str, path: str, code: str) -> str:
    """An old requirement path in its 2026-27 name: a per_course exception, else the program map."""
    per_course = (renames.get("per_course") or {}).get(program) or {}
    exceptions = per_course.get(path)
    if isinstance(exceptions, dict) and code in exceptions:
        return exceptions[code]
    return ((renames.get("programs") or {}).get(program) or {}).get(path, path)


def ai_mirror_path(old_path: str, new_path: str) -> str | None:
    """The AI general education path a CS row became, or None (Category 1 has no AI copy)."""
    if old_path == OLD_CS_COGNITIVE_STUDIES:
        return AI_CATEGORY_1A
    if new_path.startswith("GenEd") and new_path != CS_CATEGORY_1:
        return new_path
    return None


def provenance_rows(old_courses: list[dict], renames: dict, codes: set[str]) -> dict[str, list[dict]]:
    """code -> its old audit rows in 2026-27 paths, each once:
    {"program", "requirement", "type", "mirror"} ("mirror": an AI copy of a CS row)."""
    out: dict[str, list[dict]] = {}
    for course in old_courses:
        code = normalize_course_code(course.get("course_code"))
        if code not in codes:
            continue
        rows = out.setdefault(code, [])
        seen = {(r["program"], r["requirement"]) for r in rows}

        def add(program, path, mirror):
            if (program, path) not in seen:
                seen.add((program, path))
                rows.append({"program": program, "requirement": path,
                             "type": path.startswith("GenEd"), "mirror": mirror})

        for program in BASE_PROGRAMS:
            for req in (course.get("requirements") or {}).get(program) or []:
                old_path = req.get("requirement")
                if not old_path:
                    continue
                new_path = translate_path(renames, program, old_path, code)
                add(program, new_path, False)
                if program == "CS":
                    ai = ai_mirror_path(old_path, new_path)
                    if ai:
                        add("AI", ai, True)
    return out


def _key(row: dict) -> tuple:
    return (row["program"], row["requirement"], bool(row["type"]))


def _row_keys(course: dict | None) -> dict[tuple, dict]:
    out = {}
    for program, reqs in ((course or {}).get("requirements") or {}).items():
        for r in reqs or []:
            if isinstance(r, dict) and r.get("requirement"):
                out[requirement_key(program, r)] = r
    return out


# ---------- The Schedule of Classes ----------

def soc_info(soc: dict) -> tuple[set[str], dict[str, str]]:
    """(codes with running sections, code -> newest cleaned title), as reconcile reads them."""
    from reconcile_offerings import offerings_from_soc  # noqa: E402
    by_code, meta = offerings_from_soc(soc)
    return set(by_code), {code: m["title"] for code, m in meta.items() if m.get("title")}


# ---------- Migration ----------

def _send(target: dict, rows_by_program: dict[str, list[dict]]) -> int:
    return sum(merge_requirement_rows(target, p, rows) for p, rows in rows_by_program.items())


def _group(pairs) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for program, row in pairs:
        out.setdefault(program, []).append(row)
    return out


def migrate(courses: list[dict], ren: Renumbering, prov: dict[str, list[dict]],
            soc_running: set[str] | None = None) -> dict:
    """Apply the list to courses (in place). Returns what happened, per code."""
    by_code = {c.get("course_code"): c for c in courses if c.get("course_code")}
    before = copy.deepcopy(by_code)
    log: dict = {"created": [], "removed": [], "sent": {}, "new_on_target": {}, "reused": {},
                 "filled": {}, "before": before}

    # A number the SOC lists gets its row from reconcile, with the SOC's title.
    unreconciled = sorted(c for c in ren.new_codes if c not in by_code and c in (soc_running or set()))
    if unreconciled:
        raise MigrationError(f"the Schedule of Classes lists {unreconciled} but the catalog has no row "
                             "for them: run reconcile_offerings.py on this catalog first")

    # A reused number Y keeps the rows its new course brings under its own old
    # number O. A row of O that is also an old course row of Y, but not an old
    # audit row of O, would be removed from Y on a second run (O is gone by
    # then), so the result would depend on the number of runs: stop instead.
    for y in ren.reused:
        own_old = ren.old_number.get(y)
        old_keys = {_key(r) for r in prov.get(y, [])}
        keep = {_key(r) for r in prov.get(own_old, [])}
        arriving = {k for k, r in _row_keys(by_code.get(own_old)).items() if not is_rule_row(r)}
        clash = sorted(arriving & (old_keys - keep))
        if clash:
            raise MigrationError(
                f"{y}: {own_old} has rows that are also old course rows of {y}: {clash}. "
                "Settle them by hand before running the migration.")

    # Rows for new numbers that have none (daily step 1).
    log["created"] = create_missing_rows(courses, by_code, ren)

    # The old course's rows go to its new number; snapshot what each target had.
    targets_before = {z: {k: dict(r) for k, r in _row_keys(by_code.get(z)).items()} for z in ren.new_codes}
    for y in ren.renumbered:
        target = by_code[ren.new_number[y]]
        current = _row_keys(by_code.get(y))
        own = prov.get(y, [])
        present = [(k[0], current[k]) for k in (_key(r) for r in own)
                   if k in current and not is_rule_row(current[k])]
        missing = [(r["program"], {"requirement": r["requirement"], "type": r["type"]})
                   for r in own if _key(r) not in current and not r["mirror"]]
        _send(target, _group(present))
        _send(target, _group(missing))
        log["sent"][y] = len(present) + len(missing)

    # Reused numbers keep the rows of the course that has the number now.
    for y in ren.reused:
        own_old = ren.old_number.get(y)
        row = by_code[y]
        old_keys = {_key(r) for r in prov.get(y, [])}
        own_old_keys = {_key(r) for r in prov.get(own_old, [])}
        z = ren.new_number[y]
        detail = {"z": z, "own_old": own_old, "created": y in log["created"],
                  "stayed": [], "moved": [], "absent": [], "final": []}
        for program, reqs in list((row.get("requirements") or {}).items()):
            keep_rows = []
            for r in reqs or []:
                if not isinstance(r, dict):
                    keep_rows.append(r)
                    continue
                key = requirement_key(program, r)
                path = r.get("requirement")
                if is_rule_row(r):
                    keep_rows.append(r)
                    detail["stayed"].append((program, path, "a rule row; the rule step recomputes it"))
                elif key in own_old_keys:
                    keep_rows.append(r)
                    detail["stayed"].append((program, path, f"the course that has the number now had it under "
                                             f"its old number {own_old} in the old audits"))
                elif key not in old_keys:
                    keep_rows.append(r)
                    detail["stayed"].append((program, path, "not an old audit row of the old course: the "
                                             "2026-27 catalog or the overlays added it for this number"))
                else:
                    detail["moved"].append((program, path, MOVED_EVIDENCE.get((y, program, path), GENERIC_MOVED)))
            reqs[:] = keep_rows
            if not keep_rows and program not in BASE_PROGRAMS:
                del row["requirements"][program]  # no empty AI list, as on every course without AI rows
        had = _row_keys(before.get(y))
        for r in prov.get(y, []):
            if _key(r) not in had and not r["mirror"]:
                where = "the row no longer had it" if y in before else "the catalog had no row for this number"
                already = f"{z} already had it" if _key(r) in targets_before.get(z, {}) else f"added to {z}"
                detail["absent"].append((r["program"], r["requirement"], f"{where}; {already}"))
        log["reused"][y] = detail

    # Retired codes give everything else to their new number and go (daily step 2).
    for y in ren.retired:
        if by_code.get(y) is not None:
            log["filled"][y] = [f for f in ("description", "prerequisites")
                                if not (by_code[ren.new_number[y]].get(f) or "").strip()
                                and (by_code[y].get(f) or "").strip()]
    log["removed"] = retire_old_rows(courses, by_code, ren)["removed"]
    for y, detail in log["reused"].items():
        detail["final"] = sorted((p, path) for p, path, _ in _row_keys(by_code.get(y)))

    # What each new number gained.
    for z, had in targets_before.items():
        now = _row_keys(by_code.get(z))
        gained = sorted(k for k in now if k not in had)
        if gained:
            log["new_on_target"][z] = gained
    return log


# ---------- Report ----------

def _loose(title: str | None) -> str:
    return "".join(ch for ch in normalize_title(title or "") if ch.isalnum())


def _title_note(code: str, ren: Renumbering, titles: dict[str, str], by_code: dict) -> str:
    listed = ren.title.get(code)
    soc = titles.get(code)
    if soc and listed and clean_soc_title(soc) != listed:
        minor = ", case or punctuation only" if _loose(soc) == _loose(listed) else ""
        return f"{code} keeps the SOC title \"{soc}\" (list: \"{listed}\"{minor})"
    row = by_code.get(code)
    if row and not soc and listed and row.get("course_name") != listed:
        return f"{code} catalog name \"{row.get('course_name')}\" (list: \"{listed}\")"
    return ""


def _count_rows(course: dict | None) -> int:
    return sum(len(v or []) for v in ((course or {}).get("requirements") or {}).values())


def _leaf(path: str) -> str:
    return path.split("---")[-1]


def entry_actions(ren: Renumbering, log: dict, courses: list[dict], titles: dict[str, str],
                  removals: set[str] = frozenset()) -> list[dict]:
    """One line per list entry: the action and any title difference.
    removals: the codes remove_mappings lists."""
    by_code = {c.get("course_code"): c for c in courses}
    before = log["before"]
    created = set(log["created"])
    removed = set(log["removed"])
    reused = set(ren.reused)
    out = []
    for entry in ren.entries:
        old, new = entry["Old Course #"], entry["New Course #"]
        has_old = old not in (None, NO_OLD_NUMBER)
        parts = []
        if not has_old:
            parts.append("new course: " + ("row created from the list" if new in created
                                           else "row exists (from the SOC)"))
        elif new == DISCONTINUED:
            row = before.get(old)
            if not row:
                parts.append("discontinued; no catalog row")
            else:
                n = _count_rows(row)
                what = f"with its {n} mapping rows" if n else "without mappings"
                if old in removals:
                    what += " (remove_mappings)"
                parts.append(f"discontinued; row kept as a past course {what}")
                name = row.get("course_name")
                if normalize_title(name) != normalize_title(entry["Long Title"]):
                    parts.append(f"the SOC now lists {old} as \"{name}\", a course the list does not name")
        elif new == old:
            parts.append("same number; row created from the list" if new in created else "same number; unchanged")
        else:
            gained = len(log["new_on_target"].get(new, []))
            sent = log["sent"].get(old, 0)
            if new in created:
                parts.append(f"row {new} created from the list")
            if old in removed:
                n = _count_rows(before.get(old))
                filled = log["filled"].get(old) or []
                parts.append(f"{old} row deleted; " + (f"its {n} mapping rows went to {new} ({gained} new there)"
                                                       if n else "it had no mapping rows")
                             + (f"; its {' and '.join(filled)} filled {new}'s empty fields" if filled else ""))
            elif old in reused:
                d = log["reused"][old]
                parts.append(f"the old course's {sent} old audit rows are on {new} ({gained} new there); {old} "
                             f"is now \"{ren.title[old]}\" and keeps " + ("a row created from the list"
                                                                         if d["created"] else "its row")
                             + (f"; {len(d['moved'])} old course rows left {old}" if d["moved"] else ""))
            elif sent:
                parts.append(f"no {old} row (removed before the migration); its {sent} old audit rows are on {new} "
                             f"({gained} new there)")
            else:
                parts.append(f"no {old} row and no old audit rows; nothing to move")
        if new != DISCONTINUED:
            note = _title_note(new, ren, titles, by_code)
            if note:
                parts.append(note)
        out.append({"old": old, "new": new, "title": entry["Long Title"], "action": "; ".join(parts)})
    return out


def summary_lines(ren: Renumbering, log: dict, courses: list[dict]) -> list[str]:
    lines = [
        f"list entries: {len(ren.entries)} (renumbered {len(ren.renumbered)}, reused {len(ren.reused)}, "
        f"retired {len(ren.retired)}, discontinued {len(ren.discontinued)})",
        f"reused numbers: {', '.join(ren.reused)}",
        f"rows created from the list: {len(log['created'])} {log['created']}",
        f"old rows deleted: {len(log['removed'])} {log['removed']}",
        f"old course rows checked on new numbers: {sum(log['sent'].values())}; new on their targets: "
        f"{sum(len(v) for v in log['new_on_target'].values())}",
    ]
    for z, keys in sorted(log["new_on_target"].items()):
        lines.append(f"  {z} gained: " + "; ".join(f"{p} {_leaf(path)}" for p, path, _ in keys))
    for y, d in log["reused"].items():
        if d["moved"]:
            lines.append(f"  {y} lost (rows of the old course, now {d['z']}): "
                         + "; ".join(f"{p} {_leaf(path)}" for p, path, _ in d["moved"]))
    lines.append(f"catalog rows: {len(log['before'])} -> {len(courses)}")
    return lines


def checks(ren: Renumbering, courses: list[dict], overlays: dict | None) -> list[str]:
    codes = {c.get("course_code") for c in courses}
    out = []
    left = sorted(set(ren.retired) & codes)
    out.append(f"retired numbers with a row: {left or 'none'}")
    missing = sorted(set(ren.new_codes) - codes)
    out.append(f"new numbers without a row: {missing or 'none'}")
    if overlays is not None:
        out.append(f"mapping_overlays.json entries naming a retired number: "
                   f"{retired_codes_named(overlays, ren) or 'none'}")
        removals = sorted(e.get("course_code") for e in overlays.get("remove_mappings") or []
                          if e.get("course_code") in ren.reused)
        out.append(f"remove_mappings entries for reused numbers: {removals or 'none'}")
    return out


def write_report(report: Path, ren: Renumbering, log: dict, courses: list[dict], titles: dict[str, str],
                 summary: list[str], check_lines: list[str], applied: bool,
                 overlays: dict | None = None) -> None:
    removals = {e.get("course_code") for e in (overlays or {}).get("remove_mappings") or []}
    rows = entry_actions(ren, log, courses, titles, removals)
    md = ["# Psychology renumbering migration report", "",
          f"Source: {ren.source} (backend/data/psychology_renumbering.json, {len(ren.entries)} entries).",
          "",
          "The old audit rows belong to the course that had the number then. Their provenance is "
          f"{PROVENANCE_COMMIT}:{PROVENANCE_FILE}, with the paths translated by "
          "backend/data/requirement_path_renames.json, plus the AI rows that mirror those CS rows. "
          "Titles: a row the Schedule of Classes lists keeps the SOC title; a row created from the "
          "list has the Long Title.",
          "",
          f"Run: {'--apply' if applied else '--dry-run'} by backend/scraper/migrate_psychology_numbers.py.",
          "", "## Summary", "", "```"] + summary + ["```", "", "## Checks after the run", ""]
    md += [f"- {line}" for line in check_lines]
    md += ["", "## Every list entry", "", "| Old | New | Long Title | Action |", "|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['old'] or 'null'} | {r['new']} | {r['title']} | {r['action']} |")
    md += ["", "## Reused numbers", "",
           "A reused number is the old number of one course and the new number of another. Its row "
           "stays, for the course that has the number now, with only that course's rows. The old "
           "course's rows go to the old course's new number. Rows are per program and bucket.", ""]
    for y in ren.reused:
        d = log["reused"][y]
        own = d["own_old"]
        md.append(f"### {y}")
        md.append("")
        md.append(f"- Old course: {ren.old_title[y]}, now {d['z']}.")
        md.append(f"- Now: {ren.title[y]}" + (f", old number {own}" if own else ", no old number")
                  + (" (row created from the list)." if d["created"] else "."))
        if own in log["removed"]:
            md.append(f"- {own} was retired: its rows came to {y} and its row was deleted.")
        if not (d["stayed"] or d["moved"] or d["absent"]):
            md.append("- No requirement rows on either side; nothing moved.")
        for program, path, why in d["stayed"]:
            md.append(f"- kept on {y}: {program} {path}: {why}")
        for program, path, why in d["moved"]:
            md.append(f"- moved from {y} to {d['z']}: {program} {path}: {why}")
        for program, path, why in d["absent"]:
            md.append(f"- old course row not on {y}: {program} {path}: {why}")
        md.append(f"- {y} after the run: " + ("; ".join(f"{p} {_leaf(path)}" for p, path in d["final"])
                                              or "no requirement rows") + ".")
        md.append("")
    report.write_text("\n".join(md) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="report only (the default)")
    mode.add_argument("--apply", action="store_true", help="write the catalog")
    parser.add_argument("--catalog", default=str(COURSES_JSON))
    parser.add_argument("--renumbering", default=None, help=f"default: {default_path()}")
    parser.add_argument("--provenance", default=None,
                        help=f"a courses.json; default: git show {PROVENANCE_COMMIT}:{PROVENANCE_FILE}")
    parser.add_argument("--renames", default=str(RENAMES_JSON))
    parser.add_argument("--soc", default=str(SOC_JSON))
    parser.add_argument("--overlays", default=str(MAPPING_OVERLAYS_JSON), help="for the checks only")
    parser.add_argument("--report", default=None, help="write a Markdown report here")
    args = parser.parse_args(argv)

    ren = load_renumbering(args.renumbering)
    data = load_json(args.catalog)
    courses = data["courses"] if isinstance(data, dict) else data
    codes = set(ren.new_number) | set(ren.new_codes)
    prov = provenance_rows(load_provenance(args.provenance), load_json(args.renames), codes)
    soc_running, titles = (soc_info(load_json(args.soc)) if Path(args.soc).exists() else (None, {}))
    overlays = load_json(args.overlays) if Path(args.overlays).exists() else None

    try:
        log = migrate(courses, ren, prov, soc_running)
    except MigrationError as exc:
        print(f"ERROR: {exc} (catalog not saved)")
        return 1
    lines = summary_lines(ren, log, courses)
    check_lines = checks(ren, courses, overlays)
    print(("APPLY" if args.apply else "DRY RUN") + f" on {args.catalog}")
    for line in lines + check_lines:
        print(line)
    if args.apply:
        save_json(args.catalog, data)
        print(f"wrote {args.catalog}")
    else:
        print("dry run: nothing written (use --apply)")
    if args.report:
        write_report(Path(args.report), ren, log, courses, titles, lines, check_lines, args.apply, overlays)
        print(f"report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
