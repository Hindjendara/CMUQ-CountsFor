"""Course catalog edits: admins add, edit, renumber and archive courses.

Reads are public so every visitor sees the corrected catalog (who saved an edit is
shown to admins only); writes are admin only.
Edits are stored as overrides because the daily SOC scrape regenerates
frontend/data/courses.json and would otherwise erase them.

What a course counts for is stored per program and per minor as a change to
the catalog (README 12.2):

    {"CS": {"add": [{"requirement": "GenEd---...", "type": true, "major": "CS"}],
            "remove": ["BS in Computer Science---..."]},
     "MINOR:psychology": {"add": ["survey"], "remove": ["advanced"]}}

A key that is absent means the catalog (or minors.json) as it is, including what
the daily pipeline adds later. A list value is the shape saved before
2026-11-10; the browser still applies it to its own program, but it is never
written again (a page still sending lists is told to reload).
"""
from __future__ import annotations

import json
import re

from flask import Blueprint, g, jsonify, request

from .admin import record_event
from .db import db
from .minors_file import known_minor_codes, minor_leaf_paths, minor_name
from .models import CourseOverride
from .permissions import current_user, is_admin, require_role_group, ROLE_GROUP_ADMIN

bp = Blueprint("course_overrides", __name__, url_prefix="/api/courses/overrides")

COURSE_CODE_RE = re.compile(r"^\d{2}-\d{3}$")
REQUIREMENT_PROGRAMS = frozenset({"CS", "IS", "BA", "BS", "AI", "GS"})
TEXT_FIELDS = {"course_name": 200, "description": 5000, "prerequisites": 1000}
SEMESTER_RE = re.compile(r"^[FSMN]\d{2}$")
EDITABLE_KEYS = frozenset({"new_code", "requirements", "offered", *TEXT_FIELDS, "department", "units",
                           "offered_qatar", "offered_pitts"})

# Every degree path starts with its program's root; General Education paths start
# with GenEd in every program, and that root alone decides the Gen Ed flag.
GENED_ROOT = "GenEd"
DEGREE_ROOTS = {
    "CS": "BS in Computer Science",
    "IS": "BS in Information Systems",
    "BA": "BS in Business Administration",
    "BS": "BS in Biological Sciences",
    "AI": "BS in Artificial Intelligence",
    "GS": "BS in General Studies",
}
PROGRAM_NAMES = {
    "CS": "Computer Science", "IS": "Information Systems", "BA": "Business Administration",
    "BS": "Biological Sciences", "AI": "Artificial Intelligence", "GS": "General Studies",
}
MINOR_PREFIX = "MINOR:"
MINOR_CODE_RE = re.compile(r"^[a-z0-9_]{1,40}$")
# Used only when minors.json cannot be read: the shape of a category path.
MINOR_PATH_RE = re.compile(r"^[a-z0-9_]+(---[a-z0-9_]+)*$")
# Long dashes: figure dash to horizontal bar, as the dash guard test. Refused in category
# paths, in the course texts admins type and in minor notes (minor_overrides.py).
DASH_RE = re.compile(r"[\u2012-\u2015]")
PATH_MAX = 400
EDIT_ROWS_MAX = 200
BATCH_MAX = 200
AUDIT_TEXT_MAX = 300
STALE_PAGE_MESSAGE = "This page is out of date. Reload it and try again."


class EditError(ValueError):
    """A refused edit: the JSON error code, the message for the admin and the HTTP status."""

    def __init__(self, message: str, code: str = "invalid_requirements", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def _normalize_code(raw) -> str | None:
    code = (raw or "").strip().upper() if isinstance(raw, str) else ""
    if re.fullmatch(r"\d{5}", code):
        code = f"{code[:2]}-{code[2:]}"
    return code if COURSE_CODE_RE.match(code) else None


def _clean_fields(data: dict) -> tuple[dict, str | None]:
    """Validate the catalog fields present in `data`. Returns (fields, error)."""
    out: dict = {}
    if "new_code" in data:
        code = _normalize_code(data["new_code"])
        if not code:
            return {}, "Course number must look like 15-122."
        out["course_code"] = code
    for field, max_len in TEXT_FIELDS.items():
        if field in data:
            label = field.replace("_", " ")
            if data[field] is not None and not isinstance(data[field], str):
                return {}, f"{label.capitalize()} must be text."
            value = (data[field] or "").strip()
            if field == "course_name" and not value:
                return {}, "Course name cannot be empty."
            if len(value) > max_len:
                return {}, f"{label.capitalize()} is too long (max {max_len} characters)."
            if DASH_RE.search(value):
                return {}, f"Use plain hyphens in the {label}, not long dashes."
            out[field] = value
    if "department" in data:
        dept = str(data["department"] or "").strip().lstrip("0") or None
        if dept is not None and not dept.isdigit():
            return {}, "Department must be the numeric department code, for example 15."
        out["department"] = dept
    if "units" in data:
        try:
            units = float(data["units"])
        except (TypeError, ValueError):
            return {}, "Units must be a number."
        if not 0 <= units <= 48:
            return {}, "Units must be between 0 and 48."
        out["units"] = int(units) if units.is_integer() else units
    for flag in ("offered_qatar", "offered_pitts"):
        if flag in data:
            out[flag] = bool(data[flag])
    if "offered" in data:
        sems = data["offered"] or []
        if not isinstance(sems, list) or not all(isinstance(s, str) and SEMESTER_RE.match(s) for s in sems):
            return {}, "Offered semesters must be codes like F26 or S27."
        out["offered"] = sorted(set(sems))
    return out, None


# ── What a course counts for ────────────────────────────────

def _clean_path(program: str, raw) -> tuple[str, bool]:
    """One category path of `program` -> (path with trimmed parts, is Gen Ed). Raises EditError."""
    if not isinstance(raw, str) or not raw.strip():
        raise EditError("Each category needs a path such as GenEd---Foundations---Data Analysis.")
    parts = [part.strip() for part in raw.split("---")]
    path = "---".join(parts)
    if len(parts) < 2 or not all(parts):
        raise EditError(f"{raw.strip()} is not a full category path: it needs at least two parts, such as GenEd---Foundations.")
    if len(path) > PATH_MAX:
        raise EditError(f"Each category path must be under {PATH_MAX} characters.")
    if DASH_RE.search(path):
        raise EditError("Category names use plain hyphens, not long dashes.")
    if parts[0] not in (GENED_ROOT, DEGREE_ROOTS[program]):
        raise EditError(f"A {PROGRAM_NAMES[program]} category starts with GenEd or {DEGREE_ROOTS[program]}.")
    return path, parts[0] == GENED_ROOT


def _edit_lists(label: str, value) -> tuple[list, list]:
    if not isinstance(value, dict) or set(value) - {"add", "remove"}:
        raise EditError(f"Changes for {label} must be an object with add and remove lists.")
    add, remove = value.get("add") or [], value.get("remove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        raise EditError(f"Changes for {label} must be an object with add and remove lists.")
    if len(add) > EDIT_ROWS_MAX or len(remove) > EDIT_ROWS_MAX:
        raise EditError(f"Too many categories in one change for {label}.")
    return add, remove


def _clean_major_edit(program: str, value) -> dict | None:
    """None resets the program to the catalog; a dict is cleaned to {"add": rows, "remove": paths}.

    Only the path of an added row is read: its Gen Ed flag comes from its root and
    any other field a client sends (for example an old "earlier" flag) is dropped.
    """
    if value is None:
        return None
    if isinstance(value, list):
        raise EditError(STALE_PAGE_MESSAGE, code="stale_page")
    add_raw, remove_raw = _edit_lists(PROGRAM_NAMES[program], value)
    add, added = [], set()
    for entry in add_raw:
        path, is_gened = _clean_path(program, entry.get("requirement") if isinstance(entry, dict) else entry)
        if path not in added:
            added.add(path)
            add.append({"requirement": path, "type": is_gened, "major": program})
    remove, removed = [], set()
    for entry in remove_raw:
        path, _ = _clean_path(program, entry)
        if path not in removed:
            removed.add(path)
            remove.append(path)
    both = sorted(added & removed)
    if both:
        raise EditError(f"{both[0]} cannot be both added and removed.")
    return {"add": add, "remove": remove} if add or remove else None


def _clean_minor_edit(code: str, value) -> dict | None:
    """Leaf category paths of one minor: {"add": [paths], "remove": [paths]}, or None to reset."""
    if value is None:
        return None
    leaves = minor_leaf_paths()
    if code not in (leaves if leaves is not None else known_minor_codes()):
        raise EditError(f"Unknown minor: {code}.")
    allowed = leaves.get(code) if leaves is not None else None
    if isinstance(value, list):
        raise EditError("Minor changes must be an object with add and remove lists.")
    name = minor_name(code)
    add_raw, remove_raw = _edit_lists(f"the {name} minor", value)

    def clean(raw) -> str:
        path = raw.strip() if isinstance(raw, str) else ""
        if allowed is not None:
            if path not in allowed:
                raise EditError(f"{path or 'That'} is not a category of the {name} minor that lists courses.")
        elif not MINOR_PATH_RE.match(path):
            raise EditError(f"{path or 'That'} is not a minor category path.")
        return path

    add = list(dict.fromkeys(clean(p) for p in add_raw))
    remove = list(dict.fromkeys(clean(p) for p in remove_raw))
    both = sorted(set(add) & set(remove))
    if both:
        raise EditError(f"{both[0]} cannot be both added and removed.")
    return {"add": add, "remove": remove} if add or remove else None


def _clean_requirements(raw) -> dict:
    """{key: cleaned change or None}. Keys: a program, or MINOR:<code> of a minors.json minor."""
    if not isinstance(raw, dict):
        raise EditError("requirements must be an object keyed by program.")
    out: dict = {}
    for key, value in raw.items():
        if key in REQUIREMENT_PROGRAMS:
            out[key] = _clean_major_edit(key, value)
        elif isinstance(key, str) and key.startswith(MINOR_PREFIX):
            code = key[len(MINOR_PREFIX):]
            if not MINOR_CODE_RE.match(code):
                raise EditError(f"Unknown minor: {code}.")
            out[key] = _clean_minor_edit(code, value)
        else:
            raise EditError(f"Unknown program: {key}.")
    return out


def _stored_requirements(row: CourseOverride) -> dict:
    if not row.requirements:
        return {}
    try:
        value = json.loads(row.requirements)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _merge_requirements(row: CourseOverride, cleaned: dict) -> tuple[dict, dict]:
    """Set the keys of `cleaned` on the stored map (None removes a key). Returns (before, after)."""
    before = _stored_requirements(row)
    after = dict(before)
    for key, value in cleaned.items():
        if value is None:
            after.pop(key, None)
        else:
            after[key] = value
    row.requirements = json.dumps(after) if after else None
    return before, after


# ── Audit ───────────────────────────────────────────────────

def _short(value):
    if isinstance(value, str) and len(value) > AUDIT_TEXT_MAX:
        return value[:AUDIT_TEXT_MAX - 3] + "..."
    return value


def _audit_details(prev_fields: dict, fields: dict, before: dict, after: dict) -> dict:
    """What one save changed.

    fields: the changed field names, plus "counts for" when a program changed and
    "minors" when a minor changed (what older log rows hold). changes: each field
    {"from", "to"}, where null means the Schedule of Classes value. requirements:
    the new value of every changed key, null meaning back to the catalog.
    """
    changed = sorted(k for k in set(prev_fields) | set(fields) if prev_fields.get(k) != fields.get(k))
    keys = [k for k in dict.fromkeys([*before, *after]) if before.get(k) != after.get(k)]
    names = list(changed)
    if any(not k.startswith(MINOR_PREFIX) for k in keys):
        names.append("counts for")
    if any(k.startswith(MINOR_PREFIX) for k in keys):
        names.append("minors")
    return {
        "fields": names,
        "changes": {k: {"from": _short(prev_fields.get(k)), "to": _short(fields.get(k))} for k in changed} or None,
        "requirements": {k: after.get(k) for k in keys} or None,
    }


def _snapshot(row: CourseOverride) -> dict:
    body = row.to_dict()
    return {k: body[k] for k in ("fields", "requirements", "archived")}


def _actor_stamp(row: CourseOverride) -> None:
    row.updated_by_id = g.user.id
    row.updated_by_email = g.user.email


def _is_empty(row: CourseOverride) -> bool:
    return not row.is_new and not row.fields and not _stored_requirements(row) and not row.archived


def _apply_edit(key: str, data: dict) -> dict:
    """Validate and stage one course's edit in the session (no commit). Returns the response body."""
    fields, err = _clean_fields(data)
    if err:
        raise EditError(err, code="invalid_field")
    cleaned = _clean_requirements(data["requirements"]) if "requirements" in data else {}

    new_code = fields.get("course_code")
    if new_code and new_code != key:
        clash = db.session.query(CourseOverride).filter_by(course_code=new_code).one_or_none()
        if clash and clash.is_new:
            raise EditError(f"{new_code} is already used by a course added here.", code="code_taken", status=409)

    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none()
    created = row is None
    if created:
        # Not added to the session until we know something differs from the catalog.
        row = CourseOverride(course_code=key, is_new=False, archived=False)
    prev_fields = json.loads(row.fields) if row.fields else {}
    merged = dict(prev_fields)
    merged.update(fields)
    if not row.is_new and merged.get("course_code") == key:
        merged.pop("course_code")  # renumbered back to the original
    moved_from = None
    if row.is_new:
        # An added course is keyed by its own code, so renumbering moves the key.
        if new_code and new_code != key:
            if db.session.query(CourseOverride).filter_by(course_code=new_code).one_or_none():
                raise EditError(f"{new_code} already has an entry here.", code="code_taken", status=409)
            row.course_code = new_code
            moved_from = key
        merged["course_code"] = row.course_code
    before_row = None if created else _snapshot(row)
    row.fields = json.dumps(merged) if merged else None
    before, after = _merge_requirements(row, cleaned)

    if _is_empty(row):
        # Nothing differs from the catalog any more, so keep no row at all.
        if not created:
            db.session.delete(row)
            record_event(g.user, "course.revert", key, before=before_row, reason="matches the catalog")
        return {"course_code": key, "is_new": False, "archived": False, "fields": {}, "requirements": None}

    details = _audit_details(prev_fields, merged, before, after)
    if not details["fields"] and not moved_from:
        return row.to_dict()  # nothing changed: no event, no new editor stamp
    if created:
        db.session.add(row)
    _actor_stamp(row)
    record_event(
        g.user, "course.update", row.course_code,
        **details, **({"renumbered_from": key} if new_code and new_code != key else {}),
    )
    db.session.flush()
    return row.to_dict()


@bp.route("", methods=["GET"])
def list_overrides():
    """Every edit, for every visitor. Who saved it (updated_by_email) only for admins."""
    rows = db.session.query(CourseOverride).order_by(CourseOverride.course_code).all()
    editor = is_admin(current_user())
    resp = jsonify(items=[r.to_dict(include_editor=editor) for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def add_course():
    """Add a course that is not in the scraped catalog."""
    data = request.get_json(silent=True) or {}
    code = _normalize_code(data.get("course_code"))
    if not code:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    name = data.get("course_name")
    if name is not None and not isinstance(name, str):
        return jsonify(error="invalid_field", message="Course name must be text."), 400
    if not (name or "").strip():
        return jsonify(error="missing_name", message="Course name is required."), 400
    if db.session.query(CourseOverride).filter_by(course_code=code).one_or_none():
        return jsonify(error="exists", message=f"{code} already has an entry here. Edit it instead."), 409

    payload = {k: v for k, v in data.items() if k not in ("course_code", "new_code", "requirements")}
    fields, err = _clean_fields(payload)
    if err:
        return jsonify(error="invalid_field", message=err), 400
    fields["course_code"] = code
    try:
        cleaned = _clean_requirements(data.get("requirements") or {})
    except EditError as e:
        return jsonify(error=e.code, message=e.message), e.status
    requirements = {k: v for k, v in cleaned.items() if v is not None}

    row = CourseOverride(
        course_code=code,
        is_new=True,
        fields=json.dumps(fields),
        requirements=json.dumps(requirements) if requirements else None,
    )
    _actor_stamp(row)
    db.session.add(row)
    record_event(g.user, "course.add", code, name=fields.get("course_name"), requirements=requirements or None)
    db.session.commit()
    return jsonify(row.to_dict()), 201


@bp.route("/<code>", methods=["PATCH"])
@require_role_group(ROLE_GROUP_ADMIN)
def edit_course(code: str):
    """Save edits for a catalog course (creates its override) or an added course.

    "requirements" changes only the keys it names: {"CS": {"add": [...], "remove": [...]}}
    sets CS, {"CS": null} puts CS back to the catalog, and every other stored key stays.
    """
    key = _normalize_code(code)
    if not key:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    data = request.get_json(silent=True) or {}
    unknown = set(data) - EDITABLE_KEYS
    if unknown:
        return jsonify(error="unknown_fields", message=f"Cannot update: {sorted(unknown)}"), 400
    try:
        body = _apply_edit(key, data)
    except EditError as e:
        db.session.rollback()
        return jsonify(error=e.code, message=e.message), e.status
    db.session.commit()
    return jsonify(body)


@bp.route("/batch", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def batch_edit():
    """Change what several courses count for at once (the category view).

    Body: {"items": [{"course_code": "15-122", "requirements": {...}}, ...]}, each item
    like a PATCH. One transaction: any refused item saves nothing. One course.update
    event per course that changed.
    """
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not items:
        return jsonify(error="invalid_items", message="items must be a list of course changes."), 400
    if len(items) > BATCH_MAX:
        return jsonify(error="invalid_items", message=f"At most {BATCH_MAX} courses at a time."), 400
    seen: set[str] = set()
    results = []
    index = 0
    try:
        for index, item in enumerate(items):
            if not isinstance(item, dict) or "requirements" not in item or set(item) - {"course_code", "requirements"}:
                raise EditError("Each item needs a course_code and requirements, and nothing else.", code="invalid_items")
            key = _normalize_code(item.get("course_code"))
            if not key:
                raise EditError("Course number must look like 15-122.", code="invalid_code")
            if key in seen:
                raise EditError(f"{key} is listed twice.", code="invalid_items")
            seen.add(key)
            results.append(_apply_edit(key, {"requirements": item["requirements"]}))
    except EditError as e:
        db.session.rollback()
        return jsonify(error=e.code, message=e.message, index=index), e.status
    db.session.commit()
    return jsonify(items=results)


def _set_archived(code: str, archived: bool):
    key = _normalize_code(code)
    if not key:
        return jsonify(error="invalid_code", message="Course number must look like 15-122."), 400
    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none()
    if row is None:
        if not archived:
            return jsonify(error="not_found", message="That course is not archived."), 404
        row = CourseOverride(course_code=key, is_new=False)
        db.session.add(row)
    row.archived = archived
    _actor_stamp(row)
    record_event(g.user, "course.archive" if archived else "course.restore", key)
    body = row.to_dict()
    if not archived and _is_empty(row):
        db.session.delete(row)  # restored with no other edits, so nothing left to store
    db.session.commit()
    return jsonify(body)


@bp.route("/<code>/archive", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def archive_course(code: str):
    """Hide a course from students. Nothing is deleted; restore brings it back."""
    return _set_archived(code, True)


@bp.route("/<code>/restore", methods=["POST"])
@require_role_group(ROLE_GROUP_ADMIN)
def restore_course(code: str):
    return _set_archived(code, False)


@bp.route("/<code>", methods=["DELETE"])
@require_role_group(ROLE_GROUP_ADMIN)
def revert_course(code: str):
    """Drop every manual edit so the course shows exactly what the scrape says.

    Added courses are archived instead, so a misclick never loses one. The event
    keeps what was dropped ("before"), so it can be redone by hand.
    """
    key = _normalize_code(code)
    row = db.session.query(CourseOverride).filter_by(course_code=key).one_or_none() if key else None
    if row is None:
        return jsonify(error="not_found", message="That course has no edits."), 404
    if row.is_new:
        return jsonify(error="added_course", message="Courses added here can be archived, not reverted."), 400
    before = _snapshot(row)
    db.session.delete(row)
    record_event(g.user, "course.revert", key, before=before)
    db.session.commit()
    return jsonify(ok=True, course_code=key)
