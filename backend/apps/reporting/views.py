import csv
from datetime import datetime, timedelta
from decimal import Decimal

from django.http import HttpResponse

from django.db.models import (
    Avg,
    BooleanField,
    Case,
    Count,
    DecimalField,
    ExpressionWrapper,
    F,
    Max,
    Min,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce, TruncMonth
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice, InvoiceItem
from apps.orders.models import Order, OrderItem
from apps.production.models import ProductionOrder, Recipe
from apps.products.models import Product, ProductStock, StockBatch
from apps.users.permissions import IsCompanyMember
from apps.van_routes.models import VanRoute

from .serializers import ReportingInvoiceSerializer, ReportingRejectedInvoiceSerializer

_MONEY = DecimalField(max_digits=14, decimal_places=2)


def _resolve_product_cost(product) -> tuple[Decimal | None, str | None]:
    """
    Resolve unit cost for a product using the priority chain:
      production > pz > manual > recipe_estimate > None

    Returns (unit_cost, cost_source) where cost_source is one of:
      "production" | "pz" | "manual" | "recipe_estimate" | None
    """
    if product.avg_cost is not None:
        source = product.avg_cost_source or "pz"
        return product.avg_cost, source

    # Fallback: estimate from active recipe
    recipe = (
        Recipe.objects.filter(product=product, is_active=True)
        .prefetch_related("items__ingredient")
        .order_by("-updated_at")
        .first()
    )
    if recipe is None or recipe.yield_quantity <= 0:
        return None, None

    total = Decimal("0")
    for item in recipe.items.all():
        ingredient_cost = item.ingredient.avg_cost
        if ingredient_cost is None:
            return None, None  # Can't estimate without full ingredient costs
        total += ingredient_cost * item.quantity

    return (total / recipe.yield_quantity).quantize(Decimal("0.0001")), "recipe_estimate"


def _optional_query_date(request, key: str):
    raw = request.query_params.get(key)
    if raw in (None, ""):
        return None
    s = str(raw).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise ValidationError({key: "Use ISO date YYYY-MM-DD."})


def _limit_from_request(request, default: int = 10, max_limit: int = 100) -> int:
    raw = request.query_params.get("limit")
    if raw in (None, ""):
        return default
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({"limit": "Must be an integer."})
    if n < 1:
        raise ValidationError({"limit": "Must be >= 1."})
    return min(n, max_limit)


def _csv_response(headers: list, rows: list[list], filename: str) -> HttpResponse:
    """Build a UTF-8 CSV response suitable for Polish Excel (semicolon delimiter, BOM)."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.write("\ufeff")        # UTF-8 BOM — Excel auto-detects encoding
    response.write("sep=;\r\n")     # Tells Excel/LibreOffice to use semicolons
    writer = csv.writer(response, delimiter=";", quoting=csv.QUOTE_ALL)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([
            str(v).replace(".", ",") if isinstance(v, Decimal) else (v if v is not None else "")
            for v in row
        ])
    return response


class SalesSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        qs = Order.objects.filter(company=company)
        if date_from is not None:
            qs = qs.filter(order_date__gte=date_from)
        if date_to is not None:
            qs = qs.filter(order_date__lte=date_to)

        by_status = {
            row["status"]: row["c"]
            for row in qs.values("status").annotate(c=Count("id"))
        }
        total_orders = qs.aggregate(n=Count("id"))["n"]

        money_qs = qs.exclude(status=Order.STATUS_CANCELLED)
        # Sum and Avg on the same field cannot share one aggregate() call in Django ORM.
        agg = money_qs.aggregate(
            total_gross=Sum("total_gross"),
            total_net=Sum("total_net"),
        )
        avg_raw = money_qs.aggregate(avg_order_value=Avg("total_gross"))[
            "avg_order_value"
        ]
        total_gross = agg["total_gross"] or Decimal("0")
        total_net = agg["total_net"] or Decimal("0")
        total_vat = total_gross - total_net
        avg = (
            Decimal(str(avg_raw)).quantize(Decimal("0.01"))
            if avg_raw is not None
            else Decimal("0.00")
        )

        return Response(
            {
                "totalOrders": total_orders,
                "totalGross": total_gross,
                "totalNet": total_net,
                "totalVat": total_vat,
                "avgOrderValue": avg,
                "byStatus": by_status,
            }
        )


class ReportingInvoiceListView(ListAPIView):
    serializer_class = ReportingInvoiceSerializer
    permission_classes = [IsAuthenticated, IsCompanyMember]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status"]

    def get_queryset(self):
        company = self.request.user.current_company
        qs = (
            Invoice.objects.filter(company=company)
            .select_related("customer", "order")
            .order_by("-issue_date", "-created_at")
        )
        date_from = _optional_query_date(self.request, "date_from")
        date_to = _optional_query_date(self.request, "date_to")
        if date_from is not None:
            qs = qs.filter(issue_date__gte=date_from)
        if date_to is not None:
            qs = qs.filter(issue_date__lte=date_to)
        return qs


class TopProductsView(APIView):
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        limit = _limit_from_request(request)

        items = OrderItem.objects.filter(order__company=company).exclude(
            order__status=Order.STATUS_CANCELLED
        )
        if date_from is not None:
            items = items.filter(order__order_date__gte=date_from)
        if date_to is not None:
            items = items.filter(order__order_date__lte=date_to)

        rows = (
            items.values("product_id")
            .annotate(
                productName=Max("product_name"),
                totalQuantity=Sum("quantity"),
                totalGross=Coalesce(
                    Sum("line_total_gross"),
                    Value(Decimal("0"), output_field=_MONEY),
                ),
            )
            .order_by("-totalGross")[:limit]
        )
        out = [
            {
                "productName": r["productName"] or "",
                "totalQuantity": r["totalQuantity"],
                "totalGross": r["totalGross"],
            }
            for r in rows
        ]
        return Response(out)


class TopCustomersView(APIView):
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        limit = _limit_from_request(request)

        qs = Order.objects.filter(company=company).exclude(
            status=Order.STATUS_CANCELLED
        )
        if date_from is not None:
            qs = qs.filter(order_date__gte=date_from)
        if date_to is not None:
            qs = qs.filter(order_date__lte=date_to)

        rows = (
            qs.values("customer_id")
            .annotate(
                customerName=Max("customer__name"),
                orderCount=Count("id"),
                totalGross=Coalesce(
                    Sum("total_gross"),
                    Value(Decimal("0"), output_field=_MONEY),
                ),
            )
            .order_by("-totalGross")[:limit]
        )
        out = [
            {
                "customerName": r["customerName"] or "",
                "orderCount": r["orderCount"],
                "totalGross": r["totalGross"],
            }
            for r in rows
        ]
        return Response(out)


class InventoryReportView(APIView):
    """
    GET /api/reports/inventory/

    Stock levels per product / warehouse, with:
      - belowMinimum flag (qty < min_stock_alert)
      - daysOfStock — estimated days of remaining stock at current sales rate
        (total qty available across all warehouses ÷ avg daily sales over last 90 days).
        None when there are no sales in the last 90 days for that product.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        from datetime import date as _date

        company = request.user.current_company
        today = _date.today()
        ninety_days_ago = today - timedelta(days=90)

        rows = list(
            ProductStock.objects.filter(company=company)
            .annotate(
                belowMinimum=Case(
                    When(
                        quantity_available__lt=F("product__min_stock_alert"),
                        then=Value(True),
                    ),
                    default=Value(False),
                    output_field=BooleanField(),
                ),
            )
            .order_by("product__name", "warehouse__code")
            .values(
                "product_id",
                "product__name",
                "warehouse__code",
                "quantity_available",
                "product__min_stock_alert",
                "belowMinimum",
            )
        )

        # Total stock per product (sum across warehouses)
        total_stock: dict = {}
        for r in rows:
            pid = str(r["product_id"])
            total_stock[pid] = total_stock.get(pid, Decimal("0")) + (r["quantity_available"] or Decimal("0"))

        # Avg daily sales per product (last 90 days, from invoices)
        sales_qs = (
            InvoiceItem.objects.filter(
                invoice__company=company,
                invoice__status__in=[
                    Invoice.STATUS_ISSUED,
                    Invoice.STATUS_SENT,
                    Invoice.STATUS_PAID,
                    Invoice.STATUS_OVERDUE,
                ],
                invoice__issue_date__gte=ninety_days_ago,
                product_id__isnull=False,
            )
            .values("product_id")
            .annotate(total_qty=Sum("quantity"))
        )
        daily_rate: dict = {}
        for s in sales_qs:
            pid = str(s["product_id"])
            total_qty = s["total_qty"] or Decimal("0")
            daily_rate[pid] = total_qty / Decimal("90")

        # days_of_stock per product
        days_of_stock: dict = {}
        for pid, stock in total_stock.items():
            rate = daily_rate.get(pid, Decimal("0"))
            days_of_stock[pid] = round(float(stock / rate)) if rate > 0 else None

        out = [
            {
                "productName": r["product__name"],
                "warehouseCode": r["warehouse__code"],
                "quantityAvailable": r["quantity_available"],
                "minStockAlert": r["product__min_stock_alert"],
                "belowMinimum": r["belowMinimum"],
                "daysOfStock": days_of_stock.get(str(r["product_id"])),
            }
            for r in rows
        ]
        if request.query_params.get("export") == "csv":
            csv_rows = [
                [
                    item["productName"],
                    item["warehouseCode"],
                    item["quantityAvailable"],
                    item["minStockAlert"],
                    "Tak" if item["belowMinimum"] else "Nie",
                    item["daysOfStock"] if item["daysOfStock"] is not None else "",
                ]
                for item in out
            ]
            return _csv_response(
                ["Produkt", "Magazyn", "Dostępne", "Min. alert", "Poniżej minimum", "Dni zapasu"],
                csv_rows,
                "raport-magazyn.csv",
            )
        return Response(out)


class KsefStatusReportView(APIView):
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        qs = Invoice.objects.filter(company=company)
        counts_raw = {
            row["ksef_status"]: row["c"]
            for row in qs.values("ksef_status").annotate(c=Count("id"))
        }
        keys = [c[0] for c in Invoice.KSEF_STATUS_CHOICES]
        counts = {k: counts_raw.get(k, 0) for k in keys}

        rejected_qs = qs.filter(ksef_status="rejected").select_related("customer")
        rejected_data = ReportingRejectedInvoiceSerializer(
            rejected_qs.order_by("-issue_date", "-created_at")[:100],
            many=True,
        ).data

        return Response(
            {
                "notSent": counts.get("not_sent", 0),
                "pending": counts.get("pending", 0),
                "sent": counts.get("sent", 0),
                "accepted": counts.get("accepted", 0),
                "rejected": counts.get("rejected", 0),
                "rejectedInvoices": rejected_data,
            }
        )


class DashboardSummaryView(APIView):
    """GET /api/reports/dashboard/ — operational summary for the current company."""

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        from django.db.models import F
        company = request.user.current_company
        from django.utils import timezone as _tz; today = _tz.localdate()

        orders_pending = Order.objects.filter(
            company=company, status=Order.STATUS_DRAFT
        ).count()

        wz_in_transit = DeliveryDocument.objects.filter(
            company=company,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status=DeliveryDocument.STATUS_IN_TRANSIT,
        ).count()

        inv_agg = Invoice.objects.filter(
            company=company,
            status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT],
            due_date__lt=today,
        ).aggregate(count=Count('id'), total=Sum('total_gross'))

        van_routes_today = list(
            VanRoute.objects.filter(
                company=company,
                date=today,
                status__in=[
                    VanRoute.STATUS_LOADING,
                    VanRoute.STATUS_IN_PROGRESS,
                    VanRoute.STATUS_SETTLING,
                ],
            ).values('id', 'driver_name', 'van_name', 'status')
        )
        for r in van_routes_today:
            r['id'] = str(r['id'])

        low_stock = list(
            ProductStock.objects.filter(
                company=company,
                product__is_active=True,
                product__min_stock_alert__gt=0,
            )
            .filter(quantity_total__lt=F('product__min_stock_alert'))
            .select_related('product', 'warehouse')
            .order_by('product__name')
            .values(
                'product_id',
                'product__name',
                'warehouse__id',
                'warehouse__name',
                'quantity_available',
                'product__min_stock_alert',
            )[:10]
        )
        for row in low_stock:
            row['product_id'] = str(row['product_id'])
            row['warehouse__id'] = str(row['warehouse__id'])

        return Response({
            'orders_pending_confirmation': orders_pending,
            'wz_in_transit': wz_in_transit,
            'invoices_overdue': {
                'count': inv_agg['count'] or 0,
                'total_gross': str(inv_agg['total'] or 0),
            },
            'van_routes_today': van_routes_today,
            'low_stock_alerts': low_stock,
            'date': str(today),
        })


class ProfitLossView(APIView):
    """
    GET /api/reports/profit-loss/

    Monthly P&L: sales revenue (issued invoices) vs purchase costs (PZ deliveries).
    Returns one row per month in the requested date range.

    Query params:
      date_from  YYYY-MM-DD  (defaults to 12 months ago)
      date_to    YYYY-MM-DD  (defaults to today)
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        from calendar import monthrange
        from django.utils.timezone import localdate

        company = request.user.current_company
        today = localdate()

        def _months_ago(d, n):
            """Return the first day of the month that is n months before d."""
            month = d.month - n
            year = d.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            return d.replace(year=year, month=month, day=1)

        date_from = _optional_query_date(request, "date_from") or _months_ago(today, 11)
        date_to = _optional_query_date(request, "date_to") or today
        date_to = _optional_query_date(request, "date_to") or today

        # Revenue: sum of invoice totals (issued/sent/paid/overdue)
        revenue_qs = (
            Invoice.objects.filter(
                company=company,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                status__in=[
                    Invoice.STATUS_ISSUED,
                    Invoice.STATUS_SENT,
                    Invoice.STATUS_PAID,
                    Invoice.STATUS_OVERDUE,
                ],
            )
            .annotate(month=TruncMonth("issue_date"))
            .values("month")
            .annotate(revenue=Coalesce(Sum("total_gross"), Value(Decimal("0"), output_field=_MONEY)))
            .order_by("month")
        )

        # Costs: sum of PZ delivery items (unit_cost × quantity_actual)
        cost_qs = (
            DeliveryItem.objects.filter(
                delivery_document__company=company,
                delivery_document__document_type=DeliveryDocument.DOC_TYPE_PZ,
                delivery_document__status=DeliveryDocument.STATUS_DELIVERED,
                delivery_document__issue_date__gte=date_from,
                delivery_document__issue_date__lte=date_to,
                unit_cost__isnull=False,
            )
            .annotate(month=TruncMonth("delivery_document__issue_date"))
            .values("month")
            .annotate(
                costs=Coalesce(
                    Sum(
                        ExpressionWrapper(
                            F("unit_cost") * Coalesce(F("quantity_actual"), F("quantity_planned")),
                            output_field=_MONEY,
                        )
                    ),
                    Value(Decimal("0"), output_field=_MONEY),
                )
            )
            .order_by("month")
        )

        revenue_by_month = {row["month"]: row["revenue"] for row in revenue_qs}
        costs_by_month = {row["month"]: row["costs"] for row in cost_qs}

        # OPEX: tagged KSeF invoices — summed by month
        from apps.ksef.models import ReceivedKSeFInvoice
        opex_qs = (
            ReceivedKSeFInvoice.objects.filter(
                company=company,
                opex_category__isnull=False,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                gross_amount__isnull=False,
            )
            .annotate(month=TruncMonth("issue_date"))
            .values("month", "opex_category")
            .annotate(
                total=Coalesce(Sum("gross_amount"), Value(Decimal("0"), output_field=_MONEY))
            )
            .order_by("month", "opex_category")
        )

        # opex_by_month: { month_date: { category: Decimal } }
        opex_by_month: dict = {}
        for row in opex_qs:
            m = row["month"]
            cat = row["opex_category"]
            opex_by_month.setdefault(m, {})[cat] = row["total"]

        # Build unified month list covering all three datasets
        all_months = sorted(set(revenue_by_month) | set(costs_by_month) | set(opex_by_month))
        rows = []
        for month in all_months:
            rev = revenue_by_month.get(month, Decimal("0"))
            cost = costs_by_month.get(month, Decimal("0"))
            gross_profit = rev - cost
            opex_cats = opex_by_month.get(month, {})
            opex_total = sum(opex_cats.values(), Decimal("0"))
            operating_profit = gross_profit - opex_total
            rows.append(
                {
                    "month": month.strftime("%Y-%m"),
                    "revenue": rev,
                    "purchaseCosts": cost,
                    "grossProfit": gross_profit,
                    "marginPercent": (
                        round(gross_profit / rev * 100, 1) if rev > 0 else None
                    ),
                    "opex": opex_total,
                    "opexByCategory": opex_cats,
                    "operatingProfit": operating_profit,
                    "operatingMarginPercent": (
                        round(operating_profit / rev * 100, 1) if rev > 0 else None
                    ),
                }
            )

        # Invoice and PZ counts per month for context
        invoice_count_qs = (
            Invoice.objects.filter(
                company=company,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                status__in=[
                    Invoice.STATUS_ISSUED,
                    Invoice.STATUS_SENT,
                    Invoice.STATUS_PAID,
                    Invoice.STATUS_OVERDUE,
                ],
            )
            .annotate(month=TruncMonth("issue_date"))
            .values("month")
            .annotate(cnt=Count("id"))
        )
        pz_count_qs = (
            DeliveryDocument.objects.filter(
                company=company,
                document_type=DeliveryDocument.DOC_TYPE_PZ,
                status=DeliveryDocument.STATUS_DELIVERED,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
            )
            .annotate(month=TruncMonth("issue_date"))
            .values("month")
            .annotate(cnt=Count("id"))
        )
        invoice_counts = {row["month"]: row["cnt"] for row in invoice_count_qs}
        pz_counts = {row["month"]: row["cnt"] for row in pz_count_qs}

        for row in rows:
            month_key = next(
                (m for m in all_months if m.strftime("%Y-%m") == row["month"]), None
            )
            row["invoiceCount"] = invoice_counts.get(month_key, 0)
            row["pzCount"] = pz_counts.get(month_key, 0)

        totals_rev = sum(r["revenue"] for r in rows) or Decimal("0")
        totals_cost = sum(r["purchaseCosts"] for r in rows) or Decimal("0")
        totals_gross = totals_rev - totals_cost
        totals_opex = sum(r["opex"] for r in rows) or Decimal("0")
        totals_operating = totals_gross - totals_opex
        if request.query_params.get("export") == "csv":
            csv_rows = [
                [
                    r["month"],
                    r["revenue"],
                    r["purchaseCosts"],
                    r["grossProfit"],
                    r["opex"],
                    r["operatingProfit"],
                ]
                for r in rows
            ]
            return _csv_response(
                ["Miesiąc", "Przychód", "Koszt własny", "Wynik brutto", "OPEX", "Zysk netto"],
                csv_rows,
                "wynik-finansowy.csv",
            )
        return Response(
            {
                "rows": rows,
                "totals": {
                    "revenue": totals_rev,
                    "purchaseCosts": totals_cost,
                    "grossProfit": totals_gross,
                    "marginPercent": (
                        round(totals_gross / totals_rev * 100, 1)
                        if totals_rev > 0
                        else None
                    ),
                    "opex": totals_opex,
                    "operatingProfit": totals_operating,
                    "operatingMarginPercent": (
                        round(totals_operating / totals_rev * 100, 1)
                        if totals_rev > 0
                        else None
                    ),
                },
            }
        )


class ProfitLossMonthDetailView(APIView):
    """
    GET /api/reports/profit-loss/month-detail/?month=2026-06

    Returns the invoices and PZ documents that make up a given month's P&L.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        month_str = request.query_params.get("month", "")
        if not month_str:
            raise ValidationError({"month": "Required. Format: YYYY-MM."})
        try:
            month_date = datetime.strptime(month_str[:7], "%Y-%m").date()
        except ValueError:
            raise ValidationError({"month": "Use YYYY-MM format."})

        from calendar import monthrange
        last_day = monthrange(month_date.year, month_date.month)[1]
        date_from = month_date
        date_to = month_date.replace(day=last_day)

        invoices = (
            Invoice.objects.filter(
                company=company,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                status__in=[
                    Invoice.STATUS_ISSUED,
                    Invoice.STATUS_SENT,
                    Invoice.STATUS_PAID,
                    Invoice.STATUS_OVERDUE,
                ],
            )
            .select_related("customer")
            .order_by("issue_date", "invoice_number")
        )

        pz_docs = (
            DeliveryDocument.objects.filter(
                company=company,
                document_type=DeliveryDocument.DOC_TYPE_PZ,
                status=DeliveryDocument.STATUS_DELIVERED,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
            )
            .select_related("from_supplier")
            .prefetch_related("items")
            .order_by("issue_date", "document_number")
        )

        invoices_out = [
            {
                "id": str(inv.id),
                "invoice_number": inv.invoice_number or "",
                "issue_date": inv.issue_date.isoformat(),
                "customer_name": inv.customer.name if inv.customer_id else "",
                "total_gross": inv.total_gross,
                "status": inv.status,
            }
            for inv in invoices
        ]

        pz_out = []
        for doc in pz_docs:
            total_cost = sum(
                (item.unit_cost or Decimal("0")) * (item.quantity_actual or item.quantity_planned)
                for item in doc.items.all()
                if item.unit_cost is not None
            )
            pz_out.append(
                {
                    "id": str(doc.id),
                    "document_number": doc.document_number or "",
                    "issue_date": doc.issue_date.isoformat(),
                    "supplier_name": doc.from_supplier.name if doc.from_supplier_id else "",
                    "total_cost": total_cost,
                }
            )

        from apps.ksef.models import ReceivedKSeFInvoice
        opex_qs = (
            ReceivedKSeFInvoice.objects.filter(
                company=company,
                opex_category__isnull=False,
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                gross_amount__isnull=False,
            )
            .order_by("issue_date", "invoice_number")
        )
        opex_out = [
            {
                "id": str(inv.id),
                "ksef_number": inv.ksef_number,
                "invoice_number": inv.invoice_number or "",
                "issue_date": inv.issue_date.isoformat() if inv.issue_date else "",
                "seller_name": inv.seller_name or "",
                "gross_amount": inv.gross_amount,
                "opex_category": inv.opex_category,
            }
            for inv in opex_qs
        ]

        return Response({"invoices": invoices_out, "pz_documents": pz_out, "opex_invoices": opex_out})


class ProductMarginDetailView(APIView):
    """
    GET /api/reports/product-margin/product-detail/
        ?product_id=<uuid>&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Returns invoice lines and PZ lines for a single product in the period.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        import uuid as _uuid
        company = request.user.current_company
        product_id_raw = request.query_params.get("product_id", "").strip()
        if not product_id_raw:
            raise ValidationError({"product_id": "Required."})
        try:
            product_id = _uuid.UUID(product_id_raw)
        except ValueError:
            raise ValidationError({"product_id": "Must be a valid UUID."})

        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")

        # Invoice lines for this product
        inv_lines = InvoiceItem.objects.filter(
            invoice__company=company,
            product_id=product_id,
            invoice__status__in=[
                Invoice.STATUS_ISSUED,
                Invoice.STATUS_SENT,
                Invoice.STATUS_PAID,
                Invoice.STATUS_OVERDUE,
            ],
        ).select_related("invoice", "invoice__customer")
        if date_from:
            inv_lines = inv_lines.filter(invoice__issue_date__gte=date_from)
        if date_to:
            inv_lines = inv_lines.filter(invoice__issue_date__lte=date_to)
        inv_lines = inv_lines.order_by("invoice__issue_date", "invoice__invoice_number")

        # PZ lines for this product (date-filtered — what was received in the period)
        _pz_base = DeliveryItem.objects.filter(
            delivery_document__company=company,
            product_id=product_id,
            delivery_document__document_type=DeliveryDocument.DOC_TYPE_PZ,
            delivery_document__status=DeliveryDocument.STATUS_DELIVERED,
            unit_cost__isnull=False,
        ).select_related("delivery_document", "delivery_document__from_supplier")

        pz_lines = _pz_base
        if date_from:
            pz_lines = pz_lines.filter(delivery_document__issue_date__gte=date_from)
        if date_to:
            pz_lines = pz_lines.filter(delivery_document__issue_date__lte=date_to)
        pz_lines = pz_lines.order_by("delivery_document__issue_date", "delivery_document__document_number")

        # All-time cost history (last 20 PZ receipts) — explains current avg_cost for purchased goods
        cost_history = _pz_base.order_by("-delivery_document__issue_date")[:20]

        # Production order history (last 20) — explains avg_cost for manufactured goods
        production_history = (
            ProductionOrder.objects.filter(
                recipe__company=company,
                recipe__product_id=product_id,
                status=ProductionOrder.STATUS_COMPLETED,
                real_unit_cost__isnull=False,
            )
            .order_by("-completed_at")[:20]
        )

        # Current product avg/last cost
        try:
            product = Product.objects.get(pk=product_id, company=company)
            current_avg_cost = product.avg_cost
            current_last_cost = product.last_cost
            avg_cost_updated_at = product.avg_cost_updated_at.isoformat() if product.avg_cost_updated_at else None
        except Product.DoesNotExist:
            current_avg_cost = None
            current_last_cost = None
            avg_cost_updated_at = None

        invoices_out = [
            {
                "invoice_id": str(line.invoice_id),
                "invoice_number": line.invoice.invoice_number or "",
                "issue_date": line.invoice.issue_date.isoformat(),
                "customer_name": line.invoice.customer.name if line.invoice.customer_id else "",
                "quantity": line.quantity,
                "unit_price_net": line.unit_price_net,
                "line_gross": line.line_gross,
                "status": line.invoice.status,
            }
            for line in inv_lines
        ]

        def _pz_line_dict(line):
            return {
                "pz_id": str(line.delivery_document_id),
                "document_number": line.delivery_document.document_number or "",
                "issue_date": line.delivery_document.issue_date.isoformat(),
                "supplier_name": line.delivery_document.from_supplier.name if line.delivery_document.from_supplier_id else "",
                "quantity": line.quantity_actual if line.quantity_actual is not None else line.quantity_planned,
                "unit_cost": line.unit_cost,
                "line_cost": (line.unit_cost or Decimal("0")) * (line.quantity_actual or line.quantity_planned),
            }

        pz_out = [_pz_line_dict(line) for line in pz_lines]
        cost_history_out = [_pz_line_dict(line) for line in cost_history]

        production_history_out = [
            {
                "order_number": po.order_number,
                "completed_at": po.completed_at.date().isoformat() if po.completed_at else None,
                "quantity_produced": po.quantity_produced,
                "real_unit_cost": po.real_unit_cost,
                "total_input_cost": po.total_input_cost,
            }
            for po in production_history
        ]

        return Response({
            "invoice_lines": invoices_out,
            "pz_lines": pz_out,
            "cost_history": cost_history_out,
            "production_history": production_history_out,
            "avg_cost": current_avg_cost,
            "last_cost": current_last_cost,
            "avg_cost_updated_at": avg_cost_updated_at,
        })


class ProductMarginView(APIView):
    """
    GET /api/reports/product-margin/

    Per-product margin report: for each product sold in the period, shows
    total revenue, total COGS (avg_cost × qty sold), gross margin, and margin %.

    Uses Product.avg_cost as the cost basis. Products without avg_cost show
    cost as null (purchasing module not in use or no PZ receipts yet).

    Query params:
      date_from  YYYY-MM-DD
      date_to    YYYY-MM-DD
      limit      int (default 50, max 200)
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        limit = _limit_from_request(request, default=50, max_limit=200)

        items = InvoiceItem.objects.filter(
            invoice__company=company,
            invoice__status__in=[
                Invoice.STATUS_ISSUED,
                Invoice.STATUS_SENT,
                Invoice.STATUS_PAID,
                Invoice.STATUS_OVERDUE,
            ],
        )
        if date_from:
            items = items.filter(invoice__issue_date__gte=date_from)
        if date_to:
            items = items.filter(invoice__issue_date__lte=date_to)

        rows = list(
            items.values("product_id")
            .annotate(
                productName=Max("product_name"),
                totalQty=Sum("quantity"),
                totalRevenue=Coalesce(
                    Sum("line_gross"), Value(Decimal("0"), output_field=_MONEY)
                ),
                lastCostOnProduct=Max("product__last_cost"),
            )
            .order_by("-totalRevenue")[:limit]
        )

        # Fetch products for cost resolution (includes recipe fallback)
        product_ids = [r["product_id"] for r in rows if r["product_id"]]
        products_by_id = {
            str(p.id): p
            for p in Product.objects.filter(id__in=product_ids).prefetch_related("recipes__items__ingredient")
        }
        # Cache cost resolution per product
        cost_cache: dict = {}

        out = []
        for r in rows:
            revenue = r["totalRevenue"] or Decimal("0")
            qty = r["totalQty"] or Decimal("0")
            pid = str(r["product_id"]) if r["product_id"] else None

            product = products_by_id.get(pid) if pid else None
            if product and pid not in cost_cache:
                cost_cache[pid] = _resolve_product_cost(product)
            real_cost, cost_source = cost_cache.get(pid, (None, None)) if pid else (None, None)

            # Real COGS (from avg_cost, set by PZ/production/manual)
            real_avg_cost = product.avg_cost if product else None
            real_cogs = (real_avg_cost * qty).quantize(Decimal("0.01")) if real_avg_cost is not None else None
            real_gross_profit = (revenue - real_cogs) if real_cogs is not None else None
            real_margin_pct = (
                round(float(real_gross_profit / revenue * 100), 1)
                if real_gross_profit is not None and revenue > 0
                else None
            )

            # Estimated COGS (recipe fallback — only meaningful when real_cost is missing)
            if cost_source == "recipe_estimate" and real_cost is not None:
                est_cogs = (real_cost * qty).quantize(Decimal("0.01"))
                est_gross_profit = (revenue - est_cogs)
                est_margin_pct = round(float(est_gross_profit / revenue * 100), 1) if revenue > 0 else None
            else:
                est_cogs = None
                est_gross_profit = None
                est_margin_pct = None

            out.append(
                {
                    "productId": pid,
                    "productName": r["productName"] or "",
                    "totalQty": qty,
                    "totalRevenue": revenue,
                    "avgCost": real_avg_cost,
                    "lastCost": r["lastCostOnProduct"],
                    "costSource": product.avg_cost_source if product else None,
                    # Real COGS columns
                    "cogs": real_cogs,
                    "grossProfit": real_gross_profit,
                    "marginPercent": real_margin_pct,
                    # Estimated columns (recipe fallback, null when real data exists)
                    "estimatedCogs": est_cogs,
                    "estimatedGrossProfit": est_gross_profit,
                    "estimatedMarginPercent": est_margin_pct,
                }
            )
        if request.query_params.get("export") == "csv":
            csv_rows = [
                [
                    item["productName"],
                    item["totalQty"],
                    item["totalRevenue"],
                    item["cogs"] if item["cogs"] is not None else "",
                    f"{item['marginPercent']}" if item["marginPercent"] is not None else "",
                ]
                for item in out
            ]
            return _csv_response(
                ["Produkt", "Sprzedana ilość", "Przychód", "Koszt własny", "Marża %"],
                csv_rows,
                "marze-produktow.csv",
            )
        return Response(out)


class PaymentAgingView(APIView):
    """
    GET /api/reports/payment-aging/

    Accounts receivable aging: unpaid invoices grouped into buckets by days overdue.

    Buckets:
      current  — not yet due (days_overdue <= 0)
      1_30     — 1–30 days overdue
      31_60    — 31–60 days overdue
      61_90    — 61–90 days overdue
      over_90  — > 90 days overdue
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        from datetime import date as _date

        company = request.user.current_company
        today = _date.today()

        invoices = Invoice.objects.filter(
            company=company,
            status__in=[
                Invoice.STATUS_ISSUED,
                Invoice.STATUS_SENT,
                Invoice.STATUS_OVERDUE,
            ],
        ).select_related("customer").order_by("due_date")

        rows = []
        buckets = {
            "current": Decimal("0"),
            "1_30": Decimal("0"),
            "31_60": Decimal("0"),
            "61_90": Decimal("0"),
            "over_90": Decimal("0"),
        }

        for inv in invoices:
            due = inv.due_date
            days_overdue = (today - due).days if due else 0
            amount = inv.total_gross or Decimal("0")

            if days_overdue <= 0:
                bucket = "current"
            elif days_overdue <= 30:
                bucket = "1_30"
            elif days_overdue <= 60:
                bucket = "31_60"
            elif days_overdue <= 90:
                bucket = "61_90"
            else:
                bucket = "over_90"

            buckets[bucket] += amount
            rows.append(
                {
                    "invoice_id": str(inv.id),
                    "invoice_number": inv.invoice_number or "",
                    "issue_date": inv.issue_date.isoformat() if inv.issue_date else None,
                    "due_date": due.isoformat() if due else None,
                    "days_overdue": days_overdue,
                    "bucket": bucket,
                    "customer_name": inv.customer.name if inv.customer_id else "",
                    "total_gross": amount,
                    "status": inv.status,
                }
            )

        total = sum(buckets.values())
        if request.query_params.get("export") == "csv":
            csv_rows = [
                [
                    r["invoice_number"],
                    r["customer_name"],
                    r["issue_date"] or "",
                    r["due_date"] or "",
                    r["days_overdue"],
                    r["total_gross"],
                ]
                for r in rows
            ]
            return _csv_response(
                ["Faktura", "Klient", "Data wystawienia", "Termin płatności", "Dni po terminie", "Kwota"],
                csv_rows,
                "raport-naleznosci.csv",
            )
        return Response(
            {
                "rows": rows,
                "buckets": buckets,
                "total_outstanding": total,
                "as_of": today.isoformat(),
            }
        )


class SupplierCostsView(APIView):
    """
    GET /api/reports/supplier-costs/

    Purchase costs per supplier per month, based on delivered PZ documents.

    Query params:
      date_from  YYYY-MM-DD
      date_to    YYYY-MM-DD
      limit      int (default 20 suppliers, max 100)
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        limit = _limit_from_request(request, default=20, max_limit=100)

        base = DeliveryItem.objects.filter(
            delivery_document__company=company,
            delivery_document__document_type=DeliveryDocument.DOC_TYPE_PZ,
            delivery_document__status=DeliveryDocument.STATUS_DELIVERED,
            unit_cost__isnull=False,
        ).select_related("delivery_document", "delivery_document__from_supplier")

        if date_from:
            base = base.filter(delivery_document__issue_date__gte=date_from)
        if date_to:
            base = base.filter(delivery_document__issue_date__lte=date_to)

        # Aggregate in Python — avoids ORM alias/expression reuse issues
        supplier_map: dict = {}
        for item in base:
            doc = item.delivery_document
            sid = str(doc.from_supplier_id) if doc.from_supplier_id else "__unknown__"
            supplier_name = (doc.from_supplier.name if doc.from_supplier_id else None) or "Nieznany dostawca"
            qty = item.quantity_actual if item.quantity_actual is not None else item.quantity_planned
            line_cost = (item.unit_cost * qty).quantize(Decimal("0.01"))
            month_key = doc.issue_date.strftime("%Y-%m") if doc.issue_date else "?"

            if sid not in supplier_map:
                supplier_map[sid] = {
                    "supplier_id": sid if sid != "__unknown__" else None,
                    "supplier_name": supplier_name,
                    "monthly": {},
                    "total": Decimal("0"),
                }
            supplier_map[sid]["monthly"][month_key] = (
                supplier_map[sid]["monthly"].get(month_key, Decimal("0")) + line_cost
            )
            supplier_map[sid]["total"] += line_cost

        # Sort by total desc, keep only top `limit`
        suppliers_out = sorted(supplier_map.values(), key=lambda x: x["total"], reverse=True)[:limit]
        months_set = sorted({m for s in suppliers_out for m in s["monthly"]})

        if request.query_params.get("export") == "csv":
            csv_rows = [
                [
                    s["supplier_name"],
                    sum(1 for _ in s["monthly"]),  # approximate PZ count by month count
                    s["total"],
                ]
                for s in suppliers_out
            ]
            return _csv_response(
                ["Dostawca", "Liczba miesięcy", "Łączny koszt"],
                csv_rows,
                "koszty-dostawcow.csv",
            )
        return Response({"months": months_set, "suppliers": suppliers_out})


class SupplierCostsDetailView(APIView):
    """
    GET /api/reports/supplier-costs/detail/
        ?supplier_id=<uuid>&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Returns individual PZ documents for a supplier in the period.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        import uuid as _uuid

        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        supplier_id_raw = request.query_params.get("supplier_id", "").strip()

        try:
            supplier_id = _uuid.UUID(supplier_id_raw) if supplier_id_raw else None
        except ValueError:
            raise ValidationError({"supplier_id": "Must be a valid UUID."})

        docs = DeliveryDocument.objects.filter(
            company=company,
            document_type=DeliveryDocument.DOC_TYPE_PZ,
            status=DeliveryDocument.STATUS_DELIVERED,
        ).select_related("from_supplier")

        if supplier_id:
            docs = docs.filter(from_supplier_id=supplier_id)
        else:
            docs = docs.filter(from_supplier_id__isnull=True)

        if date_from:
            docs = docs.filter(issue_date__gte=date_from)
        if date_to:
            docs = docs.filter(issue_date__lte=date_to)

        docs = docs.prefetch_related("items").order_by("-issue_date")

        out = []
        for doc in docs:
            total_cost = sum(
                (
                    (item.unit_cost or Decimal("0")) * (item.quantity_actual if item.quantity_actual is not None else item.quantity_planned)
                    for item in doc.items.all()
                    if item.unit_cost is not None
                ),
                Decimal("0"),
            )
            out.append(
                {
                    "pz_id": str(doc.id),
                    "document_number": doc.document_number or "",
                    "issue_date": doc.issue_date.isoformat() if doc.issue_date else None,
                    "total_cost": total_cost.quantize(Decimal("0.01")),
                    "item_count": doc.items.count(),
                }
            )

        return Response({"documents": out})


class ExpiryAlertsView(APIView):
    """
    GET /api/reports/expiry-alerts/
        ?days=90  (default 90, max 365)

    Returns StockBatch rows where expiry_date is not null and within
    `days` days from today (includes already-expired batches with daysUntilExpiry < 0).
    Only batches with quantity_remaining > 0 are included.
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        from datetime import date as _date

        company = request.user.current_company
        today = _date.today()

        try:
            horizon_days = int(request.query_params.get("days", 90))
        except (ValueError, TypeError):
            horizon_days = 90
        horizon_days = min(max(horizon_days, 1), 365)
        cutoff = today + timedelta(days=horizon_days)

        batches = (
            StockBatch.objects.filter(
                company=company,
                expiry_date__isnull=False,
                expiry_date__lte=cutoff,
                quantity_remaining__gt=0,
            )
            .select_related("product", "warehouse")
            .order_by("expiry_date")
        )

        out = [
            {
                "batchId": str(b.id),
                "productId": str(b.product_id),
                "productName": b.product.name,
                "warehouseCode": b.warehouse.code if b.warehouse_id else "",
                "batchNumber": b.batch_number or "",
                "expiryDate": b.expiry_date.isoformat(),
                "daysUntilExpiry": (b.expiry_date - today).days,
                "quantityRemaining": b.quantity_remaining,
                "unitCost": b.unit_cost,
                "expired": (b.expiry_date - today).days < 0,
            }
            for b in batches
        ]
        return Response(out)


class CustomerMarginView(APIView):
    """
    GET /api/reports/customer-margin/

    Per-customer margin: invoice revenue vs COGS (Product.avg_cost × qty sold).
    If ANY invoice line for a customer is missing avg_cost, cogsComplete=false
    and cogs/grossProfit/marginPercent are null for that customer.

    Query params:
      date_from  YYYY-MM-DD
      date_to    YYYY-MM-DD
      limit      int (default 50, max 200)
    """

    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        date_from = _optional_query_date(request, "date_from")
        date_to = _optional_query_date(request, "date_to")
        limit = _limit_from_request(request, default=50, max_limit=200)

        items = InvoiceItem.objects.filter(
            invoice__company=company,
            invoice__status__in=[
                Invoice.STATUS_ISSUED,
                Invoice.STATUS_SENT,
                Invoice.STATUS_PAID,
                Invoice.STATUS_OVERDUE,
            ],
        ).select_related("invoice__customer", "product")

        if date_from:
            items = items.filter(invoice__issue_date__gte=date_from)
        if date_to:
            items = items.filter(invoice__issue_date__lte=date_to)

        customer_map: dict = {}
        missing_cost_products: dict = {}
        product_cost_cache: dict = {}

        for item in items:
            cid = str(item.invoice.customer_id) if item.invoice.customer_id else "__unknown__"
            cname = (item.invoice.customer.name if item.invoice.customer_id else None) or "Nieznany klient"

            if cid not in customer_map:
                customer_map[cid] = {
                    "customerId": cid if cid != "__unknown__" else None,
                    "customerName": cname,
                    "invoiceIds": set(),
                    "totalRevenue": Decimal("0"),
                    "realCogs": Decimal("0"),
                    "realCogsComplete": True,
                    "estimatedCogs": Decimal("0"),
                    "estimatedCogsComplete": True,
                    "hasEstimate": False,
                }

            customer_map[cid]["invoiceIds"].add(str(item.invoice_id))
            customer_map[cid]["totalRevenue"] += item.line_gross or Decimal("0")

            qty = item.quantity or Decimal("0")
            product = item.product if item.product_id else None

            if product:
                pid = str(item.product_id)
                if pid not in product_cost_cache:
                    product_cost_cache[pid] = (product.avg_cost, *_resolve_product_cost(product))
                real_avg_cost, resolved_cost, cost_source = product_cost_cache[pid]
            else:
                real_avg_cost, resolved_cost, cost_source = None, None, None

            # Real COGS
            if real_avg_cost is not None:
                customer_map[cid]["realCogs"] += (real_avg_cost * qty).quantize(Decimal("0.01"))
            else:
                customer_map[cid]["realCogsComplete"] = False
                if product:
                    pid = str(item.product_id)
                    if pid not in missing_cost_products and cost_source != "recipe_estimate":
                        missing_cost_products[pid] = product.name

            # Estimated COGS (recipe fallback)
            if resolved_cost is not None:
                customer_map[cid]["estimatedCogs"] += (resolved_cost * qty).quantize(Decimal("0.01"))
                if cost_source == "recipe_estimate":
                    customer_map[cid]["hasEstimate"] = True
            else:
                customer_map[cid]["estimatedCogsComplete"] = False
                if product:
                    pid = str(item.product_id)
                    if pid not in missing_cost_products:
                        missing_cost_products[pid] = product.name

        out = []
        for entry in sorted(customer_map.values(), key=lambda x: x["totalRevenue"], reverse=True)[:limit]:
            revenue = entry["totalRevenue"].quantize(Decimal("0.01"))

            # Real COGS (from avg_cost)
            real_complete = entry["realCogsComplete"]
            real_cogs = entry["realCogs"].quantize(Decimal("0.01")) if real_complete else None
            real_profit = (revenue - real_cogs) if real_cogs is not None else None
            real_margin = (
                round(float(real_profit / revenue * 100), 1)
                if real_profit is not None and revenue > 0
                else None
            )

            # Estimated COGS (recipe fallback when any line used recipe)
            est_complete = entry["estimatedCogsComplete"]
            has_estimate = entry["hasEstimate"]
            est_cogs = entry["estimatedCogs"].quantize(Decimal("0.01")) if est_complete and has_estimate else None
            est_profit = (revenue - est_cogs) if est_cogs is not None else None
            est_margin = (
                round(float(est_profit / revenue * 100), 1)
                if est_profit is not None and revenue > 0
                else None
            )

            out.append({
                "customerId": entry["customerId"],
                "customerName": entry["customerName"],
                "invoiceCount": len(entry["invoiceIds"]),
                "totalRevenue": revenue,
                # Real cost columns
                "cogs": real_cogs,
                "grossProfit": real_profit,
                "marginPercent": real_margin,
                "cogsComplete": real_complete,
                # Estimated cost columns (recipe fallback)
                "estimatedCogs": est_cogs,
                "estimatedGrossProfit": est_profit,
                "estimatedMarginPercent": est_margin,
                "hasEstimate": has_estimate,
            })

        products_missing = [
            {"productId": pid, "productName": name}
            for pid, name in sorted(missing_cost_products.items(), key=lambda x: x[1])
        ]

        return Response({"rows": out, "productsMissingCost": products_missing})
