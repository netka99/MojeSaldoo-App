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
from apps.users.permissions import HasCompanyPermission, IsCompanyMember
from apps.activity.log import log_error, log_success

from .models import InventoryCount, InventoryCountItem
from .serializers import (
    InventoryCountCreateSerializer,
    InventoryCountItemSerializer,
    InventoryCountSerializer,
)
from .services import complete_inventory_count


class InventoryCountViewSet(viewsets.ModelViewSet):
    """CRUD for inventory count documents, scoped to request.user.current_company."""
    lookup_field = "uuid"

    serializer_class = InventoryCountSerializer
    required_permission = 'can_manage_inventory'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    http_method_names = ["get", "post", "delete", "head", "options"]

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

            # Snapshot all non-service products for this company.
            # Use ProductStock quantity where available, 0 otherwise.
            from apps.products.models import Product
            all_products = (
                Product.objects.filter(company_id=company_id, is_active=True)
                .exclude(product_type=Product.PRODUCT_TYPE_SERVICE)
                .order_by("name")
            )
            stock_map = {
                str(s.product_id): s.quantity_available
                for s in ProductStock.objects.filter(
                    company_id=company_id, warehouse=warehouse
                )
            }
            for product in all_products:
                InventoryCountItem.objects.create(
                    inventory_count=count,
                    product=product,
                    product_name=product.name,
                    product_unit=product.unit or "",
                    quantity_system=stock_map.get(str(product.id), 0),
                    quantity_actual=None,
                )

        count.refresh_from_db()
        out_serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(out_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, uuid=None):
        """POST :id/complete/ — apply inventory corrections and mark as completed."""
        count = self.get_object()

        if count.status != InventoryCount.STATUS_DRAFT:
            log_error(
                user=request.user, action="inventory.complete", error_code="DELIVERY_WRONG_STATUS",
                error_detail=f"Status inwentaryzacji: {count.status}.",
                object_type="inventory", object_id=count.document_number or str(count.uuid),
                request=request,
            )
            raise ValidationError(
                {"detail": f"Cannot complete an inventory count with status '{count.status}'."}
            )

        complete_inventory_count(count, request.user)
        count.refresh_from_db()
        log_success(
            user=request.user, action="inventory.complete",
            object_type="inventory", object_id=count.document_number or str(count.uuid),
        )
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, uuid=None):
        """POST :id/cancel/ — cancel a draft inventory count."""
        count = self.get_object()

        if count.status != InventoryCount.STATUS_DRAFT:
            log_error(
                user=request.user, action="inventory.cancel", error_code="DELIVERY_WRONG_STATUS",
                error_detail=f"Status inwentaryzacji: {count.status}.",
                object_type="inventory", object_id=count.document_number or str(count.uuid),
                request=request,
            )
            raise ValidationError(
                {"detail": f"Only draft inventory counts can be cancelled (current status: '{count.status}')."}
            )

        count.status = InventoryCount.STATUS_CANCELLED
        count.save(update_fields=["status", "updated_at"])
        count.refresh_from_db()
        log_success(
            user=request.user, action="inventory.cancel",
            object_type="inventory", object_id=count.document_number or str(count.uuid),
        )
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    def destroy(self, request, uuid=None):
        """DELETE :id/ — permanently delete a draft or cancelled inventory count."""
        count = self.get_object()

        if count.status == InventoryCount.STATUS_COMPLETED:
            raise ValidationError(
                {"detail": "Zakończona inwentaryzacja nie może być usunięta."}
            )

        doc_number = count.document_number or str(count.uuid)
        count.delete()
        log_success(
            user=request.user, action="inventory.delete",
            object_type="inventory", object_id=doc_number,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="remove-item")
    def remove_item(self, request, uuid=None):
        """POST :id/remove-item/ — remove a single item from a draft inventory count."""
        count = self.get_object()
        if count.status != InventoryCount.STATUS_DRAFT:
            raise ValidationError({"detail": "Można usuwać pozycje tylko ze szkicu."})

        item_id = request.data.get("item_id")
        if not item_id:
            raise ValidationError({"item_id": "Wymagane."})

        deleted, _ = count.items.filter(uuid=item_id).delete()
        if not deleted:
            raise ValidationError({"item_id": "Nie znaleziono pozycji."})

        count.refresh_from_db()
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="add-item")
    def add_item(self, request, uuid=None):
        """POST :id/add-item/ — add a product to a draft inventory count.

        Body option A (existing product): { "product_id": "<uuid>" }
        Body option B (manual item):      { "name": "Jabłka", "unit": "kg" }
        """
        from apps.products.models import Product, ProductStock

        count = self.get_object()
        if count.status != InventoryCount.STATUS_DRAFT:
            raise ValidationError({"detail": "Można dodawać pozycje tylko do szkicu."})

        company_id = request.user.current_company_id
        product_id = request.data.get("product_id")

        if product_id:
            # Option A — existing product
            try:
                product = Product.objects.get(id=product_id, company_id=company_id, is_active=True)
            except Product.DoesNotExist:
                raise ValidationError({"product_id": "Produkt nie istnieje."})

            if product.product_type == Product.PRODUCT_TYPE_SERVICE:
                raise ValidationError({"product_id": "Usług nie można dodawać do inwentaryzacji."})

            if count.items.filter(product=product).exists():
                raise ValidationError({"product_id": "Ten produkt jest już na liście."})

            stock = ProductStock.objects.filter(
                company_id=company_id, warehouse=count.warehouse, product=product
            ).first()

            InventoryCountItem.objects.create(
                inventory_count=count,
                product=product,
                product_name=product.name,
                product_unit=product.unit or "",
                quantity_system=stock.quantity_available if stock else 0,
                quantity_actual=None,
            )
        else:
            # Option B — manual item (no product FK)
            name = (request.data.get("name") or "").strip()
            unit = (request.data.get("unit") or "").strip()
            if not name:
                raise ValidationError({"name": "Nazwa jest wymagana."})

            InventoryCountItem.objects.create(
                inventory_count=count,
                product=None,
                product_name=name,
                product_unit=unit,
                quantity_system=0,
                quantity_actual=None,
            )

        count.refresh_from_db()
        serializer = InventoryCountSerializer(count, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="update-items")
    def update_items(self, request, uuid=None):
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
        existing_items = {str(item.uuid): item for item in count.items.all()}

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
