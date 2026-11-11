"""The Psychology department's course renumbering list and the daily step that applies it.

backend/data/psychology_renumbering.json holds the department's official list
verbatim: {"source": ..., "courses": [{"Old Course #", "New Course #",
"Long Title", "Units"}, ...]}. A "New Course #" of "x" means the course is
discontinued and has no new number; an "Old Course #" of "CMUQ" or null means a
new course that never had an old number. "Units" is a number, "VAR" or null.

Several numbers are reused: a code can be the old number of one course and the
new number of another. Old 85-370 Perception is now 85-413, while 85-370 is now
Cognitive Neuroscience Research Methods, whose old number was 85-314. So the
list is one renaming applied all at once, never a chain: 85-314 becomes 85-370
and stops there.

Terms used here, in apply_mapping_overlays.py, validate_soc_coverage.py and
migrate_psychology_numbers.py:

  renumbered    old codes whose new number is a different code
  reused        renumbered codes that are also another course's new number
  retired       renumbered codes that are no course's new number
  discontinued  old codes whose new number is "x"

The daily step, apply_renumbering() (apply_mapping_overlays.py runs it before
the additive overlays, README 14.6):

1. Every new number in the list that has no catalog row gets one from the list
   (new_course_row). Reconcile runs first, so a number the Schedule of Classes
   lists already has its row from the SOC.
2. A retired code that has a row (reconcile creates one when the SOC still
   lists the old number, for example 85-251 in M26) gives its requirement rows
   to its new number, fills the new row's empty description and prerequisites,
   gives it the sections and offered semesters it lacks (merge_offerings,
   merge_offered), and is deleted.

A reused number's row is never deleted, and rule rows ("source": "rule", which
the rule step owns) are not moved. The one-time move of the old audit mappings
and of the offered history on reused numbers is migrate_psychology_numbers.py.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from json_io import load_json  # noqa: E402
from pipeline_paths import PSYCHOLOGY_RENUMBERING_JSON  # noqa: E402
from reconcile_offerings import reconcile_course  # noqa: E402
from soc_parse import normalize_course_code, normalize_title, semester_rank  # noqa: E402

CODE_RE = re.compile(r"^\d{2}-\d{3}$")
FIELDS = ("Old Course #", "New Course #", "Long Title", "Units")
DISCONTINUED = "x"
NO_OLD_NUMBER = "CMUQ"
VARIABLE_UNITS = "VAR"
# "source" of a course row created from the list.
SOURCE_LABEL = "Psychology renumbering list"
# Requirement rows a rule bucket added carry "source": "rule"; the rule step owns them.
RULE_SOURCE = "rule"
# Every course row has these program keys (AI only when it has rows).
PROGRAM_KEYS = ("CS", "IS", "BA", "BS")
# The new numbers appear in the Schedule of Classes from Fall 2025, so the
# offered history before it belongs to the old number.
HISTORY_BEFORE = "F25"


class RenumberingError(ValueError):
    """The renumbering file breaks its schema, or a code's meaning is unclear."""


def default_path() -> Path:
    return Path(os.environ.get("PSYCHOLOGY_RENUMBERING_PATH") or PSYCHOLOGY_RENUMBERING_JSON)


class Renumbering:
    """The validated list. Every code is an NN-NNN string; lists keep the file's order."""

    def __init__(self, doc):
        if not isinstance(doc, dict) or set(doc) != {"source", "courses"}:
            raise RenumberingError('the file is {"source": ..., "courses": [...]}')
        if not isinstance(doc["source"], str) or not doc["source"].strip():
            raise RenumberingError("source must be a non-empty string")
        if not isinstance(doc["courses"], list) or not doc["courses"]:
            raise RenumberingError("courses must be a non-empty list")
        self.source = doc["source"]
        self.entries = doc["courses"]
        self.new_number: dict[str, str] = {}  # old code -> new code or "x"
        self.old_number: dict[str, str | None] = {}  # new code -> old code (None: none)
        self.title: dict[str, str] = {}  # new code -> Long Title
        self.old_title: dict[str, str] = {}  # old code -> Long Title
        self.units: dict[str, int | str | None] = {}  # new code -> Units
        self.new_codes: list[str] = []
        for i, entry in enumerate(self.entries):
            where = f"courses[{i}]"
            if not isinstance(entry, dict) or set(entry) != set(FIELDS):
                raise RenumberingError(f"{where}: needs exactly the fields {', '.join(FIELDS)}")
            old, new, title, units = (entry[f] for f in FIELDS)
            if not (old is None or old == NO_OLD_NUMBER or (isinstance(old, str) and CODE_RE.match(old))):
                raise RenumberingError(f"{where}: Old Course # must be NN-NNN, {NO_OLD_NUMBER} or null, got {old!r}")
            if not (new == DISCONTINUED or (isinstance(new, str) and CODE_RE.match(new))):
                raise RenumberingError(f"{where}: New Course # must be NN-NNN or {DISCONTINUED}, got {new!r}")
            if not isinstance(title, str) or not title.strip():
                raise RenumberingError(f"{where}: Long Title must be a non-empty string")
            if not (units is None or units == VARIABLE_UNITS
                    or (isinstance(units, int) and not isinstance(units, bool) and units > 0)):
                raise RenumberingError(f"{where}: Units must be a positive number, {VARIABLE_UNITS} or null, got {units!r}")
            has_old = old not in (None, NO_OLD_NUMBER)
            if not has_old and new == DISCONTINUED:
                raise RenumberingError(f"{where}: a course without an old number cannot be discontinued")
            if has_old:
                if old in self.new_number:
                    raise RenumberingError(f"{where}: old number {old} is listed twice")
                self.new_number[old] = new
                self.old_title[old] = title
            if new != DISCONTINUED:
                if new in self.title:
                    raise RenumberingError(f"{where}: new number {new} is listed twice")
                self.title[new] = title
                self.units[new] = units
                self.old_number[new] = old if has_old else None
                self.new_codes.append(new)
        new_set = set(self.new_codes)
        self.renumbered = [o for o, n in self.new_number.items() if n not in (DISCONTINUED, o)]
        self.reused = [o for o in self.renumbered if o in new_set]
        self.retired = [o for o in self.renumbered if o not in new_set]
        self.discontinued = [o for o, n in self.new_number.items() if n == DISCONTINUED]


def load_renumbering(path=None) -> Renumbering:
    return Renumbering(load_json(path or default_path()))


def catalog_units(units) -> int:
    """Catalog units for a list "Units" value: the number, or 0 for VAR and null
    (how the catalog stores variable units; the app shows "?")."""
    return units if isinstance(units, int) and not isinstance(units, bool) else 0


def history_before(offered: Iterable[str], cutoff: str = HISTORY_BEFORE) -> list[str]:
    """The semesters of an offered list before cutoff, oldest first, each once."""
    limit = semester_rank(cutoff)
    codes = {s for s in offered or [] if isinstance(s, str) and s and semester_rank(s) < limit}
    return sorted(codes, key=semester_rank)


def new_course_row(code: str, ren: Renumbering, old_row: dict | None = None,
                   copy_text: bool = False) -> dict:
    """A catalog row for a new number from the list.

    course_name is the Long Title and units come from the list; department is
    the number prefix, as on every catalog row ("85", which the app shows as
    Psychology). "offered" is the old row's history before HISTORY_BEFORE (none
    without an old row). With copy_text the old row's description and
    prerequisites are copied too (only for a retired old number: a reused
    number's row describes the course that has the number now).
    """
    old_row = old_row or {}
    prefix = code.split("-")[0]
    return {
        "course_code": code,
        "course_name": ren.title[code],
        "department": prefix.lstrip("0") or prefix,
        "units": catalog_units(ren.units[code]),
        "description": (old_row.get("description") or "") if copy_text else "",
        "prerequisites": (old_row.get("prerequisites") or "") if copy_text else "",
        "offered": history_before(old_row.get("offered") or []),
        "offered_qatar": False,
        "offered_pitts": False,
        "requirements": {k: [] for k in PROGRAM_KEYS},
        "offerings": [],
        "source": SOURCE_LABEL,
    }


def requirement_key(program: str, row: dict) -> tuple:
    return (program, row.get("requirement"), bool(row.get("type")))


def is_rule_row(row: dict) -> bool:
    return isinstance(row, dict) and row.get("source") == RULE_SOURCE


def merge_requirement_rows(target: dict, program: str, rows: Iterable[dict]) -> int:
    """Give target (a new number's row) the requirement rows of its course's
    old number; returns how many rows target did not have.

    A row target lacks is added as {requirement, type, major}: the mapping
    moves with its course and counts like every other row (older audit rows
    count like the rest, decision of November 10, 2026). A row target already
    has stays as it is, except that it loses "source": "rule" (a moved mapping
    is not the rule step's to remove). An AI list is made only for a row it
    gets: like every course without AI rows, target keeps no empty AI list.
    """
    reqs = target.get("requirements")
    if not isinstance(reqs, dict):
        reqs = target["requirements"] = {k: [] for k in PROGRAM_KEYS}
    bucket = reqs.get(program)
    existing = {requirement_key(program, r): r for r in bucket or [] if isinstance(r, dict)}
    added = 0
    for row in rows:
        if not isinstance(row, dict) or not row.get("requirement"):
            continue
        key = requirement_key(program, row)
        have = existing.get(key)
        if have is not None:
            if have.get("source") == RULE_SOURCE:
                have.pop("source")
            continue
        new = {"requirement": row["requirement"], "type": bool(row.get("type")), "major": program}
        if bucket is None:
            bucket = reqs[program] = []
        bucket.append(new)
        existing[key] = new
        added += 1
    return added


def fill_text(target: dict, old_row: dict) -> list[str]:
    """Fill target's empty description and prerequisites from old_row. Returns the fields filled."""
    filled = []
    for field in ("description", "prerequisites"):
        if not (target.get(field) or "").strip() and (old_row.get(field) or "").strip():
            target[field] = old_row[field]
            filled.append(field)
    return filled


def offering_key(offering: dict) -> tuple[str, str, str]:
    """(semester, section, campus): the rows of one section share it, one row per
    meeting time, as linkOfferingGroups in js/data.js reads them."""
    return (offering.get("semester_code") or "", offering.get("section") or "", offering.get("campus") or "")


def _is_lecture(offering: dict) -> bool:
    # As isLectureSection in js/data.js: "Lec", "Lec 1", "Lec 12".
    return str(offering.get("section") or "").strip().lower().startswith("lec")


def _merge_scope(mine: list[dict], theirs: list[dict]) -> list[dict]:
    """The rows of one semester and campus from two numbers in one list.

    The app links a section to the nearest lecture listed before it in the same
    semester and campus, so theirs go after mine unless a section at the start
    of theirs would then join my last lecture.
    """
    if not theirs or _is_lecture(theirs[0]) or not any(_is_lecture(o) for o in mine):
        return mine + theirs
    if not any(_is_lecture(o) for o in theirs) or _is_lecture(mine[0]):
        return theirs + mine
    return mine + theirs  # both lists start with a lone section and both have lectures


def merge_offerings(target: dict, old_row: dict) -> int:
    """Give target the SOC sections old_row lists that target lacks; returns the rows added.

    A section counts once by offering_key: soc.json can list one section under
    both numbers (85-294 A and 85-501 A in F25 and F26). The merged list keeps
    the newest semester first, as reconcile writes it, and the lecture then
    section order of each semester and campus; offered_qatar and offered_pitts
    follow the merged list (reconcile_course).
    """
    have = {offering_key(o) for o in target.get("offerings") or [] if isinstance(o, dict)}
    new = [o for o in old_row.get("offerings") or [] if isinstance(o, dict) and offering_key(o) not in have]
    if not new:
        return 0
    mine: dict[tuple, list[dict]] = {}
    theirs: dict[tuple, list[dict]] = {}
    scopes: list[tuple] = []
    for rows, bucket in ((target.get("offerings") or [], mine), (new, theirs)):
        for o in rows:
            scope = (o.get("semester_code") or "", o.get("campus") or "")
            if scope not in mine and scope not in theirs:
                scopes.append(scope)
            bucket.setdefault(scope, []).append(o)
    scopes.sort(key=lambda s: semester_rank(s[0]), reverse=True)  # stable: campus order kept
    reconcile_course(target, [o for s in scopes for o in _merge_scope(mine.get(s, []), theirs.get(s, []))])
    return len(new)


def merge_offered(target: dict, old_row: dict) -> list[str]:
    """Add old_row's offered semesters that target lacks (oldest first, each once); returns them."""
    have = set(target.get("offered") or [])
    add = sorted({s for s in old_row.get("offered") or [] if isinstance(s, str) and s} - have, key=semester_rank)
    if add:
        target["offered"] = sorted(have | set(add), key=semester_rank)
    return add


def create_missing_rows(courses: list[dict], by_code: dict[str, dict], ren: Renumbering) -> list[str]:
    """Step 1 of the daily step: a row from the list for every new number without one."""
    retired = set(ren.retired)
    created = []
    for code in ren.new_codes:
        if code in by_code:
            continue
        old = ren.old_number.get(code)
        row = new_course_row(code, ren, by_code.get(old) if old else None, copy_text=old in retired)
        courses.append(row)
        by_code[code] = row
        created.append(code)
    return created


def retire_old_rows(courses: list[dict], by_code: dict[str, dict], ren: Renumbering) -> dict:
    """Step 2 of the daily step: a retired code's row gives its requirement rows
    (not rule rows), empty text fields, SOC sections and offered semesters to
    its new number and is deleted."""
    moved = 0
    sections = 0
    removed = []
    for old in ren.retired:
        row = by_code.get(old)
        if row is None:
            continue
        target = by_code[ren.new_number[old]]
        for program, reqs in (row.get("requirements") or {}).items():
            rows = [r for r in reqs or [] if not is_rule_row(r)]
            moved += merge_requirement_rows(target, program, rows)
        fill_text(target, row)
        sections += merge_offerings(target, row)
        merge_offered(target, row)
        removed.append(old)
    if removed:
        gone = set(removed)
        courses[:] = [c for c in courses if c.get("course_code") not in gone]
        for code in gone:
            by_code.pop(code, None)
    return {"moved": moved, "sections": sections, "removed": removed}


def apply_renumbering(courses: list[dict], ren: Renumbering) -> dict:
    """The daily step (see the module docstring). Changes courses in place;
    running it again changes nothing."""
    by_code = {c.get("course_code"): c for c in courses if c.get("course_code")}
    created = create_missing_rows(courses, by_code, ren)
    retired = retire_old_rows(courses, by_code, ren)
    return {
        "renumbering_created": created,
        "renumbering_removed": retired["removed"],
        "renumbering_rows_moved": retired["moved"],
        "renumbering_sections_moved": retired["sections"],
    }


def retired_codes_named(doc: dict, ren: Renumbering) -> list[str]:
    """Retired codes that the overlay file names (each with its new number).

    The daily step deletes a retired code's row before the overlays run, so an
    entry naming one would never apply: it must name the new number instead.
    """
    retired = set(ren.retired)
    named = []
    for overlay in doc.get("overlays") or []:
        named += [(overlay.get("id"), c) for c in overlay.get("course_codes") or []]
        named += [(overlay.get("id"), c) for c in overlay.get("ensure_course_defaults_codes") or []]
    for section in ("remove_mappings", "qatar_visibility", "campus_overrides"):
        named += [(section, e.get("course_code")) for e in doc.get(section) or []]
    out = []
    for where, raw in named:
        code = normalize_course_code(raw)
        if code in retired:
            out.append(f"{where}: {code} (now {ren.new_number[code]})")
    return out


def covered_by_new_number(codes: Iterable[str], known: set[str], ren: Renumbering) -> dict[str, str]:
    """{old: new} for the retired codes among codes whose new number has a row.

    The daily step deletes those rows after moving them to the new number, so
    validate_soc_coverage counts a SOC course under such a code as covered.
    """
    retired = set(ren.retired)
    return {c: ren.new_number[c] for c in sorted(set(codes))
            if c in retired and ren.new_number[c] in known}


def code_now(code: str, ren: Renumbering, title: str | None = None, era: str | None = None,
             current_titles: Iterable[str] = ()) -> str:
    """The number that a course an older document lists (a minor file) has now.

    code is the number the document gives, title its title there (if any) and
    era "old" or "new" when the document says whether the number is from
    before or after the Fall 2025 renumbering. A retired number becomes its new
    number. A reused number becomes its new number only when the document means
    the old course: era "old", or the old course's Long Title. It stays when the
    document means the course that has the number now: era "new", or the list's
    title for the number, or one of current_titles (its catalog name). Anything
    else raises RenumberingError, to be settled by hand. Discontinued ("x") and
    unlisted codes stay.
    """
    if code in ren.retired:
        return ren.new_number[code]
    if code not in ren.reused:
        return code
    norm = normalize_title(title) if title else ""
    if era == "old" or (norm and norm == normalize_title(ren.old_title[code])):
        return ren.new_number[code]
    now = {normalize_title(ren.title[code])} | {normalize_title(t) for t in current_titles if t}
    if era == "new" or (norm and norm in now):
        return code
    raise RenumberingError(
        f"{code} is the old number of {ren.old_title[code]} (now {ren.new_number[code]}) and the "
        f"new number of {ren.title[code]}; the title {title!r} does not say which course is meant")
