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
    "invoice.issue": "Wystawienie faktury",
    "order.confirm": "Potwierdzenie zamówienia",
    "delivery.wz_create": "Wystawienie WZ",
    "server.error": "Błąd serwera",
    "product.import": "Import produktów",
    "product.delete": "Usunięcie produktu",
    "customer.import": "Import klientów",
    "customer.create": "Dodanie klienta",
    "customer.update": "Edycja klienta",
    "customer.delete": "Usunięcie klienta",
    "supplier.create": "Dodanie dostawcy",
    "supplier.update": "Edycja dostawcy",
    "supplier.delete": "Usunięcie dostawcy",
    "warehouse.import": "Import stanu magazynowego",
    "warehouse.transfer": "Przesunięcie między magazynami",
    "warehouse.create": "Dodanie magazynu",
    "warehouse.update": "Edycja magazynu",
    "warehouse.delete": "Usunięcie magazynu",
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
                error_info = get_error_info(entry.error_code)
            elif entry.status != ActivityLog.STATUS_SUCCESS and entry.error_detail:
                # No specific error code — show the raw error message from the response.
                error_info = {
                    "title": "Błąd operacji",
                    "description": entry.error_detail,
                    "action_hint": "Sprawdź szczegóły i spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z supportem.",
                    "action_url": None,
                }
            else:
                error_info = None
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
