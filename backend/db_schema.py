"""Tables that must exist before auth can persist across sessions."""
from urllib.parse import urlparse, urlunparse

REQUIRED_TABLES = frozenset({
    "users",
    "flags",
    "wishlist_items",
    "password_reset_tokens",
    "user_minors",
    "directory_entries",
    "course_search_counts",
    "schedule_plans",
    "schedule_plan_items",
    "schedule_plan_share_tokens",
    "admin_audit_events",
    "course_overrides",
    "minor_overrides",
    "sign_in_events",
    "user_activity_days",
})


def redact_database_url(url: str) -> str:
    """Return connection URL with password replaced for safe logging."""
    parsed = urlparse(url)
    netloc = parsed.netloc
    if "@" in netloc:
        creds, host = netloc.rsplit("@", 1)
        if ":" in creds:
            user, _password = creds.split(":", 1)
            netloc = f"{user}:***@{host}"
        else:
            netloc = f"{creds}:***@{host}"
    return urlunparse(parsed._replace(netloc=netloc))


def database_host(url: str) -> str:
    """Hostname from DATABASE_URL for /health diagnostics (no password)."""
    parsed = urlparse(url)
    if "@" in parsed.netloc:
        return parsed.netloc.rsplit("@", 1)[1].split("/")[0]
    return parsed.netloc.split("/")[0] if parsed.netloc else ""
