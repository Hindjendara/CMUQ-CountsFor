"""Flask app factory + dev entry point.

Run locally, from the REPO ROOT (not from backend/). This module uses relative
imports, so `python app.py` inside backend/ fails with "attempted relative import
with no known parent package":

    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp backend/.env.example backend/.env   # then fill in GOOGLE_CLIENT_ID etc.
    python -m backend.bootstrap_db         # create the tables once
    python -m backend.app                  # http://localhost:5050

Serve the frontend on port 8765, not 8080: FRONTEND_ORIGIN only allows 8765, and
any other port is rejected by CORS, which the UI reports as "could not reach the
server".

    python3 -m http.server 8765 --directory frontend

Run in production (Render):
    gunicorn --workers=2 --bind 0.0.0.0:$PORT 'backend.app:create_app()'
"""
import os

from flask import Flask, jsonify
from flask_cors import CORS
from sqlalchemy import inspect, text

from .config import Config, recovery_deploy_enabled
from .db import db
from .db_schema import REQUIRED_TABLES, database_host, redact_database_url


def init_database(app: Flask) -> list[str]:
    """Create tables and run additive migrations. Used locally and in Render pre-deploy."""
    with app.app_context():
        from . import models  # noqa: F401 — register tables
        db.create_all()
        from .migrate import run_migrations
        return run_migrations()


def create_app(config_class=Config, *, bootstrap_db: bool | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    if bootstrap_db is None:
        bootstrap_db = os.environ.get("SKIP_DB_BOOTSTRAP", "").lower() not in (
            "1",
            "true",
            "yes",
        )
    if bootstrap_db:
        init_database(app)

    # CORS — cookies + bearer token auth from GitHub Pages
    CORS(
        app,
        resources={r"/api/*": {
            "origins": app.config["FRONTEND_ORIGINS"],
            "supports_credentials": True,
            "allow_headers": ["Content-Type", "Authorization"],
        }},
    )

    # Blueprints
    from .auth import bp as auth_bp
    from .flags import bp as flags_bp
    from .wishlist import bp as wishlist_bp
    from .users import bp as users_bp
    from .directory_routes import bp as directory_bp
    from .search_analytics import bp as search_analytics_bp
    from .plans import bp as plans_bp
    from .admin import bp as admin_bp
    from .course_overrides import bp as course_overrides_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(flags_bp)
    app.register_blueprint(wishlist_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(directory_bp)
    app.register_blueprint(search_analytics_bp)
    app.register_blueprint(plans_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(course_overrides_bp)

    # Health check (Render pings this). Fails if Postgres tables are missing.
    @app.route("/health")
    def health():
        uri = app.config.get("SQLALCHEMY_DATABASE_URI") or ""
        db_target = redact_database_url(uri) if uri else ""
        db_host = database_host(uri) if uri else ""
        if uri.startswith("sqlite"):
            return jsonify(status="ok", database="sqlite", db_host="sqlite")
        try:
            with app.app_context():
                db.session.execute(text("SELECT 1"))
                present = set(inspect(db.engine).get_table_names())
                missing = REQUIRED_TABLES - present
                if missing:
                    body = dict(
                        status="degraded",
                        database="missing_tables",
                        db_host=db_host,
                        db_target=db_target,
                        missing=sorted(missing),
                    )
                    return jsonify(body), 200 if recovery_deploy_enabled() else 503
                return jsonify(
                    status="ok",
                    database="connected",
                    db_host=db_host,
                    tables=len(present),
                )
        except Exception as exc:
            body = dict(
                status="degraded",
                database="error",
                db_host=db_host,
                message=str(exc),
            )
            return jsonify(body), 200 if recovery_deploy_enabled() else 503

    # Friendly 404 in JSON shape
    @app.errorhandler(404)
    def not_found(_e):
        return jsonify(error="not_found", message="Route not found."), 404

    return app


if __name__ == "__main__":
    # Local dev only — production uses gunicorn via the Procfile.
    application = create_app()
    application.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        # 5050, not 5000 — macOS AirPlay Receiver squats on 5000 and answers 403.
        port=int(os.environ.get("PORT", "5050")),
        debug=os.environ.get("FLASK_DEBUG", "1") == "1",
    )
