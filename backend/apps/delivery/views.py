from decimal import Decimal

from django.db import transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.orders.models import Order
from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import DeliveryDocumentFilter
from .models import DeliveryDocument, DeliveryItem
from .serializers import DeliveryCompleteSerializer, DeliveryDocumentSerializer


class DeliveryDocumentViewSet(viewsets.ModelViewSet):
    """CRUD for delivery documents, scoped to ``request.user.current_company``."""

    serializer_class = DeliveryDocumentSerializer
    permission_classes = [IsAuthenticated, IsCompanyMember]
    filterset_class = DeliveryDocumentFilter
    filter_backends = [
        DjangoFilterBackend,
        filters.OrderingFilter,
    ]
    ordering_fields = ("issue_date", "created_at", "document_number", "status")
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet:
        qs = (
            DeliveryDocument.objects.all()
            .select_related(
                "company",
                "order",
                "order__customer",
                "user",
                "from_warehouse",
                "to_warehouse",
                "to_customer",
            )
            .prefetch_related("items", "items__product", "items__order_item")
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=True, methods=["post"], url_path="save")
    def save(self, request, pk=None):
        """draft → saved."""
        doc = self.get_object()
        if doc.status != DeliveryDocument.STATUS_DRAFT:
            return Response(
                {"error": "Only draft documents can be saved."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        doc.status = DeliveryDocument.STATUS_SAVED
        doc.user = request.user
        doc.save(update_fields=["status", "user", "updated_at"])
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="start-delivery")
    def start_delivery(self, request, pk=None):
        """saved → in_transit."""
        doc = self.get_object()
        if doc.status != DeliveryDocument.STATUS_SAVED:
            return Response(
                {"error": "Only saved documents can start delivery."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        doc.status = DeliveryDocument.STATUS_IN_TRANSIT
        doc.user = request.user
        doc.save(update_fields=["status", "user", "updated_at"])
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """in_transit → delivered; apply actual quantities and returns; sync order lines."""
        doc = self.get_object()
        if doc.status != DeliveryDocument.STATUS_IN_TRANSIT:
            return Response(
                {"error": "Only documents in transit can be completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = DeliveryCompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        rows = data.get("items") or []
        payload_by_id = {str(row["id"]): row for row in rows}

        doc_items = list(doc.items.select_related("order_item"))
        valid_ids = {str(i.id) for i in doc_items}
        extra = set(payload_by_id) - valid_ids
        if extra:
            return Response(
                {"error": f"Unknown delivery item id(s): {', '.join(sorted(extra))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            any_return = False
            for item in doc_items:
                row = payload_by_id.get(str(item.id))
                if row:
                    actual = row.get("quantity_actual")
                    ret = row.get("quantity_returned")
                    if ret is None:
                        ret = Decimal("0")
                    reason = row.get("return_reason", "")
                    is_damaged = row.get("is_damaged", False)
                    notes = row.get("notes", "")
                else:
                    actual = None
                    ret = Decimal("0")
                    reason = ""
                    is_damaged = False
                    notes = ""

                if actual is None:
                    actual = item.quantity_planned
                if ret < 0 or actual < 0:
                    return Response(
                        {"error": "Quantities cannot be negative."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if ret > actual:
                    return Response(
                        {
                            "error": (
                                f"quantity_returned cannot exceed quantity_actual "
                                f"for item {item.id}."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                oi = item.order_item
                oi.refresh_from_db()
                net = actual - ret
                if oi.quantity_delivered + net > oi.quantity:
                    return Response(
                        {
                            "error": (
                                f"Order line {oi.id} would exceed ordered quantity "
                                f"({oi.quantity_delivered} + {net} > {oi.quantity})."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                item.quantity_actual = actual
                item.quantity_returned = ret
                item.return_reason = reason or ""
                item.is_damaged = is_damaged
                item.notes = notes or ""
                item.save(
                    update_fields=[
                        "quantity_actual",
                        "quantity_returned",
                        "return_reason",
                        "is_damaged",
                        "notes",
                    ]
                )

                oi.quantity_delivered += net
                oi.quantity_returned += ret
                oi.save(update_fields=["quantity_delivered", "quantity_returned"])

                if ret > 0:
                    any_return = True

            doc.status = DeliveryDocument.STATUS_DELIVERED
            doc.delivered_at = timezone.now()
            doc.user = request.user
            if data.get("receiver_name") is not None:
                doc.receiver_name = data["receiver_name"]
            if data.get("returns_notes") is not None:
                doc.returns_notes = data["returns_notes"]
            if "has_returns" in data:
                doc.has_returns = bool(data["has_returns"])
            else:
                doc.has_returns = any_return
            doc.save(
                update_fields=[
                    "status",
                    "delivered_at",
                    "user",
                    "receiver_name",
                    "returns_notes",
                    "has_returns",
                    "updated_at",
                ]
            )

            order = Order.objects.select_for_update().get(pk=doc.order_id)
            lines = list(order.items.all())
            if lines and all(
                (oi.quantity_delivered or Decimal("0")) >= oi.quantity for oi in lines
            ):
                if order.status not in (
                    Order.STATUS_DELIVERED,
                    Order.STATUS_INVOICED,
                    Order.STATUS_CANCELLED,
                ):
                    order.update_status(Order.STATUS_DELIVERED)

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(
        detail=False,
        methods=["get"],
        url_path=r"generate-for-order/(?P<order_id>[^/.]+)",
    )
    def generate_for_order(self, request, order_id=None):
        """Create a draft WZ from a confirmed order (remaining quantities per line)."""
        company_id = request.user.current_company_id
        order = get_object_or_404(
            Order.objects.filter(company_id=company_id),
            pk=order_id,
        )
        if order.status != Order.STATUS_CONFIRMED:
            return Response(
                {"error": "Order must be confirmed to generate a delivery document."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lines = []
        for oi in order.items.select_related("product"):
            remaining = oi.quantity - (oi.quantity_delivered or Decimal("0"))
            if remaining > 0:
                lines.append((oi, remaining))

        if not lines:
            return Response(
                {"error": "No remaining quantity to deliver for this order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            doc = DeliveryDocument.objects.create(
                company=order.company,
                order=order,
                user=request.user,
                document_type=DeliveryDocument.DOC_TYPE_WZ,
                issue_date=timezone.localdate(),
                to_customer=order.customer,
                status=DeliveryDocument.STATUS_DRAFT,
            )
            for oi, qty in lines:
                DeliveryItem.objects.create(
                    delivery_document=doc,
                    order_item=oi,
                    product=oi.product,
                    quantity_planned=qty,
                )

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)
