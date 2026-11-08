"""One-shot database bootstrap: create missing tables, run migrations, verify.

    python -m backend.bootstrap_db      (from the folder that holds the backend package)

In production systemd runs it before gunicorn starts (ExecStartPre), so workers
do not race on ALTER TABLE; the workers themselves skip it (SKIP_DB_BOOTSTRAP=1).
Safe to rerun: create_all() only adds missing tables and migrations are idempotent.
"""
from __future__ import annotations

import sys

from sqlalchemy import inspect, text

from .config import is_production
from .app import create_app, init_database
from .db import db
from .db_schema import REQUIRED_TABLES, redact_database_url


def verify_bootstrap(app) -> None:
    """Fail loudly unless required tables exist in the connected database."""
    with app.app_context():
        uri = app.config["SQLALCHEMY_DATABASE_URI"]
        print(f"Database target: {redact_database_url(uri)}")

        if not uri.startswith("postgresql"):
            if is_production():
                print(
                    f"FATAL: FLASK_ENV=production expects PostgreSQL but DATABASE_URL is "
                    f"{redact_database_url(uri)!r}.",
                    file=sys.stderr,
                )
                raise SystemExit(1)
            print(
                "WARNING: local SQLite bootstrap. Tables created for dev only. "
                "To bootstrap PostgreSQL, set DATABASE_URL and re-run.",
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


if __name__ == "__main__":
    main()
