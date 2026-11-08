"""Local development server that mirrors production.

In production Apache serves frontend/ and proxies /api to gunicorn on the same
origin, so the browser calls the API with relative paths (js/api.js). This
script does the same on your machine: it serves frontend/ and forwards /api/*
and /health to the Flask dev server.

Run from the repo root, with the backend running in another terminal:

    python -m backend.app              # Flask API on http://127.0.0.1:5050
    python scripts/dev_server.py       # site on http://localhost:8765

Options: --port (default 8765), --bind (default localhost: both 127.0.0.1 and
::1, because some clients resolve localhost only to ::1), --backend (default
http://127.0.0.1:5050), --root (default <repo>/frontend).

Standard library only. Proxied requests keep their method, path, query string,
headers (Authorization and Cookie included) and body; the response comes back
with its status, headers (every Set-Cookie included) and body. If the backend is
not running, /api answers 502 with a plain-text body, like Apache does when
gunicorn is down. A chunked request body is decoded and forwarded with a
Content-Length (browsers send Content-Length anyway for the API's JSON bodies).
"""
from __future__ import annotations

import argparse
import http.client
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = REPO_ROOT / "frontend"

# Hop-by-hop headers (RFC 9110 section 7.6.1) apply to one connection only and
# are never forwarded. Content-Length is recomputed for the bytes we send.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "trailers", "transfer-encoding", "upgrade", "content-length",
}


def is_proxied(path: str) -> bool:
    """True for /api, /api/... and /health (what production sends to gunicorn)."""
    route = urlsplit(path).path
    return route in ("/api", "/health") or route.startswith("/api/")


class DevHandler(SimpleHTTPRequestHandler):
    backend: tuple[str, int] = ("127.0.0.1", 5050)
    backend_timeout = 60

    # ── Static files ──────────────────────────────────────────
    def end_headers(self):
        # Production sends "no-cache" for html/json/js/css (revalidate every time);
        # doing the same here means an edited file always shows up on reload.
        if not getattr(self, "_proxying", False):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ── Proxy ─────────────────────────────────────────────────
    def _proxy(self):
        self._proxying = True
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            # Transfer-Encoding is hop-by-hop and not forwarded, so decode the
            # body here; otherwise Flask would get an empty request.
            try:
                body = self._read_chunked()
            except ValueError:
                self.send_error(400, "Malformed chunked request body")
                return
        else:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None

        headers = {}
        for name, value in self.headers.items():
            if name.lower() in HOP_BY_HOP or name.lower() == "host":
                continue
            # Several headers of one name (rare in requests) are joined, as RFC 9110 allows,
            # except Cookie, which uses "; ".
            if name in headers:
                sep = "; " if name.lower() == "cookie" else ", "
                headers[name] = headers[name] + sep + value
            else:
                headers[name] = value
        host, port = self.backend
        # Same headers Apache adds (ProxyPreserveHost On + mod_proxy's X-Forwarded-*).
        headers["Host"] = self.headers.get("Host", f"{host}:{port}")
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["X-Forwarded-Proto"] = "http"
        headers["X-Forwarded-Host"] = self.headers.get("Host", "")
        if body is not None:
            headers["Content-Length"] = str(len(body))

        conn = http.client.HTTPConnection(host, port, timeout=self.backend_timeout)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
        except OSError as exc:
            conn.close()
            msg = f"Bad gateway: backend http://{host}:{port} is not reachable ({exc}).\n".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(msg)
            return
        conn.close()

        self.send_response(resp.status, resp.reason)
        for name, value in resp.getheaders():  # keeps repeated headers such as Set-Cookie
            if name.lower() in HOP_BY_HOP or name.lower() in ("server", "date"):
                continue
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _read_chunked(self) -> bytes:
        """The body of a Transfer-Encoding: chunked request (RFC 9112 section 7.1)."""
        parts = []
        while True:
            line = self.rfile.readline(65537)
            size = int(line.split(b";", 1)[0].strip() or b"x", 16)  # ValueError if malformed
            if size == 0:
                while self.rfile.readline(65537) not in (b"\r\n", b"\n", b""):
                    pass  # trailer fields, dropped
                return b"".join(parts)
            data = self.rfile.read(size)
            if len(data) != size or self.rfile.readline(65537) not in (b"\r\n", b"\n"):
                raise ValueError("truncated chunk")
            parts.append(data)

    def _dispatch(self, static_method=None):
        self._proxying = False
        if is_proxied(self.path):
            return self._proxy()
        if static_method is None:
            self.send_error(405, "Method not allowed for static files")
            return
        return static_method()

    def do_GET(self):
        self._dispatch(super().do_GET)

    def do_HEAD(self):
        self._dispatch(super().do_HEAD)

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_PATCH(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def do_OPTIONS(self):
        self._dispatch()


def parse_backend(url: str) -> tuple[str, int]:
    parts = urlsplit(url if "//" in url else "http://" + url)
    if parts.scheme != "http" or not parts.hostname:
        raise SystemExit(f"--backend must be an http:// URL, got {url!r}")
    return parts.hostname, parts.port or 80


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def make_servers(bind: str, port: int, handler) -> list[ThreadingHTTPServer]:
    """One server per listening address. "localhost" means both loopback
    addresses on the same port: browsers try both, but some tools (Node's fetch,
    for one) resolve localhost only to ::1 on some machines."""
    if bind != "localhost":
        cls = IPv6Server if ":" in bind else ThreadingHTTPServer
        return [cls((bind, port), handler)]
    servers = [ThreadingHTTPServer(("127.0.0.1", port), handler)]
    try:
        servers.append(IPv6Server(("::1", servers[0].server_address[1]), handler))
    except OSError:
        pass  # no IPv6 loopback: 127.0.0.1 alone
    return servers


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--bind", default="localhost")
    ap.add_argument("--backend", default="http://127.0.0.1:5050")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not (root / "index.html").is_file():
        print(f"error: {root} has no index.html", file=sys.stderr)
        return 2
    DevHandler.backend = parse_backend(args.backend)
    handler = partial(DevHandler, directory=str(root))
    servers = make_servers(args.bind, args.port, handler)
    host, port = DevHandler.backend
    listening = ", ".join(
        f"[{s.server_address[0]}]" if ":" in s.server_address[0] else s.server_address[0]
        for s in servers)
    shown = "localhost" if args.bind == "localhost" else listening
    print(f"Serving {root} on http://{shown}:{servers[0].server_address[1]}/ "
          f"(listening on {listening}) ; /api and /health -> http://{host}:{port}")
    for extra in servers[1:]:
        threading.Thread(target=extra.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for s in servers:
            if s is not servers[0]:
                s.shutdown()
            s.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
