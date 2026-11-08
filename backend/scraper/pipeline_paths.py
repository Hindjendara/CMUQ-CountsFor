"""Default file locations for the data pipeline.

Paths are derived from this file, not from the working directory, so the
scripts behave the same from the repo root, from backend/scraper/ or from cron.
The repo layout mirrors the server (/var/www/html/countsfor):

  <root>/backend/scraper/          this folder (pipeline scripts)
  <root>/backend/data/             private data: soc.json, mapping_overlays.json,
                                   faculty_directory.json, directory_admins.json
  <root>/frontend/data/            served data: courses.json, minor_courses.json

Each script still lets an environment variable override its paths.
"""
from __future__ import annotations

from pathlib import Path

SCRAPER_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRAPER_DIR.parent
ROOT = BACKEND_DIR.parent

BACKEND_DATA_DIR = BACKEND_DIR / "data"
FRONTEND_DATA_DIR = ROOT / "frontend" / "data"

SOC_JSON = BACKEND_DATA_DIR / "soc.json"
MAPPING_OVERLAYS_JSON = BACKEND_DATA_DIR / "mapping_overlays.json"
FACULTY_DIRECTORY_JSON = BACKEND_DATA_DIR / "faculty_directory.json"
COURSES_JSON = FRONTEND_DATA_DIR / "courses.json"
SEED_USERS_JSON = BACKEND_DIR / "seed_users.json"
