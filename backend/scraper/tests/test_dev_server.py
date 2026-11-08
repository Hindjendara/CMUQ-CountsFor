"""scripts/dev_server.py serves frontend/ and proxies /api and /health to the
backend, keeping method, headers, cookies, body and status (like Apache)."""
import http.client
import importlib.util
import json
import threading
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "dev_server.py"
_spec = importlib.util.spec_from_file_location("dev_server", _SCRIPT)
dev_server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dev_server)


class EchoBackend(BaseHTTPRequestHandler):
    """Stands in for Flask: echoes the request and sets two cookies."""

    def log_message(self, *args):
        pass

    def _echo(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        payload = json.dumps({
            "method": self.command,
            "path": self.path,
            "body": body,
            "authorization": self.headers.get("Authorization"),
            "cookie": self.headers.get("Cookie"),
            "host": self.headers.get("Host"),
            "forwarded_for": self.headers.get("X-Forwarded-For"),
        }).encode()
        status = 418 if self.path.startswith("/api/teapot") else 200
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "cf_session=abc; Path=/; HttpOnly")
        self.send_header("Set-Cookie", "other=1; Path=/")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PATCH = do_DELETE = _echo


def _start(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


@pytest.fixture
def servers(tmp_path):
    (tmp_path / "index.html").write_text("<h1>landing</h1>", encoding="utf-8")
    backend = _start(ThreadingHTTPServer(("127.0.0.1", 0), EchoBackend))

    class Handler(dev_server.DevHandler):
        def log_message(self, *args):
            pass

    Handler.backend = ("127.0.0.1", backend.server_address[1])
    front = _start(ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(tmp_path))))
    yield front.server_address[1], backend, Handler
    front.shutdown()
    backend.shutdown()
    front.server_close()
    backend.server_close()


def _request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request(method, path, body=body, headers=headers or {})
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp, data


def test_static_files_are_served_with_no_cache(servers):
    port, _, _ = servers
    resp, data = _request(port, "GET", "/")
    assert resp.status == 200
    assert data == b"<h1>landing</h1>"
    assert resp.getheader("Cache-Control") == "no-cache"


def test_api_request_is_forwarded_intact(servers):
    port, _, _ = servers
    resp, data = _request(port, "PATCH", "/api/me?x=1", body=b'{"role":"student"}', headers={
        "Authorization": "Bearer tok123",
        "Cookie": "cf_session=old",
        "Content-Type": "application/json",
        "Host": "localhost:8765",
    })
    assert resp.status == 200
    echoed = json.loads(data)
    assert echoed["method"] == "PATCH"
    assert echoed["path"] == "/api/me?x=1"
    assert echoed["body"] == '{"role":"student"}'
    assert echoed["authorization"] == "Bearer tok123"
    assert echoed["cookie"] == "cf_session=old"
    assert echoed["host"] == "localhost:8765"
    assert echoed["forwarded_for"] == "127.0.0.1"
    cookies = [v for k, v in resp.getheaders() if k.lower() == "set-cookie"]
    assert cookies == ["cf_session=abc; Path=/; HttpOnly", "other=1; Path=/"]
    assert resp.getheader("Cache-Control") is None


def test_status_and_health_are_proxied(servers):
    port, _, _ = servers
    resp, _ = _request(port, "POST", "/api/teapot", body=b"{}")
    assert resp.status == 418
    resp, data = _request(port, "GET", "/health")
    assert resp.status == 200 and json.loads(data)["path"] == "/health"


def test_backend_down_gives_502(servers):
    port, backend, _ = servers
    backend.shutdown()
    backend.server_close()
    resp, data = _request(port, "POST", "/api/auth/login", body=b"{}")
    assert resp.status == 502
    assert resp.getheader("Content-Type").startswith("text/plain")
    assert b"not reachable" in data


@pytest.mark.parametrize("path,proxied", [
    ("/api/me", True), ("/api", True), ("/health", True), ("/health?x=1", True),
    ("/healthz", False), ("/apiary.html", False), ("/index.html", False), ("/", False),
])
def test_is_proxied(path, proxied):
    assert dev_server.is_proxied(path) is proxied
