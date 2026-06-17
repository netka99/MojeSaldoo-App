from decimal import Decimal

from django.db import transaction
from django.db.models import QuerySet
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.products.models import ProductStock
from apps.users.models import Company

from .models import InventoryCount, InventoryCountItem
from .serializers import (
    InventoryCountCreateSerializer,
    InventoryCountItemSerializer,
    InventoryCountSerializer,
)
from .services import complete_inventory_count


class InventoryCountViewSet(viewsets.ModelViewSet):
    """CRUD for inventory count documents, scoped to request.user.current_company."""

    serializer_class = InventoryCountSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self) -> QuerySet:
        company_id = self.request.user.current_company_id
        return (
            InventoryCount.objects.filter(company_id=company_id)
            .select_related("warehouse", "created_by")
            .prefetch_related("items__product")
            .order_by("-created_at")
        )

    def create(self, request, *args, **kwargs):
        """Create INW document and snapshot ProductStock for all products in the warehouse."""
        serializer = InventoryCountCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        company_id = request.user.current_company_id
        warehouse = serializer.validated_data["warehouse"]

        # Validate warehouse belongs to company
        if str(warehouse.company_id) != str(company_id):
            raise ValidationError({"warehouse": "Warehouse does not belong to your company."})

        with transaction.atomic():
            # Lock company row to ensure sequential document number assignment
            Company.objects.select_for_update().get(pk=company_id)

            count = InventoryCount.objects.create(
                company_id=company_id,  # already a UUID via current_company_id
                warehouse=warehouse,
                count_date=serializer.validated_data["count_date"],
                notes=serializer.validated_data.get("notes", ""),
                created_by=request.user,
                status=InventoryCount.STATUS_DRAFT,
            )

            # Snapshot all ProductStock rows for this warehouse
            stocks = ProductStock.objects.filter(
                company_id=company_id,
                warehouse=warehouse,
            ).select_related("product")

            for stock in stocks:
                product = stock.product
                InventoryCountItem.objects.create(
                    inventory_count=count,
                    product=product,
                    product_name=product.name,
                    product_unit=product.unit or "",
                    quantity_system=stock.quantity_available,
                    quantity_actual=None,
                )

        count.refresh_from_db()
        out_serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(out_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """POST :id/complete/ — apply inventory corrections and mark as completed."""
        count = self.get_object()

        if count.status != InventoryCount.STATUS_DRAFT:
            raise ValidationError(
                {"detail": f"Cannot complete an inventory count with status '{count.status}'."}
            )

        complete_inventory_count(count, request.user)
        count.refresh_from_db()
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """POST :id/cancel/ — cancel a draft inventory count."""
        count = self.get_object()

        if count.status != InventoryCount.STATUS_DRAFT:
            raise ValidationError(
                {"detail": f"Only draft inventory counts can be cancelled (current status: '{count.status}')."}
            )

        count.status = InventoryCount.STATUS_CANCELLED
        count.save(update_fields=["status", "updated_at"])
        count.refresh_from_db()
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="update-items")
    def update_items(self, request, pk=None):
        """
        POST :id/update-items/ — bulk update quantity_actual for items.

        Body: {"items": [{"id": "uuid", "quantity_actual": 5.0, "notes": ""}]}
        """
        count = self.get_object()

        if count.status != InventoryCount.STATUS_DRAFT:
            raise ValidationError(
                {"detail": f"Cannot update items on an inventory count with status '{count.status}'."}
            )

        items_payload = request.data.get("items", [])
        if not isinstance(items_payload, list):
            raise ValidationError({"items": "Expected a list."})

        # Build lookup of existing items
        existing_items = {str(item.id): item for item in count.items.all()}

        updated = []
        for row in items_payload:
            item_id = str(row.get("id", ""))
            if item_id not in existing_items:
                raise ValidationError({"items": f"Unknown item id: {item_id}"})

            item = existing_items[item_id]

            qty_actual = row.get("quantity_actual")
            if qty_actual is not None:
                try:
                    item.quantity_actual = Decimal(str(qty_actual))
                except Exception:
                    raise ValidationError({"items": f"Invalid quantity_actual for item {item_id}"})
            else:
                item.quantity_actual = None

            if "notes" in row:
                item.notes = (row.get("notes") or "").strip()

            item.save(update_fields=["quantity_actual", "notes"])
            updated.append(item)

        serializer = InventoryCountItemSerializer(updated, many=True, context={"request": request})
        return Response({"updated": serializer.data})
