from datetime import datetime
from decimal import Decimal

from django.db.models import (
    Avg,
    BooleanField,
    Case,
    Count,
    DecimalField,
    F,
    Max,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.models import DeliveryDocument
from apps.invoices.models import Invoice
from apps.orders.models import Order, OrderItem
from apps.products.models import ProductStock
from apps.users.permissions import IsCompanyMember
from apps.van_routes.models import VanRoute

from .serializers import ReportingInvoiceSerializer, ReportingRejectedInvoiceSerializer

_MONEY = DecimalField(max_digits=14, decimal_places=2)


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
    permission_classes = [IsAuthenticated, IsCompanyMember]

    def get(self, request):
        company = request.user.current_company
        rows = (
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
                "product__name",
                "warehouse__code",
                "quantity_available",
                "product__min_stock_alert",
                "belowMinimum",
            )
        )
        out = [
            {
                "productName": r["product__name"],
                "warehouseCode": r["warehouse__code"],
                "quantityAvailable": r["quantity_available"],
                "minStockAlert": r["product__min_stock_alert"],
                "belowMinimum": r["belowMinimum"],
            }
            for r in rows
        ]
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
        today = __import__('django.utils.timezone', fromlist=['timezone']).timezone.localdate()

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
