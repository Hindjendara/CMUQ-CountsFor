#!/usr/bin/env python3
"""
CMU-Q People directory scraper → backend/seed_users.json

The CMU-Q People page (https://www.qatar.cmu.edu/people/) loads faculty via
Algolia search. This script uses the same public search-only credentials
embedded in the site's ajax-filter.js to fetch Faculty directory entries and
write CountsFor seed rows (email, name, role, primary_program, department).

Usage:
  python backend/scraper/scrape_faculty_directory.py
  python backend/scraper/scrape_faculty_directory.py --dry-run
  python backend/scraper/scrape_faculty_directory.py -o backend/seed_users.json
  python backend/scraper/scrape_faculty_directory.py --also-write backend/data/faculty_directory.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_paths import FACULTY_DIRECTORY_JSON, SEED_USERS_JSON  # noqa: E402

USER_AGENT = "CountsFor-faculty-seed/1.0 (+https://github.com/Adicmu/Countsfor-Summer-26)"

# Public search-only Algolia creds from qatar.cmu.edu people-pages/js/ajax-filter.js
ALGOLIA_APP_ID = "CPJ5OXRVYU"
ALGOLIA_API_KEY = "896a606c39ba213efea67eed6bbcbdc2"
ALGOLIA_INDEX = "wp_searchable_posts_people"
ALGOLIA_URL = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/{ALGOLIA_INDEX}/query"

HITS_PER_PAGE = 100
FACULTY_FILTER = 'post_type_label:People AND taxonomies.directory:"Faculty"'

# CMU-Q department label → CountsFor primary_program
DEPT_TO_PROGRAM = {
    "computer science": "CS",
    "information systems": "IS",
    "business administration": "BA",
    "biological sciences": "BS",
    "arts and sciences": "AS",
    "arts & sciences": "AS",
}

AREA_HEAD_RE = re.compile(
    r"\b(area head|associate area head|department head|program director)\b",
    re.I,
)

MPS_TITLE_RE = re.compile(
    r"\b(mathematical sciences?|physics|chemistry|statistics(?: and data science)?|data science)\b",
    re.I,
)

MPS = "Mathematical and Physical Sciences (MPS)"
HSS = "Humanities and Social Sciences (H&SS)"


def normalize_department(department: str, titles: str = "") -> str:
    """Map legacy Arts & Sciences taxonomy to MPS or H&SS from job titles."""
    dept = (department or "").strip()
    if dept.lower() in ("arts and sciences", "arts & sciences"):
        return MPS if MPS_TITLE_RE.search(titles or "") else HSS
    return dept


def dept_to_program(dept_names: list[str] | str | None) -> str | None:
    if not dept_names:
        return None
    if isinstance(dept_names, str):
        dept_names = [dept_names]
    for raw in dept_names:
        key = raw.strip().lower()
        if key in DEPT_TO_PROGRAM:
            return DEPT_TO_PROGRAM[key]
    return None


def infer_role(titles: str) -> str:
    if AREA_HEAD_RE.search(titles or ""):
        if re.search(r"associate", titles or "", re.I):
            return "associate_area_head"
        return "area_head"
    return "professor"


def algolia_search(page: int) -> dict:
    body = {
        "query": "",
        "page": page,
        "hitsPerPage": HITS_PER_PAGE,
        "filters": FACULTY_FILTER,
        "attributesToRetrieve": [
            "post_id",
            "post_title",
            "taxonomies",
            "additional_info",
            "titles",
        ],
    }
    req = urllib.request.Request(
        ALGOLIA_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-Algolia-Application-Id": ALGOLIA_APP_ID,
            "X-Algolia-API-Key": ALGOLIA_API_KEY,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))


def scrape_cmuq_faculty() -> list[dict]:
    rows: list[dict] = []
    seen_emails: set[str] = set()
    page = 0
    nb_pages = 1

    while page < nb_pages:
        try:
            data = algolia_search(page)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            print(f"Algolia page {page} failed: {exc}", file=sys.stderr)
            break

        nb_pages = int(data.get("nbPages") or 0)
        hits = data.get("hits") or []
        print(f"  page {page + 1}/{max(nb_pages, 1)} — {len(hits)} hits", file=sys.stderr)

        for hit in hits:
            info = hit.get("additional_info") or {}
            email = (info.get("email") or "").strip().lower()
            if not email or "@" not in email:
                continue
            if email in seen_emails:
                continue
            seen_emails.add(email)

            name = (hit.get("post_title") or "").strip()
            tax = hit.get("taxonomies") or {}
            dept_raw = tax.get("department-names") or []
            if isinstance(dept_raw, str):
                dept_raw = [dept_raw]
            titles = (info.get("titles") or hit.get("titles") or "").strip()
            department = normalize_department(dept_raw[0] if dept_raw else "", titles)
            program = dept_to_program(dept_raw) or "CS"

            rows.append({
                "email": email,
                "name": name,
                "role": infer_role(titles),
                "primary_program": program,
                "department": department,
                "_titles": titles,
                "_post_id": hit.get("post_id"),
            })

        page += 1
        if page < nb_pages:
            time.sleep(0.2)

    return sorted(rows, key=lambda r: r["email"])


def write_json(rows: list[dict], out_path: Path, dry_run: bool, keep_meta: bool) -> None:
    clean = []
    for r in rows:
        row = dict(r)
        if not keep_meta:
            row = {k: v for k, v in row.items() if not k.startswith("_")}
        clean.append(row)

    payload = json.dumps(clean, indent=2, ensure_ascii=False) + "\n"
    if dry_run:
        print(payload)
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(payload, encoding="utf-8")
    print(f"Wrote {len(clean)} rows → {out_path}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o", "--output",
        default=str(SEED_USERS_JSON),
        help="Seed file path (default: backend/seed_users.json)",
    )
    parser.add_argument(
        "--also-write",
        default=str(FACULTY_DIRECTORY_JSON),
        help="Also save a snapshot with scrape metadata (default: backend/data/faculty_directory.json)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print seed JSON to stdout")
    parser.add_argument("--no-snapshot", action="store_true", help="Skip backend/data/faculty_directory.json")
    args = parser.parse_args()

    print("Fetching CMU-Q People directory (Faculty) via Algolia…", file=sys.stderr)
    rows = scrape_cmuq_faculty()
    no_email = 0  # already filtered
    print(f"Faculty with email: {len(rows)} (skipped without email: {no_email})", file=sys.stderr)

    if not rows:
        print("No faculty rows collected.", file=sys.stderr)
        return 1

    write_json(rows, Path(args.output), args.dry_run, keep_meta=False)

    if not args.dry_run and not args.no_snapshot and args.also_write:
        snapshot = {
            "source": "https://www.qatar.cmu.edu/people/",
            "filter": FACULTY_FILTER,
            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(rows),
            "people": rows,
        }
        snap_path = Path(args.also_write)
        snap_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote snapshot → {snap_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
