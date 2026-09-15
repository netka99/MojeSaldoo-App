from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import IsCompanyMember

from .models import ActivityLog
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
