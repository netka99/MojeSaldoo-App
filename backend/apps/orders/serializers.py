from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.customers.models import Customer
from apps.products.models import Product

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    """
    Writable nested line: POST uses product_id, quantity, unit prices, vat, discount.
    line_total_* and product name/unit are set by the model on save.
    """

    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(),
        source="product",
    )

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_id",
            "product_name",
            "product_unit",
            "quantity",
            "quantity_delivered",
            "quantity_returned",
            "unit_price_net",
            "unit_price_gross",
            "vat_rate",
            "discount_percent",
            "line_total_net",
            "line_total_gross",
        ]
        read_only_fields = [
            "id",
            "product_name",
            "product_unit",
            "line_total_net",
            "line_total_gross",
        ]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero")
        return value

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if (
            request
            and request.user.is_authenticated
            and getattr(request.user, "current_company_id", None)
        ):
            self.fields["product_id"].queryset = Product.objects.filter(
                company_id=request.user.current_company_id
            )


class OrderSerializer(serializers.ModelSerializer):
    """
    POST /api/orders/ with customer_id, delivery_date, items: [
      { product_id, quantity, unit_price_net, unit_price_gross, vat_rate, discount_percent }
    ]
    """

    customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(),
        source="customer",
    )
    order_date = serializers.DateField(required=False, allow_null=True)
    items = OrderItemSerializer(many=True, required=False, allow_empty=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "customer_id",
            "customer_name",
            "company",
            "user",
            "order_number",
            "order_date",
            "delivery_date",
            "status",
            "subtotal_net",
            "subtotal_gross",
            "discount_percent",
            "discount_amount",
            "total_net",
            "total_gross",
            "customer_notes",
            "internal_notes",
            "created_at",
            "updated_at",
            "confirmed_at",
            "delivered_at",
            "items",
        ]
        read_only_fields = [
            "id",
            "order_number",
            "created_at",
            "updated_at",
            "subtotal_net",
            "subtotal_gross",
            "total_net",
            "total_gross",
            "status",
            "company",
            "user",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if (
            request
            and request.user.is_authenticated
            and getattr(request.user, "current_company_id", None)
        ):
            self.fields["customer_id"].queryset = Customer.objects.filter(
                company_id=request.user.current_company_id
            )

    @staticmethod
    def _item_dec(row, key, default: Decimal) -> Decimal:
        v = row.get(key, default)
        if v is None:
            return default
        return Decimal(str(v))

    def _build_line_kwargs(self, row) -> dict:
        """row is nested validated data: uses `product` key from product_id field."""
        product: Product = row["product"]
        return {
            "product": product,
            "quantity": self._item_dec(row, "quantity", Decimal("1")),
            "quantity_delivered": self._item_dec(
                row, "quantity_delivered", Decimal("0.00")
            ),
            "quantity_returned": self._item_dec(
                row, "quantity_returned", Decimal("0.00")
            ),
            "unit_price_net": self._item_dec(row, "unit_price_net", product.price_net),
            "unit_price_gross": self._item_dec(
                row, "unit_price_gross", product.price_gross
            ),
            "vat_rate": self._item_dec(row, "vat_rate", product.vat_rate),
            "discount_percent": self._item_dec(
                row, "discount_percent", Decimal("0.00")
            ),
        }

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        if validated_data.get("order_date") is None:
            validated_data["order_date"] = timezone.localdate()
        order = Order.objects.create(**validated_data)
        for row in items_data:
            OrderItem.objects.create(order=order, **self._build_line_kwargs(row))
        order.refresh_from_db()
        order.calculate_total()
        return order

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if "customer" in validated_data:
            instance.company = instance.customer.company
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            instance.user = request.user
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for row in items_data:
                OrderItem.objects.create(
                    order=instance, **self._build_line_kwargs(row)
                )
        instance.refresh_from_db()
        instance.calculate_total()
        return instance
