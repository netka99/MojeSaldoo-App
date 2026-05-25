from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.customers.models import Customer
from apps.products.models import Product

from .models import Order, OrderChangeLog, OrderItem


class OrderChangeLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OrderChangeLog
        fields = [
            "id", "changed_at", "changed_by", "changed_by_name", "change_type",
            "product_id", "product_name", "product_unit",
            "quantity_before", "quantity_after",
            "unit_price_gross_before", "unit_price_gross_after",
        ]
        read_only_fields = fields

    def get_changed_by_name(self, obj) -> str:
        if not obj.changed_by_id:
            return ""
        u = obj.changed_by
        return u.first_name or u.username


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
    customer_payment_terms = serializers.IntegerField(
        source="customer.payment_terms",
        read_only=True,
    )

    class Meta:
        model = Order
        fields = [
            "id",
            "customer_id",
            "customer_name",
            "customer_payment_terms",
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

    @staticmethod
    def _write_changelog(instance, changed_by, existing_by_product, items_data, incoming_product_ids):
        """Compare old vs new items and bulk-create OrderChangeLog rows. Called BEFORE mutations."""
        logs = []
        for row in items_data:
            product = row["product"]
            pid = product.pk
            new_qty = Decimal(str(row.get("quantity", "1")))
            new_price = Decimal(str(row.get("unit_price_gross", product.price_gross)))
            if pid not in existing_by_product:
                logs.append(OrderChangeLog(
                    order=instance, changed_by=changed_by,
                    change_type=OrderChangeLog.CHANGE_ADDED,
                    product_id=pid,
                    product_name=product.name,
                    product_unit=getattr(product, "unit", "") or "",
                    quantity_before=None, quantity_after=new_qty,
                    unit_price_gross_before=None, unit_price_gross_after=new_price,
                ))
            else:
                oi = existing_by_product[pid]
                if new_qty != oi.quantity:
                    logs.append(OrderChangeLog(
                        order=instance, changed_by=changed_by,
                        change_type=OrderChangeLog.CHANGE_QTY,
                        product_id=pid,
                        product_name=oi.product_name or product.name,
                        product_unit=oi.product_unit or "",
                        quantity_before=oi.quantity, quantity_after=new_qty,
                        unit_price_gross_before=oi.unit_price_gross,
                        unit_price_gross_after=new_price,
                    ))
                elif new_price != oi.unit_price_gross:
                    logs.append(OrderChangeLog(
                        order=instance, changed_by=changed_by,
                        change_type=OrderChangeLog.CHANGE_PRICE,
                        product_id=pid,
                        product_name=oi.product_name or product.name,
                        product_unit=oi.product_unit or "",
                        quantity_before=oi.quantity, quantity_after=new_qty,
                        unit_price_gross_before=oi.unit_price_gross,
                        unit_price_gross_after=new_price,
                    ))
        for product_id, oi in existing_by_product.items():
            if product_id not in incoming_product_ids and not oi.delivery_items.exists():
                logs.append(OrderChangeLog(
                    order=instance, changed_by=changed_by,
                    change_type=OrderChangeLog.CHANGE_REMOVED,
                    product_id=product_id,
                    product_name=oi.product_name,
                    product_unit=oi.product_unit,
                    quantity_before=oi.quantity, quantity_after=None,
                    unit_price_gross_before=oi.unit_price_gross, unit_price_gross_after=None,
                ))
        if logs:
            OrderChangeLog.objects.bulk_create(logs)

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
            existing_by_product = {oi.product_id: oi for oi in instance.items.all()}
            incoming_product_ids = {row["product"].pk for row in items_data}

            # Write audit log BEFORE mutations
            changed_by = request.user if (request and request.user.is_authenticated) else None
            self._write_changelog(instance, changed_by, existing_by_product, items_data, incoming_product_ids)

            # Upsert: update existing, create new
            for row in items_data:
                product = row["product"]
                kwargs = self._build_line_kwargs(row)
                if product.pk in existing_by_product:
                    oi = existing_by_product[product.pk]
                    for field, val in kwargs.items():
                        setattr(oi, field, val)
                    oi.save()
                else:
                    OrderItem.objects.create(order=instance, **kwargs)

            # Delete items no longer in list, only if no WZ references them
            for product_id, oi in existing_by_product.items():
                if product_id not in incoming_product_ids:
                    if not oi.delivery_items.exists():
                        oi.delete()
        instance.refresh_from_db()
        instance.calculate_total()
        return instance
