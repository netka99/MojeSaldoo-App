from decimal import Decimal

from django.db import transaction
from django.db.models import DecimalField, QuerySet, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .filters import ProductFilter
from .models import Product, ProductStock, StockMovement, Warehouse
from .serializers import (
    ProductSerializer,
    StockMovementSerializer,
    StockUpdateSerializer,
    WarehouseSerializer,
)
from apps.users.tenant import filter_queryset_for_current_company


def _stock_owner_user(product, request_user):
    return product.user or request_user


class ProductViewSet(viewsets.ModelViewSet):
    """Full CRUD for products in the user's active company."""

    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = ProductFilter
    search_fields = ["name", "description", "sku", "barcode"]
    ordering_fields = [
        "name",
        "unit",
        "price_net",
        "price_gross",
        "vat_rate",
        "min_stock_alert",
        "created_at",
        "updated_at",
        "is_active",
    ]
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet:
        qs = Product.objects.all().order_by("-created_at")
        qs = filter_queryset_for_current_company(qs, self.request.user)
        return qs.annotate(
            _stock_total=Coalesce(
                Sum("stocks__quantity_available"),
                Value(Decimal("0")),
                output_field=DecimalField(max_digits=12, decimal_places=2),
            ),
        )

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=True, methods=["post"], url_path="update-stock")
    def update_stock(self, request, pk=None):
        product = self.get_object()
        input_serializer = StockUpdateSerializer(
            data=request.data,
            context={"product": product, "user": request.user},
        )
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        existing = getattr(input_serializer, "_existing_movement", None)

        warehouse = get_object_or_404(
            Warehouse.objects.filter(company_id=product.company_id),
            pk=data["warehouse_id"],
        )
        qty_change: Decimal = data["quantity_change"]
        movement_type = data.get("movement_type", StockMovement.MovementType.ADJUSTMENT)
        ref_type = (data.get("reference_type") or "").strip() or None
        ref_id = data.get("reference_id")
        notes = data.get("notes", "") or ""

        with transaction.atomic():
            stock = (
                ProductStock.objects.select_for_update()
                .filter(product=product, warehouse=warehouse)
                .first()
            )

            if existing:
                if stock is None:
                    return Response(
                        {
                            "detail": (
                                "Cannot update a movement without a matching "
                                "ProductStock row."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                qty_before = stock.quantity_available - existing.quantity
                new_available = qty_before + qty_change
            else:
                qty_before = stock.quantity_available if stock else Decimal("0")
                new_available = qty_before + qty_change

            if new_available < 0 and not warehouse.allow_negative_stock:
                raise ValidationError(
                    {
                        "quantity_change": (
                            "Resulting quantity_available would be negative "
                            "for this warehouse."
                        )
                    }
                )

            if stock is None:
                stock = ProductStock(
                    company=product.company,
                    product=product,
                    warehouse=warehouse,
                    quantity_available=new_available,
                    quantity_reserved=Decimal("0"),
                )
                stock.save()
            else:
                stock.quantity_available = new_available
                stock.save(update_fields=["quantity_available"])

            movement_user = product.user or request.user

            if existing:
                existing.quantity = qty_change
                existing.quantity_before = qty_before
                existing.quantity_after = new_available
                existing.movement_type = movement_type
                existing.reference_type = ref_type
                existing.reference_id = ref_id
                existing.notes = notes
                existing.created_by = request.user
                existing.save(update_fields=[
                    "quantity",
                    "quantity_before",
                    "quantity_after",
                    "movement_type",
                    "reference_type",
                    "reference_id",
                    "notes",
                    "created_by",
                ])
                movement = existing
                http_status = status.HTTP_200_OK
            else:
                movement = StockMovement.objects.create(
                    company=product.company,
                    product=product,
                    warehouse=warehouse,
                    user=movement_user,
                    movement_type=movement_type,
                    quantity=qty_change,
                    quantity_before=qty_before,
                    quantity_after=new_available,
                    reference_type=ref_type,
                    reference_id=ref_id,
                    notes=notes,
                    created_by=request.user,
                )
                http_status = status.HTTP_201_CREATED

        return Response(
            StockMovementSerializer(movement).data,
            status=http_status,
        )

    @action(detail=False, methods=["get"], url_path="stock-snapshot")
    def stock_snapshot(self, request):
        """Current stock in one warehouse (only lines with ``quantity_available`` > 0)."""
        warehouse_id = request.query_params.get("warehouse_id")
        if not warehouse_id:
            raise ValidationError({"warehouse_id": "This field is required."})
        wh_qs = filter_queryset_for_current_company(
            Warehouse.objects.filter(pk=warehouse_id),
            request.user,
        )
        warehouse = get_object_or_404(wh_qs)
        items = []
        for ps in (
            ProductStock.objects.filter(
                warehouse=warehouse, company_id=warehouse.company_id
            )
            .select_related("product")
            .order_by("product__name")
        ):
            if ps.quantity_available <= 0:
                continue
            p = ps.product
            items.append(
                {
                    "product_id": str(p.id),
                    "product_name": p.name,
                    "sku": p.sku,
                    "unit": p.unit,
                    "quantity_available": f"{ps.quantity_available:.3f}",
                }
            )
        return Response(
            {
                "warehouse_id": str(warehouse.id),
                "warehouse_name": warehouse.name,
                "items": items,
            }
        )


class WarehouseViewSet(viewsets.ModelViewSet):
    """Full CRUD for warehouses in the user's active company."""

    serializer_class = WarehouseSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = [
        "code",
        "name",
        "warehouse_type",
        "is_active",
        "allow_negative_stock",
        "fifo_enabled",
    ]
    search_fields = ["code", "name", "address"]
    ordering_fields = [
        "code",
        "name",
        "warehouse_type",
        "created_at",
        "updated_at",
        "is_active",
    ]
    ordering = ["code"]

    def get_queryset(self) -> QuerySet:
        qs = Warehouse.objects.all().order_by("code")
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )
