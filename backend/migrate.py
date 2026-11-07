"""Safe additive migrations for existing deploys.

SQLAlchemy `create_all()` only creates missing tables; it does not add columns.
This module runs idempotent ALTER TABLE steps so SQLite (local) and Postgres
(production / Supabase) stay in sync without Alembic.
"""
from sqlalchemy import inspect, text

from .db import db


def _column_names(table: str) -> set[str]:
    insp = inspect(db.engine)
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _add_column_if_missing(table: str, column: str, ddl_sqlite: str, ddl_pg: str | None = None) -> bool:
    """Return True if the column was added."""
    if column in _column_names(table):
        return False
    dialect = db.engine.dialect.name
    ddl = (ddl_pg or ddl_sqlite) if dialect == "postgresql" else ddl_sqlite
    db.session.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
    db.session.commit()
    return True


def _table_exists(table: str) -> bool:
    return table in inspect(db.engine).get_table_names()


def _ensure_password_reset_tokens_table() -> bool:
    """Create password_reset_tokens on deploys that ran create_all before the model existed."""
    if _table_exists("password_reset_tokens"):
        return False
    dialect = db.engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE password_reset_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """
    else:
        ddl = """
            CREATE TABLE password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """
    db.session.execute(text(ddl))
    db.session.execute(text("CREATE INDEX ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)"))
    db.session.execute(text("CREATE INDEX ix_password_reset_tokens_token_hash ON password_reset_tokens (token_hash)"))
    db.session.execute(text("CREATE INDEX ix_password_reset_tokens_user_used ON password_reset_tokens (user_id, used)"))
    db.session.commit()
    return True


def run_migrations() -> list[str]:
    """Apply pending migrations. Returns human-readable log lines."""
    log: list[str] = []

    if _ensure_password_reset_tokens_table():
        log.append("Created password_reset_tokens table")

    if _add_column_if_missing(
        "users", "last_login", "last_login TIMESTAMP", "last_login TIMESTAMPTZ"
    ):
        log.append("Added users.last_login")

    if _add_column_if_missing(
        "users",
        "is_admin",
        "is_admin BOOLEAN NOT NULL DEFAULT 0",
        "is_admin BOOLEAN NOT NULL DEFAULT FALSE",
    ):
        log.append("Added users.is_admin")
        # Backfill admin flag from role
        db.session.execute(text("UPDATE users SET is_admin = 1 WHERE role = 'admin'"))
        db.session.commit()
        log.append("Backfilled users.is_admin from role")

    if _add_column_if_missing("users", "department", "department VARCHAR(200)"):
        log.append("Added users.department")
        if "department_scope" in _column_names("users"):
            db.session.execute(
                text("UPDATE users SET department = department_scope WHERE department IS NULL AND department_scope IS NOT NULL")
            )
            db.session.commit()
            log.append("Copied department_scope into department where empty")

    if _add_column_if_missing(
        "users",
        "profile_completed",
        "profile_completed BOOLEAN NOT NULL DEFAULT 0",
        "profile_completed BOOLEAN NOT NULL DEFAULT FALSE",
    ):
        log.append("Added users.profile_completed")
        # Existing rows with a complete profile should skip onboarding next login.
        db.session.execute(text("""
            UPDATE users SET profile_completed = 1 WHERE
              role = 'admin'
              OR (role = 'student' AND primary_program IS NOT NULL AND primary_program != '')
              OR (role = 'professor' AND primary_program IS NOT NULL)
              OR (role IN ('area_head', 'associate_area_head') AND (
                    primary_program IS NOT NULL OR primary_program IS NULL
                  ))
              OR (role = 'advisor' AND advisor_scope IS NOT NULL)
        """))
        db.session.commit()
        log.append("Backfilled users.profile_completed for existing complete profiles")

    if _add_column_if_missing("users", "password_hash", "password_hash VARCHAR(255)"):
        log.append("Added users.password_hash")

    if _add_column_if_missing("users", "reset_token_hash", "reset_token_hash VARCHAR(255)"):
        log.append("Added users.reset_token_hash")

    if _add_column_if_missing(
        "users", "reset_token_expires", "reset_token_expires TIMESTAMP", "reset_token_expires TIMESTAMPTZ"
    ):
        log.append("Added users.reset_token_expires")

    if _ensure_user_minors_table():
        log.append("Created user_minors table")
        dialect = db.engine.dialect.name
        if dialect == "postgresql":
            db.session.execute(text("""
                INSERT INTO user_minors (user_id, minor_code, added_at)
                SELECT id, minor_code, COALESCE(updated_at, created_at, NOW())
                FROM users
                WHERE minor_code IS NOT NULL AND minor_code != ''
                ON CONFLICT DO NOTHING
            """))
        else:
            db.session.execute(text("""
                INSERT OR IGNORE INTO user_minors (user_id, minor_code, added_at)
                SELECT id, minor_code, COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
                FROM users
                WHERE minor_code IS NOT NULL AND minor_code != ''
            """))
        db.session.commit()
        log.append("Backfilled user_minors from users.minor_code")

    if _ensure_directory_entries_table():
        log.append("Created directory_entries table")

    if _add_column_if_missing("users", "picture_url", "picture_url VARCHAR(512)"):
        log.append("Added users.picture_url")

    if _migrate_staff_to_directory_entries():
        log.append("Migrated staff_directory_entries → directory_entries")

    if _add_column_if_missing("wishlist_items", "note", "note TEXT"):
        log.append("Added wishlist_items.note")

    backfilled = _backfill_sign_in_history()
    if backfilled:
        log.append(f"Backfilled {backfilled} sign-in events from users.last_login")

    return log


def _backfill_sign_in_history() -> int:
    """Seed sign-in analytics from users.last_login, once.

    Sign-in tracking (sign_in_events, user_activity_days) started after people
    were already using CountsFor. The only history we have is each user's most
    recent login, so the first deploy turns that into one event per user with
    method "before_tracking". Skipped whenever sign_in_events already has rows.
    """
    if not (_table_exists("sign_in_events") and _table_exists("user_activity_days")):
        return 0
    from .activity import local_day
    from .models import SignInEvent, User, UserActivityDay

    if db.session.query(SignInEvent.id).first() is not None:
        return 0
    users = db.session.query(User).filter(User.last_login.isnot(None)).all()
    for u in users:
        db.session.add(SignInEvent(user_id=u.id, method="before_tracking", created_at=u.last_login))
        db.session.add(UserActivityDay(
            user_id=u.id, day=local_day(u.last_login), visits=0, sign_ins=1,
            first_seen=u.last_login, last_seen=u.last_login,
        ))
    db.session.commit()
    return len(users)


def _migrate_staff_to_directory_entries() -> bool:
    if not _table_exists("staff_directory_entries") or not _table_exists("directory_entries"):
        return False
    existing = db.session.execute(text("SELECT COUNT(*) FROM directory_entries")).scalar() or 0
    if existing > 0:
        return False
    dialect = db.engine.dialect.name
    if dialect == "postgresql":
        db.session.execute(text("""
            INSERT INTO directory_entries (email, name, role, added_by_id, created_at, updated_at)
            SELECT email, name, role, added_by_id, created_at, created_at
            FROM staff_directory_entries
            ON CONFLICT (email) DO NOTHING
        """))
    else:
        db.session.execute(text("""
            INSERT OR IGNORE INTO directory_entries (email, name, role, added_by_id, created_at, updated_at)
            SELECT email, name, role, added_by_id, created_at, created_at
            FROM staff_directory_entries
        """))
    db.session.commit()
    return True


def _ensure_directory_entries_table() -> bool:
    if _table_exists("directory_entries"):
        return False
    dialect = db.engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE directory_entries (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                name VARCHAR(200) NOT NULL,
                role VARCHAR(32) NOT NULL DEFAULT 'professor',
                department VARCHAR(200),
                primary_program VARCHAR(8),
                picture_url VARCHAR(512),
                added_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """
    else:
        ddl = """
            CREATE TABLE directory_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(255) NOT NULL UNIQUE,
                name VARCHAR(200) NOT NULL,
                role VARCHAR(32) NOT NULL DEFAULT 'professor',
                department VARCHAR(200),
                primary_program VARCHAR(8),
                picture_url VARCHAR(512),
                added_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """
    db.session.execute(text(ddl))
    db.session.execute(text("CREATE INDEX ix_directory_entries_email ON directory_entries (email)"))
    db.session.commit()
    return True


def _ensure_user_minors_table() -> bool:
    if _table_exists("user_minors"):
        return False
    dialect = db.engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE user_minors (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                minor_code VARCHAR(32) NOT NULL,
                added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_user_minor_code UNIQUE (user_id, minor_code)
            )
        """
    else:
        ddl = """
            CREATE TABLE user_minors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                minor_code VARCHAR(32) NOT NULL,
                added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, minor_code)
            )
        """
    db.session.execute(text(ddl))
    db.session.execute(text("CREATE INDEX ix_user_minors_user_id ON user_minors (user_id)"))
    db.session.commit()
    return True
