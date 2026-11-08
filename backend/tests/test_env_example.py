"""The env templates must list exactly the variables the code reads.

  backend/.env.example          every variable the API (backend/*.py) reads, and nothing else
  deploy/countsfor.env.example  only variables the API reads; every one except the
                                dev-server and dev-only ones
  deploy/scraper.env.example    exactly the variables the pipeline (backend/scraper/*.py) reads

A variable counts as listed whether its line is active (NAME=value) or commented
out (# NAME=value). Reads are found in the source: os.environ.get("NAME"),
os.environ["NAME"], os.getenv("NAME") and config.py's _flag("NAME", ...).
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
SCRAPER = BACKEND / "scraper"

APP_EXAMPLE = BACKEND / ".env.example"
SERVER_APP_EXAMPLE = REPO_ROOT / "deploy" / "countsfor.env.example"
SERVER_SCRAPER_EXAMPLE = REPO_ROOT / "deploy" / "scraper.env.example"

# Read by python -m backend.app only, or must never be set on the server.
DEV_ONLY = {"HOST", "PORT", "FLASK_DEBUG", "EXPOSE_RESET_TOKEN"}
# Documented in a template but consumed by libraries, not by CountsFor code.
EXTERNAL = {"HTTPS_PROXY", "https_proxy"}

_LITERAL_READ = re.compile(
    r"""os\.environ\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']"""
    r"""|os\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]"""
    r"""|os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']"""
    r"""|\b_flag\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']"""
)
_ANY_ENV_ACCESS = re.compile(r"os\.environ\b|os\.getenv\b")
# Env reads whose name is not a literal, allowed only inside these helpers
# (their callers pass literals, which _LITERAL_READ picks up).
_GENERIC_READS = {("config.py", 'os.environ.get(name, "")')}

_EXAMPLE_LINE = re.compile(r"^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)=")


def _sources(folder: Path, recursive: bool) -> list[Path]:
    files = folder.rglob("*.py") if recursive else folder.glob("*.py")
    return sorted(p for p in files if "tests" not in p.relative_to(folder).parts)


def env_reads(files: list[Path]) -> set[str]:
    names: set[str] = set()
    for path in files:
        src = path.read_text(encoding="utf-8")
        literal = 0
        for m in _LITERAL_READ.finditer(src):
            names.add(next(g for g in m.groups() if g))
            if not m.group(0).startswith("_flag"):
                literal += 1
        generic = sum(1 for key in _GENERIC_READS if key[0] == path.name and key[1] in src)
        total = len(_ANY_ENV_ACCESS.findall(src))
        assert total == literal + generic, (
            f"{path.relative_to(REPO_ROOT)}: an environment read this test cannot see "
            "(a non-literal name?). Read variables by literal name so they can be documented."
        )
    return names


def example_keys(path: Path) -> set[str]:
    return {m.group(1) for line in path.read_text(encoding="utf-8").splitlines()
            if (m := _EXAMPLE_LINE.match(line))}


def app_reads() -> set[str]:
    return env_reads(_sources(BACKEND, recursive=False))


def scraper_reads() -> set[str]:
    return env_reads(_sources(SCRAPER, recursive=True))


def test_scanner_sees_the_known_reads():
    reads = app_reads()
    # one of each form: plain get, _flag(), and the dev-server reads in app.py
    assert {"DATABASE_URL", "TRUST_PROXY", "SESSION_COOKIE_SECURE", "PORT", "EXPOSE_RESET_TOKEN"} <= reads
    assert {"SOC_OUTPUT_PATH", "CATALOG_PATHS", "SEMESTERS_TO_TRY"} <= scraper_reads()


def test_backend_env_example_matches_app_reads():
    keys, reads = example_keys(APP_EXAMPLE), app_reads()
    assert sorted(reads - keys) == [], "read in backend/*.py but missing from backend/.env.example"
    assert sorted(keys - reads) == [], "in backend/.env.example but never read in backend/*.py"


def test_server_env_example_lists_only_app_variables():
    keys, reads = example_keys(SERVER_APP_EXAMPLE) - EXTERNAL, app_reads()
    assert sorted(keys - reads) == [], "in deploy/countsfor.env.example but never read by the API"
    assert sorted(keys & DEV_ONLY) == [], "dev-only variables do not belong on the server"
    assert sorted(reads - DEV_ONLY - keys) == [], "read by the API but missing from deploy/countsfor.env.example"


def test_scraper_env_example_matches_pipeline_reads():
    keys, reads = example_keys(SERVER_SCRAPER_EXAMPLE) - EXTERNAL, scraper_reads()
    assert sorted(reads - keys) == [], "read in backend/scraper/ but missing from deploy/scraper.env.example"
    assert sorted(keys - reads) == [], "in deploy/scraper.env.example but never read in backend/scraper/"


def test_examples_hold_no_real_secrets():
    secret_names = ("SECRET_KEY", "RESEND_API_KEY", "SMTP_PASS")
    for path in (APP_EXAMPLE, SERVER_APP_EXAMPLE, SERVER_SCRAPER_EXAMPLE):
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*#?\s*([A-Z_]+)=(.*)$", line)
            if not m or m.group(1) not in secret_names:
                continue
            value = m.group(2).strip()
            assert value in ("", "CHANGE_ME") or "change-me" in value, (
                f"{path.name}: {m.group(1)} must be empty or a CHANGE_ME placeholder"
            )
