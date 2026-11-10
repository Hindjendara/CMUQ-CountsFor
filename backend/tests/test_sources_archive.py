"""The archived catalog pages in backend/data/sources/ are frozen evidence.

Every file in an archive folder must be listed in that folder's manifest.json,
and its bytes must still hash to the sha256 recorded when it was fetched. A
mismatch means the file was edited or its line endings were converted, and
the archive no longer shows what CMU published.
"""
import hashlib
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES = REPO_ROOT / "backend" / "data" / "sources"
ARCHIVES = sorted(p.parent for p in SOURCES.glob("*/manifest.json"))
FIELDS = {"url", "file", "fetched_at", "sha256", "title", "catalog_year"}
CMU_HOST = re.compile(r"^https://([a-z0-9-]+\.)*cmu\.edu/")


def _manifest(folder):
    return json.loads((folder / "manifest.json").read_text(encoding="utf-8"))


def test_there_is_an_archive():
    assert ARCHIVES, "no backend/data/sources/*/manifest.json found"


def test_manifest_entries_are_well_formed():
    for folder in ARCHIVES:
        entries = _manifest(folder)
        assert entries, folder
        files = [e["file"] for e in entries]
        assert len(files) == len(set(files)), f"duplicate files in {folder}"
        for e in entries:
            assert set(e) == FIELDS, e
            assert CMU_HOST.match(e["url"]), e["url"]
            assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", e["fetched_at"]), e
            assert re.fullmatch(r"[0-9a-f]{64}", e["sha256"]), e
            assert e["title"].strip(), e
            if e["url"].startswith("https://coursecatalog.web.cmu.edu/"):
                assert re.fullmatch(r"\d{4}-\d{4}", e["catalog_year"]), e
            else:
                assert e["catalog_year"] is None, e


def test_files_match_their_recorded_hash():
    for folder in ARCHIVES:
        for e in _manifest(folder):
            data = (folder / e["file"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == e["sha256"], e["file"]


def test_every_archived_file_is_in_the_manifest():
    for folder in ARCHIVES:
        listed = {e["file"] for e in _manifest(folder)}
        on_disk = {
            p.relative_to(folder).as_posix()
            for p in folder.rglob("*")
            if p.is_file() and p.name != "manifest.json"
        }
        assert on_disk == listed, folder
