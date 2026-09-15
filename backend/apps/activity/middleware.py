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

from .format import flatten_error_value

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
    (re.compile(r"/api/invoices/[^/]+/mark-unpaid/"),     "invoice.mark_unpaid", "Cofnięcie opłacenia faktury"),
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
    (re.compile(r"/api/ksef/inbox/sync/"),                "ksef.sync",           "Synchronizacja skrzynki KSeF"),
    (re.compile(r"/api/ksef/scan-paper/"),                "ksef.scan_paper",     "Skan faktury papierowej"),
    (re.compile(r"/api/ksef/inbox/[^/]+/opex/"),          "ksef.inbox_opex",     "Kategoria kosztowa faktury KSeF"),
    (re.compile(r"/api/ksef/inbox/[^/]+/mark-paid/"),     "ksef.inbox_paid",     "Oznaczenie faktury KSeF jako zapłaconej"),
    (re.compile(r"/api/ksef/"),                           "ksef",                "Operacja KSeF"),
    # Delivery / WZ / PZ — specific actions before the catch-all
    (re.compile(r"/api/delivery/[^/]+/complete/"),        "delivery.complete",   "Zakończenie dokumentu WZ/PZ"),
    (re.compile(r"/api/delivery/[^/]+/start-delivery/"),  "delivery.start",      "Rozpoczęcie dostawy"),
    (re.compile(r"/api/delivery/create-pz/"),             "delivery.pz_create",  "Utworzenie PZ"),
    (re.compile(r"/api/delivery/[^/]+/cancel-pz/"),       "delivery.pz_cancel",  "Anulowanie PZ"),
    (re.compile(r"/api/delivery/[^/]+/create-kor/"),      "delivery.pz_kor",     "Utworzenie PZ-KOR"),
    (re.compile(r"/api/delivery/[^/]+/create-wz-correction/"), "delivery.wz_kor", "Utworzenie WZ-KOR"),
    (re.compile(r"/api/delivery/create-rw/"),             "delivery.rw_create",  "Odpis magazynowy (RW)"),
    (re.compile(r"/api/delivery/[^/]+/add-returns/"),     "delivery.zw_create",  "Przyjęcie zwrotu (ZW)"),
    (re.compile(r"/api/delivery/van-loading/"),           "delivery.van_loading","Załadunek vana (MM)"),
    (re.compile(r"/api/delivery/van-reconciliation/"),    "delivery.van_recon",  "Rozliczenie vana"),
    (re.compile(r"/api/delivery/create-standalone/"),     "delivery.wz_create",  "Wystawienie WZ"),
    (re.compile(r"/api/delivery/generate-for-order"),     "delivery.wz_create",  "Wystawienie WZ"),
    (re.compile(r"/api/delivery/generate-for-orders/"),   "delivery.wz_create",  "Wystawienie WZ"),
    (re.compile(r"/api/delivery/"),                       "delivery",            "Dokument dostawy (WZ/PZ)"),
    # Customers / Suppliers / Products
    (re.compile(r"/api/customers/"),                      "customer",            "Klient"),
    (re.compile(r"/api/suppliers/"),                      "supplier",            "Dostawca"),
    (re.compile(r"/api/products/[^/]+/update-stock/"),    "product.stock",       "Korekta stanu produktu"),
    (re.compile(r"/api/products/"),                       "product",             "Produkt"),
    (re.compile(r"/api/warehouses/[^/]+/transfer/"),      "warehouse.transfer",  "Przesunięcie między magazynami"),
    (re.compile(r"/api/warehouses/"),                     "warehouse",           "Magazyn"),
    (re.compile(r"/api/inventory/[^/]+/complete/"),       "inventory.complete",  "Zakończenie inwentaryzacji"),
    (re.compile(r"/api/inventory/[^/]+/cancel/"),         "inventory.cancel",    "Anulowanie inwentaryzacji"),
    (re.compile(r"/api/inventory/"),                      "inventory",           "Inwentaryzacja"),
    # Van routes
    (re.compile(r"/api/van-routes/[^/]+/start-loading/"), "van_route.start_loading", "Załadunek trasy"),
    (re.compile(r"/api/van-routes/[^/]+/confirm-loading/"), "van_route.confirm_loading", "Potwierdzenie załadunku trasy"),
    (re.compile(r"/api/van-routes/[^/]+/close/"),         "van_route.close",     "Zamknięcie trasy"),
    (re.compile(r"/api/van-routes/"),                     "van_route",           "Trasa vana"),
    # Production
    (re.compile(r"/api/production/orders/[^/]+/complete/"), "production.complete", "Zakończenie zlecenia produkcji"),
    (re.compile(r"/api/production/"),                     "production",          "Produkcja"),
    # Purchase documents / cash-flow / sales (previously fell through to "api")
    (re.compile(r"/api/purchase-documents/[^/]+/confirm-line-matches/"), "purchase_document.match", "Powiązanie PZ z fakturą zakupu"),
    (re.compile(r"/api/purchase-documents/"),             "purchase_document",   "Dokument zakupu"),
    (re.compile(r"/api/cash-flow/quick-expenses/"),       "cashflow.expense",    "Wydatek gotówkowy"),
    (re.compile(r"/api/cash-flow/b2c-revenue/"),          "cashflow.b2c",        "Przychód B2C"),
    (re.compile(r"/api/cash-flow/tax-config/"),           "cashflow.tax",        "Konfiguracja podatków"),
    (re.compile(r"/api/cash-flow/"),                      "cashflow",            "Przepływy pieniężne"),
    (re.compile(r"/api/sales/"),                          "sales.report",        "Dzienny raport sprzedaży"),
    # Cost / reporting
    (re.compile(r"/api/cost-allocation/"),                "cost_allocation",     "Adnotacja kosztowa"),
    (re.compile(r"/api/fixed-costs/"),                    "fixed_costs",         "Koszty stałe"),
    (re.compile(r"/api/reports/"),                        "report",              "Raport"),
    # Auth / company
    (re.compile(r"/api/companies/[^/]+/certificate/"),    "company.certificate", "Certyfikat KSeF"),
    (re.compile(r"/api/companies/[^/]+/members/"),        "company.member",      "Członek zespołu"),
    (re.compile(r"/api/companies/[^/]+/workflow-settings/"), "company.workflow", "Ustawienia przepływu dokumentów"),
    (re.compile(r"/api/companies/"),                      "company",             "Firma"),
    (re.compile(r"/api/auth/"),                           "auth",                "Uwierzytelnianie"),
]


def _match_action(path: str) -> tuple[str, str]:
    """Return (action_key, label) for the given URL path."""
    for pattern, action_key, label in _URL_PATTERNS:
        if pattern.search(path):
            return action_key, label
    return "api", "Operacja API"


_UUID_RE = re.compile(
    r"/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/",
    re.I,
)


def _extract_object_id(path: str) -> str:
    match = _UUID_RE.search(path or "")
    return match.group(1) if match else ""


def _extract_error_detail(response) -> tuple[str, str]:
    """
    Parse the response body and return (error_code, error_detail).

    Reads `error_code` and flattens `detail` / `error` / nested field errors.
    Returns ("", "") if the body cannot be parsed.
    """
    try:
        content_type = response.get("Content-Type", "")
        if "json" not in content_type:
            return "", ""
        body = json.loads(response.content)
        if not isinstance(body, dict):
            return "", flatten_error_value(body)[:1024]

        error_code = str(body.get("error_code") or "")
        detail = flatten_error_value(body)
        return error_code, detail[:1024]
    except Exception:
        return "", ""


def _first_string_value(d: dict) -> str:
    """Return the first string value found in a flat dict (for generic error shapes)."""
    return flatten_error_value(d)


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
            if not error_code and response.status_code == 403:
                error_code = "PERMISSION_DENIED"

            log_activity(
                user=user,
                action=action_key,
                status=ActivityLog.STATUS_ERROR,
                error_code=error_code,
                error_detail=error_detail or f"HTTP {response.status_code}",
                object_id=_extract_object_id(request.path),
            )
        except Exception:
            logger.exception("ActivityLogMiddleware: failed to write log for %s %s", request.method, request.path)
