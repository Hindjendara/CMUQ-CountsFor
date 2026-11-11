"""Role-based authorization — always key off role_group, not job title.

role_group values:
  student — student
  faculty — advisor, professor, area_head, associate_area_head (identical permissions)
  admin   — admin (faculty permissions + user management)
"""
from functools import wraps
from typing import Iterable

from flask import jsonify, request, session, g

from .db import db
from .models import User, FACULTY_ROLES
from .tokens import verify_auth_token

ROLE_GROUP_STUDENT = "student"
ROLE_GROUP_FACULTY = "faculty"
ROLE_GROUP_ADMIN = "admin"

# Exact role strings still used where a specific title matters (e.g. flag review).
FACULTY_OR_ADMIN = FACULTY_ROLES | {ROLE_GROUP_ADMIN}


def _load_user() -> User | None:
    if hasattr(g, "_current_user"):
        return g._current_user
    user = None
    uid = session.get("uid")
    if uid:
        user = db.session.get(User, uid)
    if user is None:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token_uid = verify_auth_token(auth[7:])
            if token_uid:
                user = db.session.get(User, token_uid)
    g._current_user = user
    return user


def require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = _load_user()
        if user is None:
            return jsonify(error="unauthenticated", message="Sign in required."), 401
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def require_role_group(*groups: str | Iterable[str]):
    """403 unless the user's role_group is in `groups`."""
    if len(groups) == 1 and not isinstance(groups[0], str):
        allowed = set(groups[0])
    else:
        allowed = set(groups)

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = _load_user()
            if user is None:
                return jsonify(error="unauthenticated", message="Sign in required."), 401
            if user.role_group() not in allowed:
                return jsonify(
                    error="forbidden",
                    message=f"This action requires role_group: {', '.join(sorted(allowed))}.",
                ), 403
            g.user = user
            return fn(*args, **kwargs)
        return wrapper

    return decorator


def require_role(*roles: str | Iterable[str]):
    """403 unless the user's exact role string is in `roles` (narrow checks only)."""
    if len(roles) == 1 and not isinstance(roles[0], str):
        allowed = set(roles[0])
    else:
        allowed = set(roles)

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = _load_user()
            if user is None:
                return jsonify(error="unauthenticated", message="Sign in required."), 401
            if user.role not in allowed:
                return jsonify(
                    error="forbidden",
                    message=f"This action requires one of: {', '.join(sorted(allowed))}.",
                ), 403
            g.user = user
            return fn(*args, **kwargs)
        return wrapper

    return decorator


def current_user() -> User | None:
    return _load_user()


def is_admin(user: User | None) -> bool:
    """True for a signed-in user in the admin role group (for public routes that show admins more)."""
    return user is not None and user.role_group() == ROLE_GROUP_ADMIN
