from rest_framework import serializers

from .models import ProductionOrder, ProductionOrderInput, Recipe, RecipeItem


class RecipeItemSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    ingredient_unit = serializers.CharField(source="ingredient.unit", read_only=True)

    class Meta:
        model = RecipeItem
        fields = [
            "id",
            "ingredient",
            "ingredient_name",
            "ingredient_unit",
            "quantity",
            "unit",
            "notes",
        ]


class RecipeSerializer(serializers.ModelSerializer):
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
        read_only_fields = ["id", "created_at", "updated_at"]


class RecipeWriteSerializer(serializers.ModelSerializer):
    """Used for create/update — accepts nested items."""

    items = RecipeItemSerializer(many=True)

    class Meta:
        model = Recipe
        fields = ["id", "product", "name", "yield_quantity", "is_active", "notes", "items"]
        read_only_fields = ["id"]

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


class ProductionOrderInputSerializer(serializers.ModelSerializer):
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
        read_only_fields = ["id", "fifo_cost"]


class ProductionOrderSerializer(serializers.ModelSerializer):
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
            "notes",
            "inputs",
            "completed_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "order_number",
            "total_input_cost",
            "real_unit_cost",
            "rw_document",
            "pw_document",
            "status",
            "completed_at",
            "created_at",
        ]

    def get_recipe_name(self, obj):
        if not obj.recipe_id:
            return None
        return obj.recipe.name or (obj.recipe.product.name if obj.recipe.product_id else None)


class ProductionOrderCreateSerializer(serializers.ModelSerializer):
    """Used for order creation — accepts nested batch inputs."""

    inputs = ProductionOrderInputSerializer(many=True, required=False)

    class Meta:
        model = ProductionOrder
        fields = ["id", "recipe", "date", "mode", "quantity_produced", "notes", "inputs"]
        read_only_fields = ["id"]

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
        order = ProductionOrder.objects.create(**validated_data)
        for inp in inputs_data:
            ingredient = inp["ingredient"]
            ProductionOrderInput.objects.create(
                order=order,
                ingredient=ingredient,
                quantity_used=inp["quantity_used"],
                unit=inp.get("unit") or ingredient.unit,
            )
        return order
