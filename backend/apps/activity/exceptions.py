"""
Custom DRF exception handler — catch-all for unexpected server errors (5xx).

Wires into REST_FRAMEWORK['EXCEPTION_HANDLER'] in settings.py.
4xx business errors are handled explicitly with log_activity() at each call site.
"""

import logging

from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def activity_exception_handler(exc, context):
    """
    Delegates to DRF's default handler first, then logs any 5xx response
    to ActivityLog so server errors appear in the user-visible activity log.
    """
    response = drf_exception_handler(exc, context)

    if response is not None and response.status_code >= 500:
        _log_server_error(exc, context)

    return response


def _log_server_error(exc, context):
    try:
        from .log import log_activity
        from .models import ActivityLog

        request = context.get("request")
        if not request:
            return
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return

        log_activity(
            user=user,
            action="server.error",
            status=ActivityLog.STATUS_ERROR,
            error_code="SERVER_ERROR",
            error_detail=f"{type(exc).__name__}: {exc}",
        )
    except Exception:
        # Never let logging crash the response
        logger.exception("activity_exception_handler: failed to write ActivityLog")
