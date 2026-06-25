"""
Firebase Cloud Messaging (FCM) push notification service.

Usage:
  from apps.users.push_service import send_push_to_user

Requires:
  - `firebase-admin` installed: pip install firebase-admin
  - FIREBASE_SERVICE_ACCOUNT_JSON set in environment (path to serviceAccountKey.json)
    OR FIREBASE_CREDENTIALS_JSON set to the JSON content directly.

If firebase-admin is not installed or not configured, calls are silently no-ops
so the rest of the app works without the SDK in development.
"""

import json
import logging
import os
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

_fcm_initialized = False
_fcm_available = False


def _init_firebase() -> bool:
    """Initialize Firebase Admin SDK once. Returns True if available."""
    global _fcm_initialized, _fcm_available  # noqa: PLW0603
    if _fcm_initialized:
        return _fcm_available
    _fcm_initialized = True

    try:
        import firebase_admin  # noqa: F401 — lazy import to allow missing SDK
        from firebase_admin import credentials, initialize_app
    except ImportError:
        logger.info(
            "firebase-admin not installed — push notifications disabled. "
            "Run: pip install firebase-admin"
        )
        return False

    # Already initialized (e.g. multiple calls during tests)
    if firebase_admin._apps:
        _fcm_available = True
        return True

    # Prefer JSON content from env (CI/prod secrets); fall back to file path.
    creds_json = os.environ.get("FIREBASE_CREDENTIALS_JSON", "")
    creds_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")

    if creds_json:
        try:
            cred = credentials.Certificate(json.loads(creds_json))
        except Exception as exc:
            logger.error("Failed to parse FIREBASE_CREDENTIALS_JSON: %s", exc)
            return False
    elif creds_path and os.path.exists(creds_path):
        try:
            cred = credentials.Certificate(creds_path)
        except Exception as exc:
            logger.error("Failed to load Firebase credentials from %s: %s", creds_path, exc)
            return False
    else:
        logger.info(
            "Firebase credentials not configured — push notifications disabled. "
            "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CREDENTIALS_JSON."
        )
        return False

    try:
        initialize_app(cred)
        _fcm_available = True
        logger.info("Firebase Admin SDK initialized successfully.")
        return True
    except Exception as exc:
        logger.error("Firebase Admin SDK initialization failed: %s", exc)
        return False


def send_push_to_user(
    user,
    *,
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """
    Send an FCM push notification to all registered devices for `user`.

    Returns the number of messages successfully sent (0 if FCM not configured).
    Stale tokens (no longer registered) are automatically deleted.
    """
    if not _init_firebase():
        return 0

    from firebase_admin import messaging
    from apps.users.models import FCMDeviceToken

    tokens_qs = FCMDeviceToken.objects.filter(user=user).values_list("token", flat=True)
    tokens = list(tokens_qs)
    if not tokens:
        return 0

    messages = [
        messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            token=token,
        )
        for token in tokens
    ]

    sent_count = 0
    stale_tokens: list[str] = []

    for msg, token in zip(messages, tokens):
        try:
            messaging.send(msg)
            sent_count += 1
        except messaging.UnregisteredError:
            stale_tokens.append(token)
        except Exception as exc:
            logger.warning("FCM send failed for token %s…: %s", token[:20], exc)

    if stale_tokens:
        deleted, _ = FCMDeviceToken.objects.filter(token__in=stale_tokens).delete()
        logger.info("Removed %d stale FCM tokens for user %s", deleted, user.pk)

    return sent_count


def send_ksef_status_push(user, *, invoice_number: str, new_status: str) -> None:
    """Convenience wrapper for KSeF invoice status change notifications."""
    STATUS_MESSAGES = {
        "accepted": ("KSeF: Faktura zaakceptowana", f"Faktura {invoice_number} została zaakceptowana przez KSeF."),
        "rejected": ("KSeF: Faktura odrzucona", f"Faktura {invoice_number} została odrzucona przez KSeF."),
        "sent":     ("KSeF: Faktura wysłana", f"Faktura {invoice_number} została wysłana do KSeF."),
    }
    entry = STATUS_MESSAGES.get(new_status)
    if not entry:
        return
    title, body = entry
    send_push_to_user(
        user,
        title=title,
        body=body,
        data={"ksef_status": new_status, "invoice_number": invoice_number},
    )
