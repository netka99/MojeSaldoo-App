from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils.dateparse import parse_date
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.log import log_error, log_success
from apps.users.permissions import HasCompanyPermission, IsCompanyMember, ModuleRequired
from apps.users.tenant import filter_queryset_for_current_company

from .models import SupplierOrder, SupplierOrderItem
from .serializers import (
    SupplierOrderItemWriteSerializer,
    SupplierOrderSerializer,
    SupplierOrderWriteSerializer,
)


class SupplierOrderViewSet(viewsets.ModelViewSet):
    """
    CRUD for Zamówienia do Dostawców (ZD — Purchase Orders).

    Endpoints:
      GET    /api/purchase-orders/           — list
      POST   /api/purchase-orders/           — create
      GET    /api/purchase-orders/{id}/      — detail
      PATCH  /api/purchase-orders/{id}/      — update
      DELETE /api/purchase-orders/{id}/      — cancel (soft, sets status=cancelled)
      POST   /api/purchase-orders/{id}/send/ — mark as sent (draft → sent)
      POST   /api/purchase-orders/{id}/create-pz/ — generate PZ from this ZD
    """

    lookup_field = "uuid"
    serializer_class = SupplierOrderSerializer
    module_required = "purchase_orders"
    required_permission = "can_manage_purchase_orders"
    permission_classes = [IsAuthenticated, IsCompanyMember, ModuleRequired, HasCompanyPermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["document_number", "supplier_name", "notes"]
    ordering_fields = ["issue_date", "created_at", "status", "expected_delivery_date"]
    ordering = ["-issue_date", "-created_at"]

    def get_queryset(self):
        qs = (
            SupplierOrder.objects.all()
            .select_related("supplier", "source_order")
            .prefetch_related("items__product")
        )
        qs = filter_queryset_for_current_company(qs, self.request.user)

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        supplier_id = self.request.query_params.get("supplier_id")
        if supplier_id:
            qs = qs.filter(supplier__uuid=supplier_id)

        return qs

    def create(self, request, *args, **kwargs):
        serializer = SupplierOrderWriteSerializer(
            data=request.data, context={"company": request.user.current_company}
        )
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        with transaction.atomic():
            order = SupplierOrder.objects.create(
                company=request.user.current_company,
                created_by=request.user,
                supplier=d.get("supplier_id"),
                issue_date=d.get("issue_date"),
                expected_delivery_date=d.get("expected_delivery_date"),
                notes=d.get("notes", ""),
            )
            items = [
                SupplierOrderItem(
                    supplier_order=order,
                    product=item["product_id"],
                    quantity_ordered=item["quantity_ordered"],
                    unit_price_net=item.get("unit_price_net"),
                    vat_rate=item.get("vat_rate"),
                    notes=item.get("notes", ""),
                )
                for item in d["items"]
            ]
            SupplierOrderItem.objects.bulk_create(items)

        log_success(
            user=request.user,
            action="purchase_orders.create",
            object_type="purchase_order",
            object_id=order.document_number,
        )
        out = SupplierOrderSerializer(order, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()

        if instance.status not in (SupplierOrder.STATUS_DRAFT, SupplierOrder.STATUS_SENT):
            return Response(
                {"error": "Tylko zamówienia w statusie Szkic lub Wysłane mogą być edytowane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Allow simple field-only partial updates (status, dates, notes)
        updatable = ["expected_delivery_date", "notes"]
        for field in updatable:
            if field in request.data:
                setattr(instance, field, request.data[field] or None if field == "expected_delivery_date" else request.data[field])
        instance.save(update_fields=[*updatable, "updated_at"])

        out = SupplierOrderSerializer(instance, context={"request": request})
        return Response(out.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status == SupplierOrder.STATUS_FULFILLED:
            return Response(
                {"error": "Zamówienie zrealizowane nie może być anulowane."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.status = SupplierOrder.STATUS_CANCELLED
        instance.save(update_fields=["status", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request, uuid=None):
        """Mark ZD as sent to supplier (draft → sent)."""
        instance = self.get_object()
        if instance.status != SupplierOrder.STATUS_DRAFT:
            return Response(
                {"error": "Tylko zamówienie w statusie Szkic może być wysłane."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.status = SupplierOrder.STATUS_SENT
        instance.save(update_fields=["status", "updated_at"])
        out = SupplierOrderSerializer(instance, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"], url_path="create-pz")
    def create_pz(self, request, uuid=None):
        """
        POST /api/purchase-orders/{id}/create-pz/

        Generate a draft PZ (goods receipt) from this ZD.
        Body:
          {
            "to_warehouse_id": "<uuid>",       # required
            "issue_date": "2026-09-20",        # optional, defaults to today
            "notes": "...",                    # optional
            "external_document_number": "...", # optional — supplier's doc number
            "items": [                         # optional — override quantities/costs
              {
                "product_id": "<uuid>",
                "quantity_planned": "10.00",
                "unit_cost": "5.50",
                "batch_number": "LOT-001",
                "expiry_date": "2026-12-31"
              }
            ]
          }
        If `items` is omitted, all ZD lines are used at their ordered quantities.
        """
        from apps.delivery.models import DeliveryDocument, DeliveryItem
        from apps.inventory.models import Warehouse
        from apps.products.models import Product

        supplier_order = self.get_object()
        company = request.user.current_company
        company_id = company.pk

        if supplier_order.status == SupplierOrder.STATUS_CANCELLED:
            return Response(
                {"error": "Anulowane zamówienie nie może generować PZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if supplier_order.status == SupplierOrder.STATUS_FULFILLED:
            return Response(
                {"error": "Zamówienie już w pełni zrealizowane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        to_warehouse_id = request.data.get("to_warehouse_id")
        if not to_warehouse_id:
            return Response(
                {"error": "to_warehouse_id jest wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            warehouse = Warehouse.objects.get(uuid=to_warehouse_id, company_id=company_id)
        except Warehouse.DoesNotExist:
            return Response({"error": "Magazyn nie znaleziony."}, status=status.HTTP_400_BAD_REQUEST)

        from django.utils import timezone
        issue_date = parse_date(request.data.get("issue_date", "") or "") or timezone.localdate()
        notes = request.data.get("notes", "")
        ext_doc = (request.data.get("external_document_number") or "").strip()

        # Build items from request override or fall back to ZD lines
        from .serializers import CreatePzItemOverrideSerializer
        items_data_raw = request.data.get("items")
        if items_data_raw:
            item_serializer = CreatePzItemOverrideSerializer(data=items_data_raw, many=True)
            if not item_serializer.is_valid():
                return Response(item_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            items_by_product = {
                str(item["product_id"].uuid): item
                for item in item_serializer.validated_data
            }
        else:
            items_by_product = None

        zd_items = list(supplier_order.items.select_related("product").all())
        if not zd_items:
            return Response(
                {"error": "ZD nie ma żadnych pozycji."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            pz = DeliveryDocument(
                company=company,
                user=request.user,
                document_type=DeliveryDocument.DOC_TYPE_PZ,
                status=DeliveryDocument.STATUS_DRAFT,
                to_warehouse=warehouse,
                from_supplier=supplier_order.supplier,
                source_supplier_order=supplier_order,
                issue_date=issue_date,
                notes=notes,
                external_document_number=ext_doc,
            )
            pz.save()

            pz_items = []
            for zd_item in zd_items:
                if items_by_product is not None:
                    override = items_by_product.get(str(zd_item.product.uuid))
                    if override is None:
                        continue  # skip lines not included in override
                    qty = override["quantity_ordered"]
                    cost = override.get("unit_cost") or zd_item.unit_price_net or Decimal("0")
                    batch = (override.get("batch_number") or "").strip()
                    expiry = override.get("expiry_date")
                else:
                    qty = zd_item.quantity_ordered
                    cost = zd_item.unit_price_net or Decimal("0")
                    batch = ""
                    expiry = None

                pz_items.append(
                    DeliveryItem(
                        delivery_document=pz,
                        product=zd_item.product,
                        quantity_planned=qty,
                        quantity_actual=qty,
                        unit_cost=cost,
                        batch_number=batch,
                        expiry_date=expiry,
                    )
                )
            DeliveryItem.objects.bulk_create(pz_items)
            # bulk_create doesn't fire post_save signals — sync quantities manually
            from apps.purchase_orders.signals import _sync_received_quantities
            _sync_received_quantities(supplier_order.pk)

        log_success(
            user=request.user,
            action="purchase_orders.create_pz",
            object_type="purchase_order",
            object_id=supplier_order.document_number,
        )

        from apps.delivery.serializers import DeliveryDocumentSerializer
        out = DeliveryDocumentSerializer(pz, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)
