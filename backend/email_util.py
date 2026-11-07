"""Transactional email for password reset.

Provider priority:
  1. Resend API when RESEND_API_KEY is set
  2. SMTP when SMTP_HOST is set
  3. Otherwise log and return False (caller may expose token in dev)
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from flask import current_app

log = logging.getLogger(__name__)


def _send_via_resend(to_email: str, subject: str, text_body: str, html_body: str) -> bool:
    api_key = (current_app.config.get("RESEND_API_KEY") or "").strip()
    mail_from = (current_app.config.get("MAIL_FROM") or "").strip()
    if not api_key or not mail_from:
        return False
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": mail_from,
                "to": [to_email],
                "subject": subject,
                "text": text_body,
                "html": html_body,
            },
            timeout=15,
        )
        if resp.status_code >= 400:
            log.error("Resend API error %s: %s", resp.status_code, resp.text[:500])
            return False
        return True
    except requests.RequestException as exc:
        log.error("Resend request failed: %s", exc)
        return False


def _send_via_smtp(to_email: str, subject: str, text_body: str, html_body: str) -> bool:
    host = (current_app.config.get("SMTP_HOST") or "").strip()
    if not host:
        return False
    port = int(current_app.config.get("SMTP_PORT") or 587)
    user = (current_app.config.get("SMTP_USER") or "").strip()
    password = current_app.config.get("SMTP_PASS") or ""
    mail_from = (current_app.config.get("MAIL_FROM") or user or "").strip()
    if not mail_from:
        log.error("SMTP configured but MAIL_FROM is empty")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.ehlo()
            if current_app.config.get("SMTP_USE_TLS", True):
                smtp.starttls()
                smtp.ehlo()
            if user:
                smtp.login(user, password)
            smtp.sendmail(mail_from, [to_email], msg.as_string())
        return True
    except OSError as exc:
        log.error("SMTP send failed: %s", exc)
        return False


def send_password_reset_email(to_email: str, reset_url: str) -> bool:
    """Send the reset link. Returns True when an provider accepted the message."""
    subject = "Reset your CountsFor password"
    text_body = (
        "You requested a password reset for CountsFor (CMU-Q Curriculum Explorer).\n\n"
        f"Open this link to choose a new password (expires in "
        f"{current_app.config.get('RESET_TOKEN_MINUTES', 30)} minutes):\n\n"
        f"{reset_url}\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = (
        "<p>You requested a password reset for <strong>CountsFor</strong> "
        "(CMU-Q Curriculum Explorer).</p>"
        f"<p><a href=\"{reset_url}\">Reset your password</a></p>"
        f"<p>This link expires in {current_app.config.get('RESET_TOKEN_MINUTES', 30)} minutes.</p>"
        "<p>If you did not request this, you can ignore this email.</p>"
    )

    if _send_via_resend(to_email, subject, text_body, html_body):
        return True
    if _send_via_smtp(to_email, subject, text_body, html_body):
        return True
    log.warning("No email provider configured: password reset email not sent to %s", to_email)
    return False
