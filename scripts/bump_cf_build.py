#!/usr/bin/env python3
"""Bump cf-build / ?v= cache-bust tags in frontend/app.html and frontend/index.html.

app.html carries the cf-build meta (also the cache tag for data/courses.json);
index.html loads utils.js and api.js too, so its ?v= tags move with it.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_HTML = ROOT / "frontend" / "app.html"
INDEX_HTML = ROOT / "frontend" / "index.html"
_V_RE = re.compile(r"\?v=[^\"']+")
_META_RE = re.compile(r'(<meta name="cf-build" content=")[^"]+(")')


# Read and write without newline translation so the files keep their line endings.
def _read(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def bump(
    build_id: str | None = None,
    app_html: Path = APP_HTML,
    index_html: Path = INDEX_HTML,
) -> str:
    build = build_id or f"soc-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    text = _read(app_html)
    # A function replacement keeps the build id literal (no backreference or
    # escape parsing, so ids that start with a digit or contain backslashes are safe).
    text, n_meta = _META_RE.subn(
        lambda m: f"{m.group(1)}{build}{m.group(2)}",
        text,
        count=1,
    )
    text, n_v = _V_RE.subn(lambda _m: f"?v={build}", text)
    if n_meta != 1:
        raise SystemExit(f"Expected one cf-build meta tag, updated {n_meta}")
    if n_v < 1:
        raise SystemExit("No ?v= cache-bust query strings found in app.html")
    _write(app_html, text)

    if index_html.is_file():
        index_text = _read(index_html)
        _write(index_html, _V_RE.sub(lambda _m: f"?v={build}", index_text))
    return build


if __name__ == "__main__":
    bid = sys.argv[1] if len(sys.argv) > 1 else None
    print(bump(bid))
