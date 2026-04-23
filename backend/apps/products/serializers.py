from decimal import Decimal

from rest_framework import serializers

from .models import Product, StockMovement, Warehouse


class ProductSerializer(serializers.ModelSerializer):
    """Full Product API shape; money/stock amounts use DecimalField (no floats)."""

    price_net = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    price_gross = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    vat_rate = serializers.DecimalField(max_digits=5, decimal_places=2, required=False)
    min_stock_alert = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)

    class Meta:
        model = Product
        fields = [
            "id",
            "user",
            "name",
            "description",
            "unit",
            "price_net",
            "price_gross",
            "vat_rate",
            "sku",
            "barcode",
            "track_batches",
            "min_stock_alert",
            "shelf_life_days",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

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


class WarehouseSerializer(serializers.ModelSerializer):
    """Full Warehouse API shape (no decimal fields on model)."""

    class Meta:
        model = Warehouse
        fields = [
            "id",
            "user",
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
        read_only_fields = ["id", "user", "created_at", "updated_at"]


class StockMovementSerializer(serializers.ModelSerializer):
    """Read/write representation of a stock movement line."""

    quantity = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity_before = serializers.DecimalField(max_digits=10, decimal_places=2)
    quantity_after = serializers.DecimalField(max_digits=10, decimal_places=2)
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id",
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
        read_only_fields = [
            "id",
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
            if warehouse_id and str(warehouse_id) != str(wh.id):
                raise serializers.ValidationError(
                    {"warehouse_id": "Conflicts with warehouse_code for the resolved warehouse."}
                )
            data["warehouse_id"] = wh.id
            warehouse_id = wh.id

        if movement_id:
            existing = StockMovement.objects.filter(
                pk=movement_id,
                product=product,
            ).first()
            if not existing:
                raise serializers.ValidationError(
                    {"stock_movement_id": "No movement with this id for this product."}
                )
            self._existing_movement = existing
            if warehouse_id and str(warehouse_id) != str(existing.warehouse_id):
                raise serializers.ValidationError(
                    {
                        "warehouse_id": (
                            "Must match the movement's warehouse (or omit when updating)."
                        )
                    }
                )
            data["warehouse_id"] = existing.warehouse_id
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
