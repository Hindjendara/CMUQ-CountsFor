"""One-shot database bootstrap for Render pre-deploy.

Render runs this once before gunicorn starts so workers do not race on
ALTER TABLE and the web process can bind to $PORT immediately.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import inspect, text

from .config import recovery_deploy_enabled
from .app import create_app, init_database
from .db import db
from .db_schema import REQUIRED_TABLES, redact_database_url


def verify_bootstrap(app) -> None:
    """Fail loudly unless required tables exist in the connected database."""
    with app.app_context():
        uri = app.config["SQLALCHEMY_DATABASE_URI"]
        print(f"Database target: {redact_database_url(uri)}")

        on_render = os.environ.get("RENDER", "").lower() == "true"
        is_production = os.environ.get("FLASK_ENV", "").strip().lower() == "production"

        if not uri.startswith("postgresql"):
            if on_render or is_production:
                print(
                    f"FATAL: bootstrap expected PostgreSQL but got {uri!r}. "
                    "Link DATABASE_URL to CountsFor_Summer_2026 on Render.",
                    file=sys.stderr,
                )
                raise SystemExit(1)
            print(
                "WARNING: local SQLite bootstrap. Tables created for dev only. "
                "To bootstrap Render Postgres, set DATABASE_URL in backend/.env "
                "(External URL from CountsFor_Summer_2026) and re-run.",
                file=sys.stderr,
            )

        dialect = db.engine.dialect.name
        print(f"Database dialect: {dialect}")

        present = set(inspect(db.engine).get_table_names())
        missing = REQUIRED_TABLES - present
        if missing:
            print(
                f"FATAL: bootstrap verification failed. Missing tables: {sorted(missing)}",
                file=sys.stderr,
            )
            raise SystemExit(1)

        found = sorted(REQUIRED_TABLES & present)
        print(f"Required tables present ({len(found)}): {', '.join(found)}")

        db.session.execute(text("SELECT 1"))
        db.session.commit()


def main() -> None:
    try:
        app = create_app(bootstrap_db=False)
        logs = init_database(app)
        for line in logs:
            print(line)
        verify_bootstrap(app)
        uri = app.config["SQLALCHEMY_DATABASE_URI"]
        if uri.startswith("postgresql"):
            print("Database bootstrap OK")
        else:
            print("Database bootstrap OK (local SQLite, not production Postgres)")
    except SystemExit as exc:
        if exc.code and recovery_deploy_enabled():
            print(
                "WARNING: bootstrap failed but ALLOW_BOOTSTRAP_SKIP=1, so the deploy continues. "
                "Upgrade Postgres to Starter, remove ALLOW_BOOTSTRAP_SKIP, redeploy.",
                file=sys.stderr,
            )
            return
        raise
    except Exception as exc:
        if recovery_deploy_enabled():
            print(
                f"WARNING: bootstrap skipped ({exc}). Upgrade Postgres, then redeploy without ALLOW_BOOTSTRAP_SKIP.",
                file=sys.stderr,
            )
            return
        raise


if __name__ == "__main__":
    main()
