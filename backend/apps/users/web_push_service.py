"""
Web Push notification service (VAPID / RFC 8292).

No Firebase — pushes go directly from this Django server to the browser
push service (Google FCM for Chrome, Mozilla for Firefox, etc.) using
the standard Web Push Protocol with VAPID authentication.

Requirements:
  - pywebpush >= 2.0.0  (already in requirements.txt)
  - VAPID_PRIVATE_KEY env var  — PEM string of the EC private key
  - VAPID_PUBLIC_KEY  env var  — base64url uncompressed public key (for browser)
  - VAPID_CLAIMS_EMAIL env var — mailto: contact address

Usage:
  from apps.users.web_push_service import send_push_to_user, send_ksef_status_push
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def _get_vapid_private_key() -> str:
    """Return the VAPID private key PEM from settings, or empty string if not configured."""
    return getattr(settings, 'VAPID_PRIVATE_KEY', '') or ''


def send_web_push(subscription, *, title: str, body: str, data: dict | None = None) -> bool:
    """
    Send a single Web Push notification to a `WebPushSubscription` instance.

    Returns True on success, False on failure.
    Stale subscriptions (410 Gone) are deleted automatically by the caller.
    """
    private_key = _get_vapid_private_key()
    if not private_key:
        logger.info(
            "VAPID_PRIVATE_KEY not configured — Web Push disabled. "
            "Set it in environment variables to enable push notifications."
        )
        return False

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed — cannot send Web Push.")
        return False

    payload = json.dumps({
        "title": title,
        "body": body,
        **({"data": data} if data else {}),
    })

    subscription_info = {
        "endpoint": subscription.endpoint,
        "keys": {
            "p256dh": subscription.p256dh,
            "auth": subscription.auth,
        },
    }

    vapid_claims = {
        "sub": getattr(settings, 'VAPID_CLAIMS_EMAIL', 'mailto:admin@mojesaldoo.pl'),
    }

    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=private_key,
            vapid_claims=vapid_claims,
            content_encoding="aes128gcm",
        )
        return True
    except Exception as exc:
        # Check for 410 Gone — subscription expired/unsubscribed
        status_code = None
        if hasattr(exc, 'response') and exc.response is not None:
            status_code = exc.response.status_code
        elif hasattr(exc, 'status_code'):
            status_code = exc.status_code

        if status_code == 410:
            # Signal caller to delete this subscription
            raise _StaleSubscriptionError(subscription.id) from exc

        logger.warning(
            "Web Push failed for subscription %s (status=%s): %s",
            str(subscription.id)[:8],
            status_code,
            exc,
        )
        return False


class _StaleSubscriptionError(Exception):
    """Raised internally when a push endpoint returns 410 Gone."""
    def __init__(self, subscription_id):
        self.subscription_id = subscription_id


def send_push_to_user(user, *, title: str, body: str, data: dict | None = None) -> int:
    """
    Send a Web Push notification to all registered browser subscriptions for `user`.

    Returns the number of successfully sent messages.
    Expired subscriptions (410 Gone) are removed automatically.
    """
    from apps.users.models import WebPushSubscription

    subscriptions = list(WebPushSubscription.objects.filter(user=user))
    if not subscriptions:
        return 0

    sent = 0
    stale_ids = []

    for sub in subscriptions:
        try:
            if send_web_push(sub, title=title, body=body, data=data):
                sent += 1
        except _StaleSubscriptionError as e:
            stale_ids.append(e.subscription_id)
        except Exception as exc:
            logger.warning("Unexpected error sending push to user %s: %s", user.pk, exc)

    if stale_ids:
        deleted, _ = WebPushSubscription.objects.filter(id__in=stale_ids).delete()
        logger.info("Removed %d stale Web Push subscriptions for user %s", deleted, user.pk)

    return sent


def send_ksef_status_push(user, *, invoice_number: str, new_status: str) -> None:
    """Convenience wrapper for KSeF invoice status change notifications."""
    STATUS_MESSAGES = {
        "accepted": ("✅ KSeF: Faktura zaakceptowana", f"Faktura {invoice_number} została zaakceptowana przez KSeF."),
        "rejected": ("❌ KSeF: Faktura odrzucona", f"Faktura {invoice_number} została odrzucona przez KSeF."),
        "sent":     ("📤 KSeF: Faktura wysłana", f"Faktura {invoice_number} została wysłana do KSeF."),
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
