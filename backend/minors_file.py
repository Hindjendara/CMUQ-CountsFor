"""Read frontend/data/minors.json for the admin edit checks.

The file is built by hand from the official minor files (README 4.4) and is the
list of minors the app offers. The course and minor editors check against it, so
a minor added to the file (as `product` was, from its 2026-27 catalog page) is
accepted with no change here. When the file cannot be read, callers fall back to
auth.VALID_MINORS_FOR_PATCH (which lists `product` too) and a shape check.

The path is the plain Config attribute MINORS_JSON_PATH (not an environment
variable), so tests can point it at another file.
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import current_app

MINORS_JSON = Path(__file__).resolve().parents[1] / "frontend" / "data" / "minors.json"

_cache: dict = {"key": None, "minors": None, "leaves": None}


def minors_json_path() -> Path:
    try:
        configured = current_app.config.get("MINORS_JSON_PATH")
    except RuntimeError:  # outside an app context (scripts)
        configured = None
    return Path(configured) if configured else MINORS_JSON


def _leaf_paths(categories, prefix: str, out: set[str]) -> None:
    """Category ids joined by ---, as buildMinorTree builds node paths; leaves only."""
    for cat in categories or []:
        if not isinstance(cat, dict) or not cat.get("id"):
            continue
        path = f"{prefix}---{cat['id']}" if prefix else str(cat["id"])
        children = cat.get("children") or []
        if children:
            _leaf_paths(children, path, out)
        else:
            out.add(path)


def _load() -> None:
    path = minors_json_path()
    try:
        stat = path.stat()
    except OSError:
        _cache.update(key=None, minors=None, leaves=None)
        return
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if _cache["key"] == key:
        return
    try:
        minors = json.loads(path.read_text(encoding="utf-8"))["minors"]
        if not isinstance(minors, dict) or not minors:
            raise ValueError("no minors")
    except (OSError, ValueError, KeyError, TypeError):
        _cache.update(key=None, minors=None, leaves=None)
        return
    leaves: dict[str, set[str]] = {}
    for code, definition in minors.items():
        if isinstance(definition, dict):
            found: set[str] = set()
            _leaf_paths(definition.get("categories"), "", found)
            leaves[code] = found
    _cache.update(key=key, minors=minors, leaves=leaves)


def load_minors() -> dict | None:
    """The "minors" map of the file, or None when it cannot be read."""
    _load()
    return _cache["minors"]


def minor_leaf_paths() -> dict[str, set[str]] | None:
    """{minor code: the paths of its categories that hold courses}, or None."""
    _load()
    return _cache["leaves"]


def known_minor_codes() -> set[str]:
    """The minors of the file, or the fallback list when it cannot be read."""
    minors = load_minors()
    if minors is not None:
        return {code for code, d in minors.items() if isinstance(d, dict)}
    from .auth import VALID_MINORS_FOR_PATCH
    return set(VALID_MINORS_FOR_PATCH)


def minor_name(code: str) -> str:
    minors = load_minors() or {}
    definition = minors.get(code)
    name = definition.get("name") if isinstance(definition, dict) else None
    return str(name or code)
