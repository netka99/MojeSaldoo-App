from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer

from .models import ProductionOrder, ProductionOrderInput, Recipe, RecipeItem


class RecipeItemSerializer(UUIDModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    ingredient_unit = serializers.CharField(source="ingredient.unit", read_only=True)
    ingredient_avg_cost = serializers.DecimalField(
        source="ingredient.avg_cost",
        max_digits=10,
        decimal_places=4,
        read_only=True,
        allow_null=True,
    )
    ingredient_stock_total = serializers.SerializerMethodField()

    class Meta:
        model = RecipeItem
        fields = [
            "id",
            "ingredient",
            "ingredient_name",
            "ingredient_unit",
            "ingredient_avg_cost",
            "ingredient_stock_total",
            "quantity",
            "unit",
            "notes",
        ]

    def get_ingredient_stock_total(self, obj):
        # Uses prefetched ingredient.stocks — no extra DB hit.
        return sum(
            (s.quantity_available or 0) for s in obj.ingredient.stocks.all()
        )


class RecipeSerializer(UUIDModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_unit = serializers.CharField(source="product.unit", read_only=True)
    items = RecipeItemSerializer(many=True, read_only=True)

    class Meta:
        model = Recipe
        fields = [
            "id",
            "product",
            "product_name",
            "product_unit",
            "name",
            "yield_quantity",
            "is_active",
            "notes",
            "items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class RecipeWriteSerializer(UUIDModelSerializer):
    """Used for create/update — accepts nested items."""

    items = RecipeItemSerializer(many=True)

    class Meta:
        model = Recipe
        fields = ["id", "product", "name", "yield_quantity", "is_active", "notes", "items"]
        read_only_fields = []

    def _save_items(self, recipe, items_data):
        recipe.items.all().delete()
        for item_data in items_data:
            ingredient = item_data["ingredient"]
            RecipeItem.objects.create(
                recipe=recipe,
                ingredient=ingredient,
                quantity=item_data["quantity"],
                unit=item_data.get("unit") or ingredient.unit,
                notes=item_data.get("notes", ""),
            )

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        recipe = Recipe.objects.create(**validated_data)
        self._save_items(recipe, items_data)
        return recipe

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._save_items(instance, items_data)
        return instance


class ProductionOrderInputSerializer(UUIDModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    ingredient_unit = serializers.CharField(source="ingredient.unit", read_only=True)

    class Meta:
        model = ProductionOrderInput
        fields = [
            "id",
            "ingredient",
            "ingredient_name",
            "ingredient_unit",
            "quantity_used",
            "unit",
            "fifo_cost",
        ]
        read_only_fields = ["fifo_cost"]


class ProductionOrderSerializer(UUIDModelSerializer):
    recipe_name = serializers.SerializerMethodField()
    finished_product_name = serializers.CharField(
        source="recipe.product.name", read_only=True
    )
    finished_product_unit = serializers.CharField(
        source="recipe.product.unit", read_only=True
    )
    inputs = ProductionOrderInputSerializer(many=True, read_only=True)
    rw_document_number = serializers.CharField(
        source="rw_document.document_number", read_only=True, default=None
    )
    pw_document_number = serializers.CharField(
        source="pw_document.document_number", read_only=True, default=None
    )
    source_orders_info = serializers.SerializerMethodField()
    recipe_items = serializers.SerializerMethodField()

    class Meta:
        model = ProductionOrder
        fields = [
            "id",
            "order_number",
            "recipe",
            "recipe_name",
            "finished_product_name",
            "finished_product_unit",
            "date",
            "mode",
            "status",
            "quantity_produced",
            "total_input_cost",
            "real_unit_cost",
            "rw_document",
            "rw_document_number",
            "pw_document",
            "pw_document_number",
            "source_orders",
            "source_orders_info",
            "notes",
            "inputs",
            "recipe_items",
            "completed_at",
            "created_at",
        ]
        read_only_fields = ["order_number", "total_input_cost", "real_unit_cost", "rw_document", "pw_document", "status", "completed_at", "created_at", "source_orders_info"]

    def get_recipe_name(self, obj):
        if not obj.recipe_id:
            return None
        return obj.recipe.name or (obj.recipe.product.name if obj.recipe.product_id else None)

    def get_recipe_items(self, obj):
        from decimal import Decimal
        if not obj.recipe_id:
            return []
        yield_qty = obj.recipe.yield_quantity or Decimal("1")
        qty_produced = obj.quantity_produced or Decimal("0")
        multiplier = Decimal(str(qty_produced)) / Decimal(str(yield_qty))
        return [
            {
                "ingredient_name": item.ingredient.name,
                "unit": item.unit or item.ingredient.unit,
                "quantity_needed": round(item.quantity * multiplier, 4),
            }
            for item in obj.recipe.items.select_related("ingredient").all()
        ]

    def get_source_orders_info(self, obj):
        return [
            {
                "id": str(o.uuid),
                "order_number": o.order_number,
                "customer_name": o.customer.name if o.customer_id else None,
            }
            for o in obj.source_orders.select_related("customer").all()
        ]


class ProductionOrderCreateSerializer(UUIDModelSerializer):
    """Used for order creation — accepts nested batch inputs."""

    inputs = ProductionOrderInputSerializer(many=True, required=False)

    class Meta:
        model = ProductionOrder
        fields = ["id", "recipe", "date", "mode", "quantity_produced", "source_orders", "notes", "inputs"]
        read_only_fields = []

    def validate(self, data):
        if data.get("mode") == ProductionOrder.MODE_BATCH:
            inputs = data.get("inputs") or []
            if not inputs:
                raise serializers.ValidationError(
                    {"inputs": "Tryb wsadu wymaga podania składników (inputs)."}
                )
        return data

    def create(self, validated_data):
        inputs_data = validated_data.pop("inputs", [])
        source_orders = validated_data.pop("source_orders", [])
        order = ProductionOrder.objects.create(**validated_data)
        if source_orders:
            order.source_orders.set(source_orders)
        for inp in inputs_data:
            ingredient = inp["ingredient"]
            ProductionOrderInput.objects.create(
                order=order,
                ingredient=ingredient,
                quantity_used=inp["quantity_used"],
                unit=inp.get("unit") or ingredient.unit,
            )
        return order
