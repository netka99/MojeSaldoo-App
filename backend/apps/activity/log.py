"""
Thin helper for writing ActivityLog entries.

Designed to never raise — a logging failure must never crash the main request.
"""

import logging

logger = logging.getLogger(__name__)


def log_activity(
    *,
    user,
    action: str,
    status: str,
    object_type: str = "",
    object_id: str = "",
    error_code: str = "",
    error_detail: str = "",
    request=None,
) -> None:
    """
    Write an ActivityLog entry scoped to user.current_company.

    All arguments are keyword-only to prevent positional mistakes.
    Silently no-ops if the user has no current_company (e.g. during onboarding).

    Pass request= when logging an error explicitly so the activity middleware
    knows this request has already been logged and skips it (prevents duplicates).
    """
    from .models import ActivityLog

    company = getattr(user, "current_company", None)
    if company is None:
        return

    try:
        ActivityLog.objects.create(
            company=company,
            user=user,
            action=action,
            status=status,
            object_type=object_type,
            object_id=str(object_id)[:64],
            error_code=error_code,
            error_detail=str(error_detail)[:1024],
        )
        # Mark request so middleware does not create a duplicate entry.
        if request is not None:
            request._activity_logged = True
    except Exception:
        logger.exception("Failed to write ActivityLog (action=%s)", action)
