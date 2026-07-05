from decimal import Decimal

from django.apps import apps
from django.db.models import Sum
from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer

from .models import CustomerProductPrice, Product, ProductStock, StockMovement, Warehouse


class ProductSerializer(UUIDModelSerializer):
    """Full Product API shape; money/stock amounts use DecimalField (no floats)."""

    price_net = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    price_gross = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    vat_rate = serializers.DecimalField(max_digits=5, decimal_places=2, required=False)
    min_stock_alert = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    avg_cost = serializers.DecimalField(
        max_digits=10, decimal_places=4, required=False, allow_null=True,
    )
    stock_total = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "user",
            "company",
            "name",
            "description",
            "unit",
            "price_net",
            "price_gross",
            "vat_rate",
            "sku",
            "barcode",
            "pkwiu",
            "track_batches",
            "min_stock_alert",
            "shelf_life_days",
            "is_service",
            "is_resalable",
            "markup_percent",
            "avg_cost",
            "avg_cost_source",
            "last_cost",
            "avg_cost_updated_at",
            "is_active",
            "stock_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["user", "company", "last_cost", "avg_cost_updated_at", "stock_total", "created_at", "updated_at"]

    def validate_avg_cost(self, value):
        if value is not None and value < Decimal("0"):
            raise serializers.ValidationError("Koszt własny nie może być ujemny.")
        return value

    def _apply_service_defaults(self, validated_data: dict) -> dict:
        """When is_service=True, force track_batches=False and is_resalable=True."""
        if validated_data.get("is_service", False):
            validated_data["track_batches"] = False
            validated_data["is_resalable"] = True
        return validated_data

    def create(self, validated_data):
        self._apply_service_defaults(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Propagate is_service flag even when not explicitly set in this PATCH
        is_service = validated_data.get("is_service", instance.is_service)
        if is_service:
            validated_data["track_batches"] = False
            validated_data["is_resalable"] = True

        # If avg_cost is being manually set, force source = manual
        # unless a higher-priority source is already set (pz or production)
        if "avg_cost" in validated_data:
            high_priority = {Product.COST_SOURCE_PZ, Product.COST_SOURCE_PRODUCTION}
            if instance.avg_cost_source not in high_priority:
                validated_data.setdefault("avg_cost_source", Product.COST_SOURCE_MANUAL)
                from django.utils import timezone
                validated_data["avg_cost_updated_at"] = timezone.now()
        return super().update(instance, validated_data)

    def get_stock_total(self, obj: Product) -> Decimal:
        """Sum of ``quantity_available`` across all company warehouses; list views annotate ``_stock_total``."""
        annotated = getattr(obj, "_stock_total", None)
        if annotated is not None:
            return annotated
        t = obj.stocks.aggregate(total=Sum("quantity_available"))["total"]
        return t if t is not None else Decimal("0")

    def validate_price_net(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Price net cannot be negative.")
        return value

    def validate_price_gross(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Price gross cannot be negative.")
        return value

    def validate_min_stock_alert(self, value: Decimal) -> Decimal:
        if value < 0:
            raise serializers.ValidationError("Min stock alert cannot be negative.")
        return value


class WarehouseSerializer(UUIDModelSerializer):
    """Full Warehouse API shape (no decimal fields on model)."""

    class Meta:
        model = Warehouse
        fields = [
            "id",
            "user",
            "company",
            "code",
            "name",
            "warehouse_type",
            "address",
            "is_active",
            "allow_negative_stock",
            "fifo_enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["user", "company", "created_at", "updated_at"]


class StockMovementSerializer(UUIDModelSerializer):
    """Read/write representation of a stock movement line."""

    quantity = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity_before = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity_after = serializers.DecimalField(max_digits=10, decimal_places=2)
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "company",
            "product",
            "warehouse",
            "warehouse_code",
            "user",
            "movement_type",
            "quantity",
            "quantity_before",
            "quantity_after",
            "reference_type",
            "reference_id",
            "notes",
            "created_at",
            "created_by",
        ]
        read_only_fields = ["company", "product", "warehouse", "warehouse_code", "user", "movement_type", "quantity", "quantity_before", "quantity_after", "reference_type", "reference_id", "notes", "created_at", "created_by"]


class WarehouseStockItemSerializer(UUIDModelSerializer):
    """ProductStock row enriched with product details — for GET /warehouses/{id}/stock/."""

    product_id = serializers.UUIDField(source="product.uuid", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    product_unit = serializers.CharField(source="product.unit", read_only=True)
    min_stock_alert = serializers.DecimalField(
        source="product.min_stock_alert",
        max_digits=10,
        decimal_places=3,
        read_only=True,
    )
    is_below_minimum = serializers.SerializerMethodField()

    class Meta:
        model = ProductStock
        fields = [
            "id",
            "product_id",
            "product_name",
            "product_sku",
            "product_unit",
            "quantity_available",
            "quantity_reserved",
            "quantity_total",
            "min_stock_alert",
            "is_below_minimum",
        ]

    def get_is_below_minimum(self, obj) -> bool:
        alert = obj.product.min_stock_alert
        if not alert:
            return False
        return obj.quantity_total < alert


class StockMovementListSerializer(UUIDModelSerializer):
    """Rich read-only view of a StockMovement — for GET /products/stock-movements/."""

    product_name = serializers.CharField(source="product.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    reference_number = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "product",
            "product_name",
            "warehouse",
            "warehouse_name",
            "movement_type",
            "quantity",
            "quantity_before",
            "quantity_after",
            "reference_type",
            "reference_id",
            "reference_number",
            "notes",
            "created_at",
            "created_by_name",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj) -> str | None:
        if obj.created_by_id is None:
            return None
        return getattr(obj.created_by, "email", None)

    def get_reference_number(self, obj) -> str | None:
        if not obj.reference_type or not obj.reference_id:
            return None
        ref_type = obj.reference_type.lower()
        try:
            if ref_type in ("delivery", "delivery_document"):
                DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
                doc = DeliveryDocument.objects.filter(uuid=obj.reference_id).only("document_number").first()
                return doc.document_number if doc else None
            if ref_type == "order":
                Order = apps.get_model("orders", "Order")
                doc = Order.objects.filter(uuid=obj.reference_id).only("order_number").first()
                return doc.order_number if doc else None
        except Exception:
            return None
        return None


class StockUpdateSerializer(serializers.Serializer):
    """Payload for POST .../update-stock/ (create or amend a movement + stock)."""

    warehouse_id = serializers.UUIDField(required=False)
    warehouse_code = serializers.CharField(
        max_length=10,
        required=False,
        allow_blank=True,
        help_text="Alternative to warehouse_id: short code of a warehouse owned by the product owner.",
    )
    quantity_change = serializers.DecimalField(max_digits=10, decimal_places=2)
    movement_type = serializers.ChoiceField(
        choices=StockMovement.MovementType.choices,
        default=StockMovement.MovementType.ADJUSTMENT,
        required=False,
    )
    reference_type = serializers.CharField(max_length=50, required=False, allow_blank=True)
    reference_id = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    stock_movement_id = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, data):
        product = self.context.get("product")
        if product is None:
            raise serializers.ValidationError("Serializer requires context['product'].")

        self._existing_movement = None
        movement_id = data.get("stock_movement_id")
        warehouse_id = data.get("warehouse_id")
        warehouse_code = (data.get("warehouse_code") or "").strip()

        user = self.context.get("user")
        if user is None:
            raise serializers.ValidationError("Serializer requires context['user'].")

        if warehouse_code and not movement_id:
            owner = product.user or user
            wh = Warehouse.objects.filter(user_id=owner.id, code__iexact=warehouse_code).first()
            if not wh:
                raise serializers.ValidationError(
                    {"warehouse_code": "No warehouse with this code for this product's owner."}
                )
            if warehouse_id and str(warehouse_id) != str(wh.uuid):
                raise serializers.ValidationError(
                    {"warehouse_id": "Conflicts with warehouse_code for the resolved warehouse."}
                )
            data["warehouse_id"] = wh.uuid
            warehouse_id = wh.uuid

        if movement_id:
            existing = StockMovement.objects.filter(
                uuid=movement_id,
                product=product,
            ).select_related("warehouse").first()
            if not existing:
                raise serializers.ValidationError(
                    {"stock_movement_id": "No movement with this id for this product."}
                )
            self._existing_movement = existing
            if warehouse_id and str(warehouse_id) != str(existing.warehouse.uuid):
                raise serializers.ValidationError(
                    {
                        "warehouse_id": (
                            "Must match the movement's warehouse (or omit when updating)."
                        )
                    }
                )
            data["warehouse_id"] = existing.warehouse.uuid
        elif not warehouse_id:
            raise serializers.ValidationError(
                {
                    "warehouse_id": (
                        "This field is required when stock_movement_id is not set "
                        "(or send warehouse_code instead)."
                    )
                }
            )

        return data


class CustomerProductPriceSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_unit = serializers.CharField(source="product.unit", read_only=True)
    product_price_net = serializers.DecimalField(
        source="product.price_net", max_digits=10, decimal_places=2, read_only=True
    )
    product_vat_rate = serializers.DecimalField(
        source="product.vat_rate", max_digits=5, decimal_places=2, read_only=True
    )
    price_net = serializers.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        model = CustomerProductPrice
        fields = [
            "id",
            "customer",
            "product",
            "product_name",
            "product_unit",
            "product_price_net",
            "product_vat_rate",
            "price_net",
            "price_type",
            "note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        company = getattr(getattr(request, "user", None), "current_company", None)
        if company and "customer" in attrs and "product" in attrs:
            qs = CustomerProductPrice.objects.filter(
                company=company,
                customer=attrs["customer"],
                product=attrs["product"],
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    "Cena indywidualna dla tego klienta i produktu już istnieje."
                )
        return attrs
