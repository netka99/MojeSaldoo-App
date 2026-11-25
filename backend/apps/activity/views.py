import csv
import io

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.http import HttpResponse
from django.utils.dateparse import parse_date

from apps.users.permissions import IsCompanyMember

from .models import ActivityLog, AuditLog
from .error_codes import get_error_info

PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

ACTION_LABELS = {
    "ksef.auth": "Logowanie do KSeF",
    "ksef.send": "Wysyłka faktury do KSeF",
    "ksef.status": "Sprawdzenie statusu KSeF",
    "ksef.sync": "Synchronizacja skrzynki KSeF",
    "ksef.parse": "Odczyt faktury z KSeF",
    "ksef.download": "Pobranie pliku z KSeF",
    "ksef.scan_paper": "Skan faktury papierowej",
    "ksef.inbox_opex": "Kategoria kosztowa faktury KSeF",
    "ksef.inbox_paid": "Oznaczenie faktury KSeF jako zapłaconej",
    "ksef": "Operacja KSeF",
    "invoice.issue": "Wystawienie faktury",
    "invoice.create": "Tworzenie faktury",
    "invoice.update": "Edycja faktury",
    "invoice.correction": "Tworzenie korekty faktury",
    "invoice.mark_paid": "Oznaczenie faktury jako zapłaconej",
    "invoice.mark_unpaid": "Cofnięcie opłacenia faktury",
    "invoice.download": "Pobranie faktury (XML/UPO)",
    "order.confirm": "Potwierdzenie zamówienia",
    "order.create": "Tworzenie zamówienia",
    "order.update": "Edycja zamówienia",
    "order.cancel": "Anulowanie zamówienia",
    "delivery": "Dokument dostawy (WZ/PZ)",
    "delivery.wz_create": "Wystawienie WZ",
    "delivery.start": "Rozpoczęcie dostawy",
    "delivery.complete": "Zakończenie dokumentu WZ/PZ",
    "delivery.pz_create": "Utworzenie PZ",
    "delivery.pz_cancel": "Anulowanie PZ",
    "delivery.pz_kor": "Utworzenie PZ-KOR",
    "delivery.wz_kor": "Utworzenie WZ-KOR",
    "delivery.rw_create": "Odpis magazynowy (RW)",
    "delivery.zw_create": "Przyjęcie zwrotu (ZW)",
    "delivery.van_loading": "Załadunek vana (MM)",
    "delivery.van_recon": "Rozliczenie vana",
    "delivery.update": "Edycja dokumentu dostawy",
    "server.error": "Błąd serwera",
    "product": "Produkt",
    "product.import": "Import produktów",
    "product.delete": "Usunięcie produktu",
    "product.create": "Dodanie produktu",
    "product.stock": "Korekta stanu produktu",
    "customer": "Klient",
    "customer.import": "Import klientów",
    "customer.create": "Dodanie klienta",
    "customer.update": "Edycja klienta",
    "customer.delete": "Usunięcie klienta",
    "supplier": "Dostawca",
    "supplier.create": "Dodanie dostawcy",
    "supplier.update": "Edycja dostawcy",
    "supplier.delete": "Usunięcie dostawcy",
    "warehouse": "Magazyn",
    "warehouse.import": "Import stanu magazynowego",
    "warehouse.transfer": "Przesunięcie między magazynami",
    "warehouse.create": "Dodanie magazynu",
    "warehouse.update": "Edycja magazynu",
    "warehouse.delete": "Usunięcie magazynu",
    "inventory": "Inwentaryzacja",
    "inventory.complete": "Zakończenie inwentaryzacji",
    "inventory.cancel": "Anulowanie inwentaryzacji",
    "van_route": "Trasa vana",
    "van_route.start_loading": "Załadunek trasy",
    "van_route.confirm_loading": "Potwierdzenie załadunku trasy",
    "van_route.close": "Zamknięcie trasy",
    "production": "Produkcja",
    "production.complete": "Zakończenie zlecenia produkcji",
    "cost_allocation": "Adnotacja kosztowa",
    "fixed_costs": "Koszty stałe",
    "report": "Raport",
    "company": "Firma",
    "company.member": "Członek zespołu",
    "company.workflow": "Ustawienia przepływu dokumentów",
    "company.certificate": "Certyfikat KSeF",
    "auth": "Uwierzytelnianie",
    "purchase_document": "Dokument zakupu",
    "purchase_document.match": "Powiązanie PZ z fakturą zakupu",
    "cashflow": "Przepływy pieniężne",
    "cashflow.expense": "Wydatek gotówkowy",
    "cashflow.b2c": "Przychód B2C",
    "cashflow.tax": "Konfiguracja podatków",
    "sales": "Raport sprzedaży",
    "sales.report": "Dzienny raport sprzedaży",
    "api": "Operacja API",
}


class ActivityLogView(APIView):
    """
    GET /api/activity/
    Returns the current company's activity log for the authenticated user.
    Supports ?status=error|success|warning and ?page=N filtering.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        qs = ActivityLog.objects.filter(company=company).select_related("user")

        status_filter = request.query_params.get("status", "").strip()
        if status_filter in (ActivityLog.STATUS_SUCCESS, ActivityLog.STATUS_ERROR, ActivityLog.STATUS_WARNING):
            qs = qs.filter(status=status_filter)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = min(int(request.query_params.get("page_size", PAGE_SIZE)), MAX_PAGE_SIZE)
        except ValueError:
            page, page_size = 1, PAGE_SIZE

        total = qs.count()
        offset = (page - 1) * page_size
        entries = qs[offset: offset + page_size]

        results = []
        for entry in entries:
            if entry.error_code:
                error_info = get_error_info(entry.error_code, entry.error_detail)
            elif entry.status != ActivityLog.STATUS_SUCCESS and entry.error_detail:
                error_info = get_error_info("", entry.error_detail)
            else:
                error_info = None
            if error_info and error_info.get("action_url") and entry.object_id:
                error_info = {
                    **error_info,
                    "action_url": error_info["action_url"].replace("{object_id}", entry.object_id),
                }
            results.append({
                "id": entry.pk,
                "action": entry.action,
                "action_label": ACTION_LABELS.get(entry.action, entry.action),
                "status": entry.status,
                "object_type": entry.object_type,
                "object_id": entry.object_id,
                "error_code": entry.error_code,
                "error_info": error_info,
                "created_at": entry.created_at.isoformat(),
                "user_display": (
                    entry.user.get_full_name() or entry.user.username
                    if entry.user
                    else None
                ),
            })

        return Response({
            "results": results,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": offset + page_size < total,
        })


AUDIT_ACTION_LABELS = {
    "invoice.created": "Wystawiono fakturę",
    "invoice.updated": "Edytowano fakturę",
    "invoice.deleted": "Usunięto fakturę",
    "product.created": "Dodano produkt",
    "product.updated": "Edytowano produkt",
    "product.price_changed": "Zmieniono cenę produktu",
    "stock.adjusted": "Skorygowano stan magazynu",
    "delivery.created": "Utworzono dokument dostawy",
    "delivery.updated": "Edytowano dokument dostawy",
    "delivery.deleted": "Usunięto dokument dostawy",
    "order.created": "Utworzono zamówienie",
    "order.updated": "Edytowano zamówienie",
    "customer.created": "Dodano klienta",
    "customer.updated": "Edytowano klienta",
    "company.updated": "Zmieniono ustawienia firmy",
    "production_order.created": "Utworzono zlecenie produkcji",
    "production_order.updated": "Edytowano zlecenie produkcji",
    "auth.login": "Logowanie do systemu",
}

# Human-readable labels for status values
STATUS_LABELS = {
    "draft": "Szkic",
    "saved": "Zapisany",
    "in_transit": "W tranzycie",
    "delivered": "Dostarczony",
    "cancelled": "Anulowany",
    "corrected": "Skorygowany",
    "confirmed": "Potwierdzony",
    "in_preparation": "Przygotowanie",
    "loaded": "Załadowany",
    "in_delivery": "W dostawie",
    "partially_delivered": "Częściowo dostarczony",
    "invoiced": "Zafakturowany",
    "issued": "Wystawiona",
    "paid": "Opłacona",
    "overdue": "Przeterminowana",
    "sent": "Wysłana",
    "not_sent": "Nie wysłana",
    "accepted": "Zaakceptowana",
    "rejected": "Odrzucona",
    "pending": "Oczekuje",
    "refund_due": "Do zwrotu",
    "completed": "Zakończone",
}

# Human-readable labels for field names
FIELD_LABELS = {
    "status": "Status",
    "total_gross": "Kwota brutto",
    "vat_amount": "Kwota VAT",
    "payment_method": "Metoda płatności",
    "paid_at": "Data zapłaty",
    "ksef_status": "Status KSeF",
    "bank_account_iban": "Nr konta bankowego",
    "annotation_zwolnienie": "Zwolnienie z VAT",
    "annotation_mpp": "Mechanizm podzielonej płatności",
    "annotation_odwrotne": "Odwrotne obciążenie",
    "document_number": "Numer dokumentu",
    "document_type": "Typ dokumentu",
    "issue_date": "Data wystawienia",
    "order_number": "Numer zamówienia",
    "delivery_date": "Data dostawy",
    "discount_amount": "Rabat",
    "total_net": "Kwota netto",
    "name": "Nazwa",
    "company_name": "Nazwa firmy",
    "nip": "NIP",
    "email": "E-mail",
    "phone": "Telefon",
    "payment_terms": "Termin płatności (dni)",
    "credit_limit": "Limit kredytowy",
    "is_active": "Aktywny",
    "is_individual": "Osoba fizyczna B2C",
    "price_net": "Cena netto",
    "price_gross": "Cena brutto",
    "vat_rate": "Stawka VAT",
    "sku": "SKU",
    "is_vat_payer": "Podatnik VAT",
    "ksef_environment": "Środowisko KSeF",
    "ksef_usage": "Tryb KSeF",
    "taxation_form": "Forma opodatkowania",
    "price_input_mode": "Tryb cen",
}

PAYMENT_METHOD_LABELS = {
    "transfer": "Przelew",
    "cash": "Gotówka",
    "card": "Karta",
    "voucher": "Bon",
    "check": "Czek",
    "credit": "Kredyt",
    "mobile": "Płatność mobilna",
    "other": "Inne",
}

OBJECT_TYPE_LABELS = {
    "Invoice": "Faktura",
    "DeliveryDocument": "Dokument dostawy",
    "Order": "Zamówienie",
    "Customer": "Klient",
    "Product": "Produkt",
    "ProductionOrder": "Zlecenie produkcji",
    "Company": "Ustawienia firmy",
    "StockMovement": "Ruch magazynowy",
    "User": "Logowanie",
}


_DECIMAL_FIELDS = {
    "total_gross", "vat_amount", "total_net", "discount_amount",
    "price_net", "price_gross", "credit_limit",
}


def _fmt_decimal(s: str) -> str:
    """Round a stored decimal string to 2 decimal places for display."""
    try:
        from decimal import Decimal, InvalidOperation
        return str(round(Decimal(s), 2))
    except Exception:
        return s


def _human_value(key: str, val) -> str:
    """Translate a raw field value to a human-readable string."""
    if val is None or val == '':
        return '—'
    s = str(val)
    if key == 'payment_method':
        return PAYMENT_METHOD_LABELS.get(s, s)
    if key in ('status', 'ksef_status'):
        return STATUS_LABELS.get(s, s)
    if key in ('is_active', 'is_vat_payer', 'is_individual',
               'annotation_zwolnienie', 'annotation_mpp', 'annotation_odwrotne'):
        return 'Tak' if s.lower() in ('true', '1') else 'Nie'
    if key in _DECIMAL_FIELDS and s:
        return _fmt_decimal(s)
    return s


_MODEL_MAP = {
    'Invoice': ('apps.invoices.models', 'Invoice'),
    'DeliveryDocument': ('apps.delivery.models', 'DeliveryDocument'),
    'Order': ('apps.orders.models', 'Order'),
    'Customer': ('apps.customers.models', 'Customer'),
    'Product': ('apps.products.models', 'Product'),
    'ProductionOrder': ('apps.production.models', 'ProductionOrder'),
}

_REPR_FIELD_MAP = {
    'Invoice': 'invoice_number',
    'DeliveryDocument': 'document_number',
    'Order': 'order_number',
    'ProductionOrder': 'order_number',
    'Customer': 'name',
    'Product': 'name',
}


def _resolve_object_repr(entry) -> tuple[str, str | None]:
    """
    Return (object_repr, object_id) for an audit entry.
    - object_repr: human-readable label (invoice number, document number, etc.)
    - object_id: the PK to use in links — set to None if the object no longer exists.

    For entries whose stored object_repr is a plain integer (old PK before a demo reset),
    we attempt a live DB lookup. If the object is gone, object_id is returned as None
    so the frontend won't render a broken link.
    """
    stored_repr = entry.object_repr or ''
    stored_id = entry.object_id or ''

    # If repr looks like a document number / name (not a plain integer) assume it's fine.
    if stored_repr and not stored_repr.lstrip('-').isdigit():
        return stored_repr, stored_id

    # Repr is a plain integer — it's an old PK. Try a live lookup.
    model_info = _MODEL_MAP.get(entry.object_type)
    if model_info and stored_id and stored_id.lstrip('-').isdigit():
        try:
            import importlib
            module = importlib.import_module(model_info[0])
            Model = getattr(module, model_info[1])
            repr_field = _REPR_FIELD_MAP.get(entry.object_type, 'pk')
            obj = Model.objects.filter(pk=int(stored_id)).only(repr_field).first()
            if obj:
                label = getattr(obj, repr_field, None) or stored_repr or stored_id
                return str(label), stored_id
            else:
                # Object deleted (e.g. after demo reset) — no link
                return stored_repr or stored_id, None
        except Exception:
            pass

    return stored_repr or stored_id, stored_id


def _build_audit_entry(entry):
    """Build a serialized dict for an AuditLog entry with human-readable diff."""
    before = entry.before or {}
    after = entry.after or {}

    STOCK_FIELD_LABELS = {
        'quantity': 'Stan magazynowy',
        'quantity_change': 'Zmiana',
        'movement_type': 'Typ ruchu',
        'reference_type': 'Źródło',
    }

    changes = []
    if entry.action.endswith((".updated", ".price_changed")):
        for key in after:
            b_val = before.get(key)
            a_val = after.get(key)
            if b_val != a_val:
                field_label = FIELD_LABELS.get(key, key)
                b_human = _human_value(key, b_val)
                a_human = _human_value(key, a_val)
                if b_human != '—':
                    changes.append(f"{field_label}: {b_human} → {a_human}")
                else:
                    changes.append(f"{field_label}: {a_human}")
    elif entry.action == 'stock.adjusted':
        qty_before = (before or {}).get('quantity', '')
        qty_after = after.get('quantity', '')
        qty_change = after.get('quantity_change', '')
        movement_type = after.get('movement_type', '')
        reference_type = after.get('reference_type', '')
        if qty_before and qty_after:
            changes.append(f"Stan: {qty_before} → {qty_after} szt.")
        elif qty_after:
            changes.append(f"Stan po: {qty_after} szt.")
        if qty_change:
            sign = '+' if not str(qty_change).startswith('-') else ''
            changes.append(f"Zmiana: {sign}{qty_change} szt.")
        if movement_type:
            changes.append(f"Typ: {movement_type}")
        if reference_type:
            changes.append(f"Źródło: {reference_type}")

    object_repr, object_id = _resolve_object_repr(entry)

    return {
        "id": str(entry.id),
        "action": entry.action,
        "action_label": AUDIT_ACTION_LABELS.get(entry.action, entry.action),
        "object_type": entry.object_type,
        "object_id": object_id,
        "object_repr": object_repr,
        "changes": changes,
        "before": before,
        "after": after,
        "user_display": (
            entry.user.get_full_name() or entry.user.username
            if entry.user else None
        ),
        "created_at": entry.created_at.isoformat(),
    }


def _build_audit_qs(company, params):
    """Build a filtered AuditLog queryset from request query params dict."""
    qs = AuditLog.objects.filter(company=company).select_related("user").order_by("-created_at")

    object_type = params.get("object_type", "").strip()
    if object_type:
        qs = qs.filter(object_type=object_type)

    date_from = params.get("date_from", "").strip()
    if date_from:
        parsed = parse_date(date_from)
        if parsed:
            qs = qs.filter(created_at__date__gte=parsed)

    date_to = params.get("date_to", "").strip()
    if date_to:
        parsed = parse_date(date_to)
        if parsed:
            qs = qs.filter(created_at__date__lte=parsed)

    return qs


class AuditLogView(APIView):
    """
    GET /api/activity/audit/?object_type=DeliveryDocument&object_id=<uuid>
      → Returns audit history for a specific object (no pagination).

    GET /api/activity/audit/?object_type=Invoice&date_from=2026-01-01&date_to=2026-12-31&page=1
      → Returns paginated full audit log for the company (all objects when no object_id).
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        object_type = request.query_params.get("object_type", "").strip()
        object_id = request.query_params.get("object_id", "").strip()

        # --- Per-object mode (original behaviour) ---
        if object_id:
            qs = AuditLog.objects.filter(
                company=company,
                object_id=object_id,
            ).select_related("user").order_by("-created_at")
            if object_type:
                qs = qs.filter(object_type=object_type)
            entries = qs[:50]
            return Response({"results": [_build_audit_entry(e) for e in entries]})

        # --- Full audit log mode (new, paginated) ---
        qs = _build_audit_qs(company, request.query_params)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except ValueError:
            page = 1

        page_size = PAGE_SIZE
        total = qs.count()
        offset = (page - 1) * page_size
        entries = qs[offset: offset + page_size]

        return Response({
            "results": [_build_audit_entry(e) for e in entries],
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": offset + page_size < total,
        })


class AuditLogExportView(APIView):
    """
    GET /api/activity/audit/export/
    Returns the audit log as a CSV file with the same filters as AuditLogView (full mode).
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        qs = _build_audit_qs(company, request.query_params)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Data i czas", "Użytkownik", "Typ dokumentu", "Dokument", "Akcja", "Zmiany"])

        for entry in qs.iterator(chunk_size=200):
            data = _build_audit_entry(entry)
            writer.writerow([
                entry.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                data["user_display"] or "",
                OBJECT_TYPE_LABELS.get(entry.object_type, entry.object_type),
                data["object_repr"],
                data["action_label"],
                "; ".join(data["changes"]),
            ])

        response = HttpResponse(
            "\ufeff" + output.getvalue(),  # BOM for Excel UTF-8 compatibility
            content_type="text/csv; charset=utf-8",
        )
        response["Content-Disposition"] = 'attachment; filename="audit_log.csv"'
        return response
