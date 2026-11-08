"""Shared SOC search-form parsing: departments, semesters, campuses."""
from __future__ import annotations

import os
import re

# Matches SOC <option value="BUS"> codes, including alnum like S3D.
DEPT_CODE_PATTERN = re.compile(r'value="([A-Z0-9]{2,5})"[^>]*>(.*?)<', re.DOTALL)
SEMESTER_CODE_PATTERN = re.compile(
    r'<option\s+value="([FSMN]\d{2})"[^>]*>(.*?)</option>',
    re.IGNORECASE | re.DOTALL,
)

# Fallback when the SOC search form cannot be fetched. Synced from SOC on 2026-06-25.
SOC_DEPARTMENT_CODES = [
    "ARC", "ART", "AEM", "BXA", "BSC", "BMD", "BUS", "CFA", "CIT", "CST",
    "CMQ", "CMU", "CHE", "CMY", "CEE", "CB", "CS", "BCA", "DES", "HSS",
    "DRA", "ECO", "ECE", "EPP", "BEA", "ENG", "ETC", "H00", "HC", "HIS",
    "HCI", "BHA", "ICT", "INI", "ISP", "ISM", "III", "LTI", "LCL", "MCS",
    "MLG", "MSE", "MSC", "MEG", "MED", "MUS", "NVS", "NSI", "PHI", "PE",
    "PHY", "PSY", "PMP", "PPP", "ROB", "SCS", "BSA", "SDS", "S3D", "STA",
    "STU",
]

# Fallback semester codes when the form cannot be fetched.
SOC_SEMESTER_CODES = ["F26", "M26", "S26", "F25", "M25"]

# Pittsburgh + Qatar — must match PRG_LOCATION values on the SOC search form.
SOC_LOCATION_CODES = [
    ("PIT", "Pittsburgh"),
    ("DOH", "Qatar"),
]


def parse_department_list(form_html: str) -> list[tuple[str, str]]:
    """Parse DEPT dropdown from SOC search form HTML."""
    dept_block = re.search(r'name="DEPT".*?</select>', form_html, re.DOTALL)
    if not dept_block:
        return []

    dept_list: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in DEPT_CODE_PATTERN.finditer(dept_block.group()):
        code = m.group(1)
        if code == "All" or code in seen:
            continue
        name = re.sub(r"\s+", " ", m.group(2)).strip()
        name = re.sub(r"\s*\(\d+XXX\)\s*", "", name).strip()
        if name:
            dept_list.append((code, name))
            seen.add(code)
    return dept_list


def parse_semester_list(form_html: str) -> list[tuple[str, str]]:
    """Parse SEMESTER dropdown: [(code, label), ...] in SOC order."""
    sem_block = re.search(r'name="SEMESTER".*?</select>', form_html, re.DOTALL)
    if not sem_block:
        return []

    semesters: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in SEMESTER_CODE_PATTERN.finditer(sem_block.group()):
        code = m.group(1).upper()
        label = re.sub(r"\s+", " ", m.group(2)).strip()
        if code in seen:
            continue
        semesters.append((code, label or code))
        seen.add(code)
    return semesters


def fallback_department_list() -> list[tuple[str, str]]:
    return [(code, code) for code in SOC_DEPARTMENT_CODES]


def fallback_semester_list() -> list[tuple[str, str]]:
    return [(code, code) for code in SOC_SEMESTER_CODES]


def get_department_list(fetch_get, search_url: str, form_html: str | None = None) -> list[tuple[str, str]]:
    """Fetch department list from SOC, falling back to hardcoded codes."""
    try:
        form_html = form_html or fetch_get(search_url)
        dept_list = parse_department_list(form_html)
        if dept_list:
            return dept_list
    except Exception as e:
        print(f"  WARN: couldn't fetch dept list dynamically: {e}")
    return fallback_department_list()


def get_semester_list(fetch_get, search_url: str, form_html: str | None = None) -> list[tuple[str, str]]:
    """Fetch current semester codes from the SOC search form."""
    override = os.environ.get("SEMESTERS_TO_TRY", "").strip()
    if override:
        return [(code.strip().upper(), code.strip().upper()) for code in override.split(",") if code.strip()]

    try:
        form_html = form_html or fetch_get(search_url)
        sem_list = parse_semester_list(form_html)
        if sem_list:
            return sem_list
    except Exception as e:
        print(f"  WARN: couldn't fetch semester list dynamically: {e}")
    return fallback_semester_list()


def load_soc_form(fetch_get, search_url: str) -> tuple[str, list[tuple[str, str]], list[tuple[str, str]]]:
    """One GET to SOC search; return form HTML, semesters, departments."""
    form_html = fetch_get(search_url)
    semesters = get_semester_list(fetch_get, search_url, form_html=form_html)
    departments = get_department_list(fetch_get, search_url, form_html=form_html)
    return form_html, semesters, departments
