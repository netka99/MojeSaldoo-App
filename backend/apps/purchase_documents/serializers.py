from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField
from apps.delivery.models import DeliveryDocument
from apps.suppliers.models import Supplier

from .models import PurchaseDocument, PurchaseDocumentItem


class PurchaseDocumentItemSerializer(UUIDModelSerializer):
    product_display_name = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseDocumentItem
        fields = [
            "id",
            "product",
            "product_display_name",
            "product_name",
            "unit",
            "quantity",
            "unit_price_gross",
            "vat_rate",
            "line_gross",
            "created_at",
        ]

    def get_product_display_name(self, obj):
        return obj.product.name if obj.product_id else None


class PurchaseDocumentItemWriteSerializer(serializers.ModelSerializer):
    # Plain UUID — we resolve to a Product FK in create/update on the parent serializer
    product_id = serializers.UUIDField(required=False, allow_null=True)

    class Meta:
        model = PurchaseDocumentItem
        fields = [
            "product_id",
            "product_name",
            "unit",
            "quantity",
            "unit_price_gross",
            "vat_rate",
            "line_gross",
        ]


class PurchaseDocumentSerializer(UUIDModelSerializer):
    items = PurchaseDocumentItemSerializer(many=True, read_only=True)
    pz_id = serializers.SerializerMethodField()
    pz_number = serializers.SerializerMethodField()
    supplier_id = UUIDRelatedField(
        queryset=Supplier.objects.all(),
        source="supplier",
        write_only=True,
        required=False,
        allow_null=True,
    )
    delivery_document_id = UUIDRelatedField(
        queryset=DeliveryDocument.objects.all(),
        source="delivery_document",
        write_only=True,
        required=False,
        allow_null=True,
    )
    items_write = PurchaseDocumentItemWriteSerializer(
        many=True, write_only=True, required=False
    )

    class Meta:
        model = PurchaseDocument
        fields = [
            "id",
            "doc_type",
            "status",
            "pz_id",
            "pz_number",
            "supplier_id",
            "supplier_name",
            "supplier_nip",
            "document_number",
            "issue_date",
            "due_date",
            "payment_method",
            "is_paid",
            "paid_at",
            "opex_category",
            "accounting_status",
            "accounting_notes",
            "total_net",
            "total_vat",
            "total_gross",
            "delivery_document_id",
            "notes",
            "ocr_raw_filename",
            "items",
            "items_write",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "pz_id", "pz_number", "paid_at", "created_at", "updated_at"]

    def get_pz_id(self, obj):
        if obj.delivery_document_id:
            return str(obj.delivery_document.uuid)
        return None

    def get_pz_number(self, obj):
        if obj.delivery_document_id:
            return obj.delivery_document.document_number
        return None

    @staticmethod
    def _resolve_product(item_data: dict):
        """Pop product_id UUID and resolve it to a Product instance (or None)."""
        from apps.products.models import Product
        product_id = item_data.pop("product_id", None)
        if product_id:
            try:
                return Product.objects.get(uuid=product_id)
            except Product.DoesNotExist:
                pass
        return None

    def create(self, validated_data):
        items_data = validated_data.pop("items_write", [])
        document = PurchaseDocument.objects.create(**validated_data)
        for item_data in items_data:
            product = self._resolve_product(item_data)
            PurchaseDocumentItem.objects.create(document=document, product=product, **item_data)
        return document

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items_write", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item_data in items_data:
                product = self._resolve_product(item_data)
                PurchaseDocumentItem.objects.create(document=instance, product=product, **item_data)
        return instance
