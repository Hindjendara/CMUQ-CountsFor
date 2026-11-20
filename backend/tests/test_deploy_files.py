"""The server files in deploy/ must match the repo they deploy.

On the server the repo's folders sit under /var/www/html/countsfor (frontend/,
backend/), so every path a deploy file names there must exist in the repo,
except the few that only exist at run time (the virtual environment, the
staging folder, the precompressed catalog). The checks also tie the files to
each other: the module gunicorn loads, the port Apache proxies to, the
timeouts, the cron script, and line endings (a CR breaks cron and bash).
"""
import importlib
import re
import shlex
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY = REPO_ROOT / "deploy"
DEPLOY_ROOT = "/var/www/html/countsfor"

APACHE = DEPLOY / "countsfor.conf"
SERVICE = DEPLOY / "countsfor-api.service"
CRON = DEPLOY / "countsfor.cron"
LOGROTATE = DEPLOY / "countsfor.logrotate"
RUN_SCRAPE = REPO_ROOT / "backend" / "scraper" / "run_scrape.sh"
SHIB_SP = DEPLOY / "shibboleth" / "shibboleth2.xml"
SHIB_MAP = DEPLOY / "shibboleth" / "attribute-map.xml"


def _deploy_files() -> list[Path]:
    """Every file under deploy/, subfolders (deploy/shibboleth/) included."""
    return sorted(p for p in DEPLOY.rglob("*") if p.is_file())

# Paths under the deploy root that are made on the server, not shipped in git.
RUNTIME_ONLY = (
    re.compile(r"^backend/\.venv(/|$)"),
    re.compile(r"^backend/var(/|$)"),
    re.compile(r"^backend/instance(/|$)"),
    re.compile(r"^frontend/data/[^/]+\.json\.gz$"),
)
_DEPLOY_PATH = re.compile(re.escape(DEPLOY_ROOT) + r"(/[^\s'\"\\;>)]*)?")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _active_lines(path: Path) -> list[str]:
    """Non-empty lines that are not comments."""
    return [
        line.strip()
        for line in _text(path).splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def _service_value(key: str) -> str:
    """The value of KEY=... in the systemd unit, with backslash continuations joined."""
    joined = re.sub(r"\\\n\s*", " ", _text(SERVICE))
    for line in joined.splitlines():
        if line.startswith(key + "="):
            return line[len(key) + 1:].strip()
    raise AssertionError(f"{key}= not found in {SERVICE.name}")


def _gunicorn_args() -> list[str]:
    return shlex.split(_service_value("ExecStart"))


def _option(args: list[str], name: str) -> str:
    return args[args.index(name) + 1]


# ── Every file ─────────────────────────────────────────────────────────────

def test_deploy_files_and_scraper_script_use_lf_line_endings():
    files = _deploy_files() + [RUN_SCRAPE]
    assert {APACHE, SERVICE, CRON, LOGROTATE, SHIB_SP, SHIB_MAP,
            DEPLOY / "countsfor.env.example", DEPLOY / "scraper.env.example"} <= set(files)
    for path in files:
        data = path.read_bytes()
        assert b"\r" not in data, f"{path.name} has CR line endings"
        assert data.endswith(b"\n"), f"{path.name} must end with a newline"


def test_every_deploy_root_path_exists_in_the_repo():
    checked = 0
    for path in _deploy_files() + [RUN_SCRAPE]:
        for match in _DEPLOY_PATH.finditer(_text(path)):
            rel = (match.group(1) or "/").strip("/").rstrip(".,:")
            if any(p.search(rel) for p in RUNTIME_ONLY):
                continue
            assert (REPO_ROOT / rel).exists(), (
                f"{path.name} names {DEPLOY_ROOT}/{rel}, which is not in the repo"
            )
            checked += 1
    assert checked > 10


# ── Apache ─────────────────────────────────────────────────────────────────

def test_apache_sections_are_balanced():
    stack: list[tuple[str, int]] = []
    opened = 0
    for number, line in enumerate(_text(APACHE).splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        close = re.match(r"^</(\w+)\s*>$", line)
        open_ = re.match(r"^<(\w+)(\s[^>]*)?>$", line)
        if close:
            assert stack, f"line {number}: </{close.group(1)}> closes nothing"
            name, start = stack.pop()
            assert name.lower() == close.group(1).lower(), (
                f"line {number}: </{close.group(1)}> closes <{name}> from line {start}"
            )
        elif open_:
            stack.append((open_.group(1), number))
            opened += 1
        else:
            assert not line.startswith("<"), f"line {number}: malformed section {line!r}"
    assert not stack, f"unclosed sections: {stack}"
    assert opened >= 10


def test_apache_serves_the_frontend_and_denies_the_backend():
    conf = _text(APACHE)
    assert f"DocumentRoot {DEPLOY_ROOT}/frontend\n" in conf
    denied = re.search(
        rf"<Directory {re.escape(DEPLOY_ROOT)}/backend>\s*Require all denied\s*</Directory>", conf)
    assert denied, "backend/ must be denied server-wide"
    assert "Options -Indexes" in conf


def test_apache_certificate_placeholders_are_marked():
    lines = _active_lines(APACHE)
    for key in ("SSLCertificateFile", "SSLCertificateKeyFile"):
        (value,) = [line.split()[1] for line in lines if line.split()[0] == key]
        assert value.startswith("/etc/apache2/") and "CHANGE_ME" in value


def test_apache_proxies_api_to_gunicorn_without_stripping_the_prefix():
    lines = _active_lines(APACHE)
    bind = _option(_gunicorn_args(), "--bind")
    (proxy,) = [line.split() for line in lines if line.split()[0] == "ProxyPass"]
    assert proxy[1:3] == ["/api/", f"http://{bind}/api/"]
    (reverse,) = [line.split() for line in lines if line.split()[0] == "ProxyPassReverse"]
    assert reverse[1:3] == ["/api/", f"http://{bind}/api/"]
    # Flask's routes really are under /api, so the prefix must reach gunicorn.
    from backend.app import create_app
    from backend.config import TestConfig
    rules = [r.rule for r in create_app(TestConfig, bootstrap_db=False).url_map.iter_rules()]
    api_rules = [r for r in rules if r.startswith("/api/")]
    assert len(api_rules) > 20
    assert set(rules) - set(api_rules) <= {"/health", "/static/<path:filename>"}
    # /health is not public: proxied, if at all, only inside a commented block.
    assert not any("/health" in line and line.startswith("ProxyPass") for line in lines)


def test_apache_api_answers_carry_one_no_store_header():
    # "always" does not replace a header the backend sent (normal table), so the
    # backend's Cache-Control (no-cache on GET /api/courses/overrides) is unset first.
    block = re.search(r"<Location /api/>(.*?)</Location>", _text(APACHE), re.S)
    assert block, "no <Location /api/> block"
    lines = [line.strip() for line in block.group(1).splitlines()
             if line.strip() and not line.strip().startswith("#")]
    assert lines == ["Header unset Cache-Control", 'Header always set Cache-Control "no-store"']


def test_apache_denies_the_daily_update_backups():
    (deny,) = re.findall(r'<FilesMatch "([^"]*\bbak\b[^"]*)">', _text(APACHE))
    for name in ("courses.json.prev", "soc.json.prev", "x.py", "notes.md", ".env", "a~"):
        assert re.search(deny, name), name
    for name in ("courses.json", "courses.json.gz", "index.html", "app.js"):
        assert not re.search(deny, name), name


def test_apache_proxy_timeout_is_above_gunicorn_timeout():
    (timeout,) = [int(line.split()[1]) for line in _active_lines(APACHE)
                  if line.split()[0] == "ProxyTimeout"]
    assert timeout > int(_option(_gunicorn_args(), "--timeout"))


def test_apache_serves_the_precompressed_catalog_once():
    conf = _text(APACHE)
    assert "RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI}.gz -f" in conf
    assert re.search(r"RewriteRule .*\\\.json\$ \$1\.json\.gz \[[^\]]*E=no-gzip:1", conf)
    block = re.search(r'<FilesMatch "\\\.json\\\.gz\$">(.*?)</FilesMatch>', conf, re.S)
    assert block, "no FilesMatch block for .json.gz"
    body = block.group(1)
    for needle in ("ForceType application/json", "Content-Encoding gzip",
                   "Vary Accept-Encoding", "no-gzip", 'Cache-Control "no-cache"'):
        assert needle in body
    # The scraper writes exactly that file next to the catalog.
    update_data = _text(REPO_ROOT / "backend" / "scraper" / "update_data.py")
    assert 'with_name("courses.json.gz")' in update_data


# ── CMU sign-in (Shibboleth) ───────────────────────────────────────────────

_SHIB_LINE = re.compile(
    r"^(AuthType shibboleth|ShibRequestSetting|ShibUseHeaders|Require shib-session|SetHandler shib"
    r"|Include /etc/apache2/countsfor-sso\.conf|RequestHeader set X-CountsFor-SSO-Secret"
    r"|<Location /Shibboleth\.sso>|<Location /api/auth/shibboleth>|<IfDefine !COUNTSFOR_SSO_SECRET>)"
)


def test_apache_shibboleth_lines_only_load_with_mod_shib():
    """Apache must start (and the site work in password mode) before
    libapache2-mod-shib is installed: every Shibboleth line is in <IfModule mod_shib>."""
    stack: list[str] = []
    found = 0
    for line in _active_lines(APACHE):
        if _SHIB_LINE.match(line):
            assert "IfModule mod_shib" in stack, f"outside <IfModule mod_shib>: {line}"
            found += 1
        if re.match(r"^</\w+>$", line):
            stack.pop()
        elif m := re.match(r"^<(\w+)(?:\s+([^>]*))?>$", line):
            stack.append(f"{m.group(1)} {m.group(2) or ''}".strip())
    assert found == 10


def test_apache_protects_the_sso_route_and_alone_sends_the_secret():
    from backend.auth import SSO_LOGIN_PATH, SSO_SECRET_HEADER
    conf = _text(APACHE)
    block = re.search(rf"<Location {re.escape(SSO_LOGIN_PATH)}>(.*?)</Location>", conf, re.S)
    assert block, f"no <Location {SSO_LOGIN_PATH}> block"
    lines = [line.strip() for line in block.group(1).splitlines()
             if line.strip() and not line.strip().startswith("#")]
    assert lines == [
        "AuthType shibboleth",
        "ShibRequestSetting requireSession 1",
        "ShibUseHeaders On",
        "Require shib-session",
        f'RequestHeader set {SSO_SECRET_HEADER} "${{COUNTSFOR_SSO_SECRET}}"',
    ]
    # Set in that block only, and taken from the root-only include, which must
    # exist (Include, not IncludeOptional) and define the value.
    active = _active_lines(APACHE)
    assert sum(SSO_SECRET_HEADER in line for line in active) == 1
    assert "Include /etc/apache2/countsfor-sso.conf" in active
    assert not any(line.startswith("IncludeOptional") for line in active)
    assert re.search(r"<IfDefine !COUNTSFOR_SSO_SECRET>\s*Error ", conf)
    # The SP's handlers belong to mod_shib, and nothing proxies them.
    handler = re.search(r"<Location /Shibboleth\.sso>\s*SetHandler shib\s*</Location>", conf)
    assert handler, "/Shibboleth.sso must be handled by mod_shib"
    assert not any("Shibboleth.sso" in line for line in active if line.startswith("ProxyPass"))
    # The protected path is a real API route.
    from backend.app import create_app
    from backend.config import TestConfig
    rules = {r.rule for r in create_app(TestConfig, bootstrap_db=False).url_map.iter_rules()}
    assert SSO_LOGIN_PATH in rules


_SP_NS = {"sp": "urn:mace:shibboleth:3.0:native:sp:config"}


def test_shibboleth_sp_template_names_this_site():
    import xml.etree.ElementTree as ET
    from backend.config import TestConfig
    root = ET.parse(SHIB_SP).getroot()
    app = root.find("sp:ApplicationDefaults", _SP_NS)
    assert app.get("entityID") == "https://countsfor.qatar.cmu.edu/shibboleth"
    sessions = app.find("sp:Sessions", _SP_NS)
    assert sessions.get("handlerURL") == "/Shibboleth.sso"
    assert (sessions.get("handlerSSL"), sessions.get("cookieProps"), sessions.get("redirectLimit")) == (
        "true", "https", "exact")
    sso = sessions.find("sp:SSO", _SP_NS)
    # CMU-Q's own IdP, not the Pittsburgh login.cmu.edu (CMU-Q IT, November 20, 2026).
    assert sso.get("entityID") == "https://login.qatar.cmu.edu/idp/shibboleth"
    assert app.find("sp:Errors", _SP_NS).get("supportContact") == "helpcenter@qatar.cmu.edu"
    assert app.find("sp:MetadataProvider", _SP_NS).get("path") == "cmu-qatar-idp-metadata.xml"
    assert sso.text.split() == ["SAML2"]
    handlers = {h.get("type"): h for h in sessions.findall("sp:Handler", _SP_NS)}
    assert handlers["MetadataGenerator"].get("Location") == "/Metadata"
    assert handlers["Session"].get("showAttributeValues") == "false"
    assert handlers["Status"].get("acl") == "127.0.0.1 ::1"
    # The API sends the browser to this SP's logout handler on sign out.
    assert TestConfig.SHIB_LOGOUT_URL.startswith(sessions.get("handlerURL") + "/Logout?return=")
    assert "CHANGE_ME" in _text(SHIB_SP)


def test_shibboleth_attribute_map_gives_the_header_names_the_api_reads():
    import xml.etree.ElementTree as ET
    from backend.config import TestConfig as C
    root = ET.parse(SHIB_MAP).getroot()
    ids = {a.get("name"): a.get("id") for a in root}
    assert ids["urn:oid:1.3.6.1.4.1.5923.1.1.1.6"] == C.SHIB_HEADER_EPPN == "eppn"
    assert ids["urn:oid:0.9.2342.19200300.100.1.3"] == C.SHIB_HEADER_MAIL == "mail"
    assert ids["urn:oid:2.16.840.1.113730.3.1.241"] == C.SHIB_HEADER_DISPLAY_NAME == "displayName"
    assert ids["urn:oid:2.5.4.42"] == C.SHIB_HEADER_GIVEN_NAME == "givenName"
    assert ids["urn:oid:2.5.4.4"] == C.SHIB_HEADER_SURNAME == "sn"
    assert "urn:oid:1.3.6.1.4.1.5923.1.1.1.1" in ids  # eduPersonAffiliation


def test_server_env_starts_in_password_mode():
    lines = _active_lines(DEPLOY / "countsfor.env.example")
    assert "AUTH_MODE=password" in lines
    assert not any(line.startswith("SHIB_PROXY_SECRET=") for line in lines)


# ── systemd ────────────────────────────────────────────────────────────────

def test_service_runs_from_the_deploy_root_as_countsfor():
    assert _service_value("WorkingDirectory") == DEPLOY_ROOT
    assert _service_value("User") == "countsfor"
    # Not www-data: the API needs nothing of Apache's, and backend/ is countsfor:countsfor.
    assert _service_value("Group") == "countsfor"
    assert _service_value("EnvironmentFile") == "/etc/countsfor/countsfor.env"
    assert "/etc/countsfor/countsfor.env" in _text(DEPLOY / "countsfor.env.example")
    assert _service_value("Restart") == "on-failure"


def test_service_gunicorn_target_imports():
    args = _gunicorn_args()
    assert args[0] == f"{DEPLOY_ROOT}/backend/.venv/bin/gunicorn"
    assert _option(args, "--bind") == "127.0.0.1:8000"
    assert _option(args, "--workers") == "3"
    assert _option(args, "--forwarded-allow-ips") == "127.0.0.1"
    target = args[-1]
    module, _, call = target.partition(":")
    assert call.endswith("()"), target
    factory = getattr(importlib.import_module(module), call[:-2])
    assert callable(factory)
    # gunicorn imports the module from WorkingDirectory: backend/ must sit directly in it.
    assert (REPO_ROOT / module.replace(".", "/")).with_suffix(".py").is_file()


def test_service_bootstraps_the_database_first():
    pre = shlex.split(_service_value("ExecStartPre"))
    assert pre[0] == f"{DEPLOY_ROOT}/backend/.venv/bin/python"
    assert pre[1:3] == ["-m", "backend.bootstrap_db"]
    module = importlib.import_module("backend.bootstrap_db")
    assert callable(module.main)
    # The workers skip the bootstrap the unit already ran.
    assert "SKIP_DB_BOOTSTRAP=1" in _active_lines(DEPLOY / "countsfor.env.example")


# ── cron and logrotate ─────────────────────────────────────────────────────

def test_cron_runs_the_scraper_daily_with_a_lock_and_a_timeout():
    jobs = [line for line in _active_lines(CRON) if not re.match(r"^[A-Z_]+=", line)]
    assert len(jobs) == 1, jobs
    fields = jobs[0].split()
    minute, hour, dom, month, dow, user = fields[:6]
    assert (dom, month, dow) == ("*", "*", "*") and minute.isdigit() and hour.isdigit()
    assert user == "countsfor"
    command = fields[6:]
    assert command[0] == "/usr/bin/flock" and "/usr/bin/timeout" in command
    script = f"{DEPLOY_ROOT}/backend/scraper/run_scrape.sh"
    assert script in command
    # All output goes to the log; only the failure line after "||" reaches cron
    # (and MAILTO, when one is set).
    run, _, on_failure = " ".join(command).partition(" || ")
    assert run.split()[-3:] == [">>", "/var/log/countsfor/scrape.log", "2>&1"]
    assert on_failure.startswith("echo ") and "$?" in on_failure
    # The header of run_scrape.sh quotes the same line.
    assert jobs[0] in _text(RUN_SCRAPE)
    # cron turns a bare % into a newline
    for line in _text(CRON).splitlines():
        if not line.startswith("#") or re.match(r"^#\s*\d", line):
            assert not re.search(r"(?<!\\)%", line), line


def test_scraper_script_is_executable_in_git():
    import subprocess
    out = subprocess.run(
        ["git", "ls-files", "-s", "backend/scraper/run_scrape.sh"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=False,
    ).stdout
    if not out:  # not a git checkout (an exported copy): nothing to check
        return
    assert out.startswith("100755 "), out
    assert _text(RUN_SCRAPE).startswith("#!/usr/bin/env bash\n")


def test_scraper_script_refuses_to_run_as_another_user():
    # A run as root would leave root-owned files that break every later cron run.
    script = _text(RUN_SCRAPE)
    check = script.index('if [ "$(id -un)" != "$OWNER" ]')
    assert check < script.index(". /etc/countsfor/scraper.env") < script.index("exec ")


def test_logrotate_covers_the_cron_log_folder():
    assert _text(LOGROTATE).count("{") == _text(LOGROTATE).count("}") == 1
    assert "/var/log/countsfor/*.log {" in _text(LOGROTATE)
