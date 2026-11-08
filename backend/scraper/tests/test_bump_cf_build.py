"""scripts/bump_cf_build.py must keep the cf-build meta tag intact."""
import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "bump_cf_build.py"
_spec = importlib.util.spec_from_file_location("bump_cf_build", _SCRIPT)
bump_cf_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bump_cf_build)

APP = (
    '<head>\n'
    '  <meta name="cf-build" content="soc-2026-01-01" />\n'
    '  <link rel="stylesheet" href="css/styles.css?v=soc-2026-01-01" />\n'
    '  <script src="js/app.js?v=soc-2026-01-01"></script>\n'
    '</head>\n'
)
INDEX = '<script src="js/utils.js?v=old"></script>\n'


@pytest.fixture
def pages(tmp_path):
    app = tmp_path / "app.html"
    index = tmp_path / "index.html"
    app.write_bytes(APP.encode("utf-8"))
    index.write_bytes(INDEX.encode("utf-8"))
    return app, index


@pytest.mark.parametrize("build", ["soc-test", "2026-11-07", r"odd\1id"])
def test_bump_keeps_meta_tag_and_can_run_twice(pages, build):
    app, index = pages
    bump_cf_build.bump(build, app_html=app, index_html=index)
    text = app.read_text(encoding="utf-8")
    assert f'<meta name="cf-build" content="{build}" />' in text
    assert f"css/styles.css?v={build}" in text
    assert f"js/app.js?v={build}" in text
    assert index.read_text(encoding="utf-8") == f'<script src="js/utils.js?v={build}"></script>\n'
    assert not any(ord(ch) < 9 for ch in text)

    bump_cf_build.bump("second", app_html=app, index_html=index)
    assert '<meta name="cf-build" content="second" />' in app.read_text(encoding="utf-8")


def test_bump_keeps_crlf_line_endings(tmp_path):
    app = tmp_path / "app.html"
    app.write_bytes(APP.replace("\n", "\r\n").encode("utf-8"))
    bump_cf_build.bump("soc-x", app_html=app, index_html=tmp_path / "missing.html")
    raw = app.read_bytes()
    assert b'content="soc-x" />\r\n' in raw
    assert raw.count(b"\r\n") == APP.count("\n")


def test_bump_real_app_html_on_a_copy(tmp_path):
    app = tmp_path / "app.html"
    app.write_bytes(bump_cf_build.APP_HTML.read_bytes())
    bump_cf_build.bump("soc-copy", app_html=app, index_html=tmp_path / "none.html")
    assert '<meta name="cf-build" content="soc-copy"' in app.read_text(encoding="utf-8")
