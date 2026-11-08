"""CMU email checks shared by auth and directory.

normalize_cmu_email is the one backend check of "is this a CMU address";
frontend/js/utils.js normalizeCmuEmail is its frontend twin and follows the same rules.
"""
import json
import re
from pathlib import Path

CMU_EMAIL_DOMAINS = ("andrew.cmu.edu", "cmu.edu", "qatar.cmu.edu")

# One "@", and no whitespace or "@" on either side (same pattern as the frontend).
_EMAIL_SHAPE_RE = re.compile(r"^[^\s@]+@[^\s@]+$")


def normalize_cmu_email(raw: str) -> str | None:
    """Return the canonical name@andrew.cmu.edu for a CMU address, else None.

    name@cmu.edu and name@qatar.cmu.edu are aliases of the Andrew address, so
    they map to it; case and surrounding whitespace are ignored.
    """
    email = (raw or "").strip().lower()
    if not _EMAIL_SHAPE_RE.match(email):
        return None
    local, _, domain = email.partition("@")
    if domain not in CMU_EMAIL_DOMAINS:
        return None
    if domain in ("cmu.edu", "qatar.cmu.edu"):
        return f"{local}@andrew.cmu.edu"
    return email


def email_in_domain(email: str, allowed_domain: str | None) -> bool:
    """True when no domain restriction is set, or the email is in that domain."""
    allowed = (allowed_domain or "").strip().lower()
    if not allowed:
        return True
    return (email or "").lower().endswith("@" + allowed)


def parse_seed_rows(raw) -> list[dict]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("people"), list):
        return raw["people"]
    return []


def resolve_seed_path(path: Path) -> Path:
    if path.is_absolute():
        return path
    backend_dir = Path(__file__).resolve().parent
    repo_root = backend_dir.parent
    for base in (Path.cwd(), backend_dir, repo_root):
        candidate = (base / path).resolve()
        if candidate.is_file():
            return candidate
    return (repo_root / path).resolve()
