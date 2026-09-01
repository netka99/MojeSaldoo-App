import calendar
import datetime

from rest_framework import filters, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.utils import timezone
from django.utils.text import slugify

from apps.users.permissions import HasCompanyPermission, IsCompanyMember

from .models import CompanyOpexCategory, CompanyTaxConfig, DailyB2CRevenue, QuickExpense
from .serializers import (
    CompanyOpexCategorySerializer,
    CompanyTaxConfigSerializer,
    DailyB2CRevenueSerializer,
    QuickExpenseSerializer,
)
from .harmonogram import compute_harmonogram
from .services import compute_dashboard, compute_history, compute_period_summary, _get_expense_breakdown


class CompanyTaxConfigView(APIView):
    """GET or PATCH the tax configuration for the current company.

    A config row is created on first access with sensible defaults.
    Only company members can read; write requires ``can_manage_accounting``.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        config, _ = CompanyTaxConfig.objects.get_or_create(
            company=request.user.current_company
        )
        return Response(CompanyTaxConfigSerializer(config).data)

    def patch(self, request):
        # Require accounting permission for writes
        perm = HasCompanyPermission()
        perm.required_permission = "can_manage_accounting"
        if not perm.has_permission(request, self):
            return Response(
                {"detail": "Nie masz uprawnień do zmiany konfiguracji podatkowej."},
                status=status.HTTP_403_FORBIDDEN,
            )

        config, _ = CompanyTaxConfig.objects.get_or_create(
            company=request.user.current_company
        )
        serializer = CompanyTaxConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        # Set balance_updated_at when balance fields are being updated
        balance_fields = {"cash_balance", "bank_balance", "balance_date"}
        if balance_fields & set(request.data.keys()):
            serializer.save(balance_updated_at=timezone.now())
        else:
            serializer.save()

        return Response(serializer.data)

    # Alias PUT to PATCH for client convenience
    put = patch


class QuickExpenseViewSet(viewsets.ModelViewSet):
    """CRUD for non-KSeF cash/receipt expenses (paliwo, paragony, itp.)."""

    lookup_field = "uuid"
    required_permission = "can_manage_accounting"
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    pagination_class = None
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["date", "amount", "category", "created_at"]
    ordering = ["-date", "-created_at"]

    def get_queryset(self):
        return QuickExpense.objects.filter(
            company=self.request.user.current_company,
        )

    def get_serializer_class(self):
        return QuickExpenseSerializer


class DailyB2CRevenueViewSet(viewsets.ModelViewSet):
    """CRUD for daily cash-register / B2C revenue entries."""

    lookup_field = "uuid"
    required_permission = "can_manage_accounting"
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    pagination_class = None
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["date", "amount", "created_at"]
    ordering = ["-date", "-created_at"]

    def get_queryset(self):
        return DailyB2CRevenue.objects.filter(
            company=self.request.user.current_company,
        )

    def get_serializer_class(self):
        return DailyB2CRevenueSerializer


class CompanyOpexCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CompanyOpexCategorySerializer
    permission_classes = [IsAuthenticated, IsCompanyMember]
    lookup_field = "uuid"
    pagination_class = None

    def get_queryset(self):
        company = self.request.user.current_company
        # Backfill any categories that somehow ended up with empty slugs
        for cat in CompanyOpexCategory.objects.filter(company=company, slug=''):
            cat.slug = self._unique_slug(cat.name, company, exclude_id=cat.id)
            cat.save(update_fields=['slug'])

        qs = CompanyOpexCategory.objects.filter(company=company).order_by('sort_order', 'created_at')
        # ?all=true → return all including hidden (for the category manager UI)
        if self.request.query_params.get('all') != 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        company = self.request.user.current_company
        slug = serializer.validated_data.get('slug', '').strip()
        if not slug:
            slug = self._unique_slug(serializer.validated_data.get('name', ''), company)
        serializer.save(company=company, slug=slug)

    def perform_update(self, serializer):
        company = self.request.user.current_company
        slug = serializer.validated_data.get('slug', serializer.instance.slug).strip()
        if not slug:
            name = serializer.validated_data.get('name', serializer.instance.name)
            slug = self._unique_slug(name, company, exclude_id=serializer.instance.id)
        serializer.save(slug=slug)

    @staticmethod
    def _unique_slug(name: str, company, exclude_id=None) -> str:
        """Generate a slug ≤ 20 chars, unique within the company."""
        base = slugify(name)[:17] or 'cat'
        slug = base
        counter = 1
        qs = CompanyOpexCategory.objects.filter(company=company)
        if exclude_id:
            qs = qs.exclude(id=exclude_id)
        while qs.filter(slug=slug).exists():
            slug = f"{base[:15]}-{counter}"
            counter += 1
            if counter > 99:
                break
        return slug[:20]


class ExpenseChartView(APIView):
    """Expense breakdown by category — multi-period stacked bar chart data.

    Query params:
    - ``date_from`` + ``date_to``: ISO date strings for a custom single period
    - ``months``: 1 (default), 6, or 12 — last N calendar months
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from_str = request.query_params.get("date_from")
        date_to_str = request.query_params.get("date_to")
        months = int(request.query_params.get("months", 1))

        today = timezone.localdate()

        if date_from_str and date_to_str:
            # Custom range mode — single period
            try:
                date_from = datetime.date.fromisoformat(date_from_str)
                date_to = datetime.date.fromisoformat(date_to_str)
            except ValueError:
                return Response({"detail": "Invalid date format."}, status=400)
            periods = [{"label": f"{date_from} – {date_to}", "start": date_from, "end": date_to}]
        else:
            # Multi-month mode: last N months (months=1,6,12)
            periods = []
            for i in range(months - 1, -1, -1):
                year = today.year
                month = today.month - i
                while month <= 0:
                    month += 12
                    year -= 1
                first_of_month = datetime.date(year, month, 1)
                last_of_month = datetime.date(year, month, calendar.monthrange(year, month)[1])
                label = first_of_month.strftime("%b %y")
                periods.append({"label": label, "start": first_of_month, "end": last_of_month})

        data = []
        for period in periods:
            breakdown = _get_expense_breakdown(company, period["start"], period["end"])
            data.append({"period": period["label"], **breakdown})

        return Response(data)


class CashFlowDashboardView(APIView):
    """Read-only dashboard: 'Dziś' + 'Miesiąc' sections.

    Optional query param: ``?month=YYYY-MM`` (defaults to current month).
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        month_str = request.query_params.get("month")
        data = compute_dashboard(request.user.current_company, month_str)
        return Response(data)


class CashFlowHistoryView(APIView):
    """Monthly history list — all months with any data, newest first.

    Returns lightweight summaries: period, revenue, costs, really_yours, is_loss, margin_pct.
    """
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        data = compute_history(request.user.current_company)
        return Response(data)


class CashFlowPeriodSummaryView(APIView):
    """Aggregate summary for an arbitrary date range.

    Query params:
        date_from: YYYY-MM-DD (default: Jan 1 of current year)
        date_to:   YYYY-MM-DD (default: today)
    """
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        today = datetime.date.today()
        try:
            date_from_str = request.query_params.get("date_from") or f"{today.year}-01-01"
            date_to_str = request.query_params.get("date_to") or str(today)
            date_from = datetime.date.fromisoformat(date_from_str)
            date_to = datetime.date.fromisoformat(date_to_str)
        except ValueError:
            return Response({"error": "Invalid date format. Use YYYY-MM-DD."}, status=400)

        if date_from > date_to:
            return Response({"error": "date_from must be <= date_to."}, status=400)

        data = compute_period_summary(request.user.current_company, date_from, date_to)
        return Response(data)


class CashFlowHarmonogramView(APIView):
    """Payment schedule for a given month.

    Optional query param: ``?month=YYYY-MM`` (defaults to current month).

    Returns a day-by-day list of confirmed and scheduled cash events with a
    running balance, plus a summary (opening balance, total in/out, min balance).
    """
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        month_str = request.query_params.get("month")
        data = compute_harmonogram(request.user.current_company, month_str)
        return Response(data)
