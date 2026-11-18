"""Print a one-time link that sets the password of an account (password sign-in).

For whoever runs the server: it lets a person in when no email provider is
configured and Google sign-in is not available, for example the first admin on
a new server. Having a shell on the server is the proof of authority; the link
itself works like the one the Forgot password email carries (POST
/api/auth/reset-password), expires after RESET_TOKEN_MINUTES (30 by default)
and works once. Send it to the person privately.

On the server (README 19.7):

    sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; \\
      cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.reset_link spessoa@andrew.cmu.edu'

If the email has no account yet, a student account is created with no password;
the role comes from the directory when the person signs in (README 7.1), so a
person in directory_admins.json becomes admin at that sign-in. Refused when
AUTH_MODE=shibboleth: CMU sign-in has no passwords.
"""
from __future__ import annotations

import argparse
import sys


def make_reset_link(email: str, name: str | None = None) -> tuple[str, bool, int]:
    """Return (link, created, minutes) for `email`. Needs an app context."""
    from flask import current_app

    from .auth import _create_reset_token, _email_allowed, _frontend_reset_url, auth_mode
    from .cmu import normalize_cmu_email
    from .db import db
    from .models import User

    if auth_mode() == "shibboleth":
        raise ValueError("AUTH_MODE is shibboleth: people sign in with their Andrew ID, there are no passwords.")
    address = normalize_cmu_email(email or "")
    if not address or not _email_allowed(address):
        allowed = current_app.config.get("ALLOWED_EMAIL_DOMAIN") or "andrew.cmu.edu"
        raise ValueError(f"Not an @{allowed} address: {email!r}.")
    user = db.session.query(User).filter_by(email=address).one_or_none()
    created = user is None
    if created:
        display = (name or "").strip() or address.split("@", 1)[0].replace(".", " ").title()
        user = User(email=address, name=display, role="student")
        db.session.add(user)
        db.session.commit()
    token = _create_reset_token(user)
    minutes = int(current_app.config.get("RESET_TOKEN_MINUTES") or 30)
    return _frontend_reset_url(token), created, minutes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print a one-time link that sets the password of an account.")
    parser.add_argument("email", help="the person's @andrew.cmu.edu address")
    parser.add_argument("--name", help="display name for a new account (default: from the address)")
    args = parser.parse_args(argv)

    from .app import create_app
    app = create_app(bootstrap_db=False)
    with app.app_context():
        try:
            link, created, minutes = make_reset_link(args.email, args.name)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
    if created:
        print("No account existed for this address: created a student account with no password.")
        print("Its role comes from the directory when the person signs in.")
    print(f"One-time link, valid for {minutes} minutes. Send it to the person privately:")
    print(link)
    return 0


if __name__ == "__main__":
    sys.exit(main())
