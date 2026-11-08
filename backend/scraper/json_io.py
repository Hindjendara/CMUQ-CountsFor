"""Shared JSON read/write helpers for the data pipeline scripts."""
from __future__ import annotations

import json
import os
from typing import Any


def load_json(path: str | os.PathLike[str]) -> Any:
    """Read a UTF-8 JSON file. Accepts a str or a Path."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str | os.PathLike[str], data: Any) -> None:
    """Write JSON with 2-space indent and a trailing newline. Accepts a str or a Path."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
