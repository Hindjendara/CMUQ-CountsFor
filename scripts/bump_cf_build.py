#!/usr/bin/env python3
"""Bump cf-build / ?v= cache-bust tags in app.html and index.html.

app.html carries the cf-build meta (also the cache tag for data/courses.json);
index.html loads utils.js and api.js too, so its ?v= tags move with it.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_HTML = ROOT / "app.html"
INDEX_HTML = ROOT / "index.html"
_V_RE = re.compile(r"\?v=[^\"']+")


# Read and write without newline translation so the files keep their line endings.
def _read(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def bump(build_id: str | None = None) -> str:
    build = build_id or f"soc-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    text = _read(APP_HTML)
    text, n_meta = re.subn(
        r'(<meta name="cf-build" content=")[^"]+(")',
        rf"{build}",
        text,
        count=1,
    )
    text, n_v = _V_RE.subn(f"?v={build}", text)
    if n_meta != 1:
        raise SystemExit(f"Expected one cf-build meta tag, updated {n_meta}")
    if n_v < 1:
        raise SystemExit("No ?v= cache-bust query strings found in app.html")
    _write(APP_HTML, text)

    if INDEX_HTML.is_file():
        index_text = _read(INDEX_HTML)
        _write(INDEX_HTML, _V_RE.sub(f"?v={build}", index_text))
    return build


if __name__ == "__main__":
    bid = sys.argv[1] if len(sys.argv) > 1 else None
    print(bump(bid))
