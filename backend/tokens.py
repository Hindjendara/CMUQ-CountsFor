"""Signed bearer tokens, the frontend's main credential.

Login and register return `auth_token`; js/api.js stores it (sessionStorage, or
localStorage with "Keep me signed in") and sends `Authorization: Bearer ...` on
every API call. Sign-in also sets the session cookie, which is first-party now
that the site and the API share one origin, but the token stays because the
frontend relies on it: where it is stored decides how long a sign-in lasts (the
tab only, or 30 days), and it also works when a page calls the API from another
origin (the cf_backend_override debugging hook).
Signed with SECRET_KEY, so changing the key signs everyone out.
"""
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from flask import current_app

SALT = "cf-auth-token"
MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days — match session lifetime


def make_auth_token(user_id: int) -> str:
    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=SALT)
    return serializer.dumps({"uid": user_id})


def verify_auth_token(token: str) -> int | None:
    if not token or not token.strip():
        return None
    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=SALT)
    try:
        data = serializer.loads(token.strip(), max_age=MAX_AGE_SECONDS)
        return int(data["uid"])
    except (BadSignature, SignatureExpired, ValueError, TypeError, KeyError):
        return None
