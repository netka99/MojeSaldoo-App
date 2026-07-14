"""
ActivityLogMiddleware — automatic error logging for every API endpoint.

Intercepts all 4xx/5xx responses on mutating requests (POST/PUT/PATCH/DELETE)
for authenticated users and writes an ActivityLog entry.

Explicit log_activity() calls (e.g. for KSeF, WZ errors) set
request._activity_logged = True which causes this middleware to skip that
request and avoid duplicate entries.
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Patterns evaluated in order; first match wins.
# Each entry: (compiled_regex, action_key, Polish label)
_URL_PATTERNS = [
    # Invoices
    (re.compile(r"/api/invoices/[^/]+/issue/"),           "invoice.issue",       "Wystawienie faktury"),
    (re.compile(r"/api/invoices/[^/]+/send-to-ksef/"),    "ksef.send",           "Wysyłka faktury do KSeF"),
    (re.compile(r"/api/invoices/[^/]+/ksef-status/"),     "ksef.status",         "Sprawdzenie statusu KSeF"),
    (re.compile(r"/api/invoices/[^/]+/mark-paid/"),       "invoice.mark_paid",   "Oznaczenie faktury jako zapłaconej"),
    (re.compile(r"/api/invoices/[^/]+/create-correction/"), "invoice.correction","Tworzenie korekty faktury"),
    (re.compile(r"/api/invoices/generate-from-order/"),   "invoice.create",      "Generowanie faktury z zamówienia"),
    (re.compile(r"/api/invoices/$"),                      "invoice.create",      "Tworzenie faktury"),
    (re.compile(r"/api/invoices/[^/]+/"),                 "invoice.update",      "Edycja faktury"),
    # Orders
    (re.compile(r"/api/orders/[^/]+/confirm/"),           "order.confirm",       "Potwierdzenie zamówienia"),
    (re.compile(r"/api/orders/[^/]+/cancel/"),            "order.cancel",        "Anulowanie zamówienia"),
    (re.compile(r"/api/orders/$"),                        "order.create",        "Tworzenie zamówienia"),
    (re.compile(r"/api/orders/[^/]+/"),                   "order.update",        "Edycja zamówienia"),
    # KSeF
    (re.compile(r"/api/ksef/session/"),                   "ksef.auth",           "Logowanie do KSeF"),
    (re.compile(r"/api/ksef/"),                           "ksef",                "Operacja KSeF"),
    # Delivery / WZ / PZ
    (re.compile(r"/api/delivery/"),                       "delivery",            "Dokument dostawy (WZ/PZ)"),
    # Customers / Suppliers / Products
    (re.compile(r"/api/customers/"),                      "customer",            "Klient"),
    (re.compile(r"/api/suppliers/"),                      "supplier",            "Dostawca"),
    (re.compile(r"/api/products/"),                       "product",             "Produkt"),
    (re.compile(r"/api/warehouses/"),                     "warehouse",           "Magazyn"),
    (re.compile(r"/api/inventory/"),                      "inventory",           "Inwentaryzacja"),
    # Van routes
    (re.compile(r"/api/van-routes/"),                     "van_route",           "Trasa vana"),
    # Production
    (re.compile(r"/api/production/"),                     "production",          "Produkcja"),
    # Cost / reporting
    (re.compile(r"/api/cost-allocation/"),                "cost_allocation",     "Adnotacja kosztowa"),
    (re.compile(r"/api/fixed-costs/"),                    "fixed_costs",         "Koszty stałe"),
    (re.compile(r"/api/reports/"),                        "report",              "Raport"),
    # Auth / company
    (re.compile(r"/api/companies/"),                      "company",             "Firma"),
    (re.compile(r"/api/auth/"),                           "auth",                "Uwierzytelnianie"),
]


def _match_action(path: str) -> tuple[str, str]:
    """Return (action_key, label) for the given URL path."""
    for pattern, action_key, label in _URL_PATTERNS:
        if pattern.search(path):
            return action_key, label
    return "api", "Operacja API"


def _extract_error_detail(response) -> tuple[str, str]:
    """
    Parse the response body and return (error_code, error_detail).

    Reads `error_code` and `detail` / `error` / first string value from JSON.
    Returns ("", "") if the body cannot be parsed.
    """
    try:
        content_type = response.get("Content-Type", "")
        if "json" not in content_type:
            return "", ""
        body = json.loads(response.content)
        if not isinstance(body, dict):
            return "", ""

        error_code = str(body.get("error_code", ""))

        # Extract the most useful human-readable message
        detail = (
            body.get("detail")
            or body.get("error")
            or body.get("message")
            or _first_string_value(body)
            or ""
        )
        return error_code, str(detail)[:1024]
    except Exception:
        return "", ""


def _first_string_value(d: dict) -> str:
    """Return the first string value found in a flat dict (for generic error shapes)."""
    for v in d.values():
        if isinstance(v, str):
            return v
        if isinstance(v, list) and v and isinstance(v[0], str):
            return v[0]
    return ""


class ActivityLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if self._should_log(request, response):
            self._log(request, response)

        return response

    def _should_log(self, request, response) -> bool:
        if request.method not in _MUTATING_METHODS:
            return False
        if not request.path.startswith("/api/"):
            return False
        if response.status_code < 400:
            return False
        if getattr(request, "_activity_logged", False):
            # Already logged by an explicit log_activity() call with a rich error_code.
            return False
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        return True

    def _log(self, request, response):
        try:
            from .log import log_activity
            from .models import ActivityLog

            user = request.user
            action_key, _label = _match_action(request.path)
            error_code, error_detail = _extract_error_detail(response)

            log_activity(
                user=user,
                action=action_key,
                status=ActivityLog.STATUS_ERROR if response.status_code < 500 else ActivityLog.STATUS_ERROR,
                error_code=error_code,
                error_detail=error_detail or f"HTTP {response.status_code}",
            )
        except Exception:
            logger.exception("ActivityLogMiddleware: failed to write log for %s %s", request.method, request.path)
