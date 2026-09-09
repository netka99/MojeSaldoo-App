from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField
from apps.delivery.models import DeliveryDocument
from apps.suppliers.models import Supplier

from .models import InvoiceItemPzLink, PurchaseDocument, PurchaseDocumentItem, PurchaseDocumentPzLink


class PurchaseDocumentItemSerializer(UUIDModelSerializer):
    product_display_name = serializers.SerializerMethodField()
    coverage = serializers.SerializerMethodField()

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
            "coverage",
            "created_at",
        ]

    def get_product_display_name(self, obj):
        return obj.product.name if obj.product_id else None

    def get_coverage(self, obj):
        """Aggregated PZ coverage for this line: total matched qty and which PZ numbers."""
        # pz_line_links prefetched by ViewSet get_queryset
        links = obj.pz_line_links.all()
        total = sum(lnk.quantity_matched for lnk in links)
        pz_numbers = sorted({
            lnk.delivery_item.delivery_document.document_number
            for lnk in links
            if lnk.delivery_item_id and lnk.delivery_item.delivery_document_id
        })
        return {
            "quantity_matched_total": str(total),
            "pz_numbers": pz_numbers,
        }


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

    # --- PZ links (M:M, new API) ---
    pz_documents = serializers.SerializerMethodField()

    # --- Backward-compat single-PZ fields (read-only, first link or None) ---
    # Kept so existing frontend code doesn't crash during the migration transition.
    # Will be removed in a future cleanup after frontend is fully updated.
    pz_id = serializers.SerializerMethodField()
    pz_number = serializers.SerializerMethodField()

    # --- Write: link multiple PZ UUIDs at creation time (optional) ---
    pz_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
        allow_empty=True,
        help_text="Lista UUID-ów PZ do powiązania przy tworzeniu dokumentu.",
    )

    supplier_id = UUIDRelatedField(
        queryset=Supplier.objects.all(),
        source="supplier",
        write_only=True,
        required=False,
        allow_null=True,
    )

    # LEGACY write field — kept for backward compat with old frontends/scripts.
    # New code should use pz_ids or the link-pz / unlink-pz endpoints.
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
            # New M:M
            "pz_documents",
            # Backward-compat single
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
            # Write fields
            "pz_ids",
            "delivery_document_id",
            "notes",
            "ocr_raw_filename",
            "line_categories",
            "items",
            "items_write",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "pz_documents", "pz_id", "pz_number",
            "paid_at", "created_at", "updated_at",
        ]

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def get_pz_documents(self, obj):
        """Return all linked PZ documents as a list (new M:M API)."""
        # pz_links must be prefetched by the ViewSet's get_queryset()
        links = obj.pz_links.all()
        return [
            {
                "id": str(link.delivery_document.uuid),
                "document_number": link.delivery_document.document_number,
                "status": link.delivery_document.status,
                "issue_date": (
                    link.delivery_document.issue_date.isoformat()
                    if link.delivery_document.issue_date else None
                ),
            }
            for link in links
        ]

    def get_pz_id(self, obj):
        """Backward-compat: UUID of the first linked PZ (or None)."""
        link = obj.pz_links.first()
        return str(link.delivery_document.uuid) if link else None

    def get_pz_number(self, obj):
        """Backward-compat: document_number of the first linked PZ (or None)."""
        link = obj.pz_links.first()
        return link.delivery_document.document_number if link else None

    # ------------------------------------------------------------------
    # Write helpers
    # ------------------------------------------------------------------

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

    @staticmethod
    def _link_pz_uuids(document: PurchaseDocument, pz_uuids: list):
        """
        Create PurchaseDocumentPzLink entries for each UUID in pz_uuids.
        Skips invalid/missing UUIDs and duplicate links (ignore_conflicts).
        Also sets status=matched if at least one link was created.
        """
        if not pz_uuids:
            return
        links = []
        for uid in pz_uuids:
            try:
                pz = DeliveryDocument.objects.get(
                    uuid=uid,
                    company=document.company,
                    document_type="PZ",
                )
                links.append(
                    PurchaseDocumentPzLink(
                        purchase_document=document,
                        delivery_document=pz,
                    )
                )
            except DeliveryDocument.DoesNotExist:
                pass  # silently skip unknown UUIDs

        if links:
            PurchaseDocumentPzLink.objects.bulk_create(links, ignore_conflicts=True)
            PurchaseDocument.objects.filter(pk=document.pk).update(
                status=PurchaseDocument.STATUS_MATCHED
            )

    def create(self, validated_data):
        pz_uuids = validated_data.pop("pz_ids", [])
        items_data = validated_data.pop("items_write", [])
        # Legacy field — if provided, add it to pz_uuids so it still works
        legacy_pz = validated_data.pop("delivery_document", None)
        document = PurchaseDocument.objects.create(**validated_data)
        for item_data in items_data:
            product = self._resolve_product(item_data)
            PurchaseDocumentItem.objects.create(document=document, product=product, **item_data)
        if legacy_pz:
            pz_uuids = [legacy_pz.uuid] + list(pz_uuids)
        self._link_pz_uuids(document, pz_uuids)
        return document

    def update(self, instance, validated_data):
        pz_uuids = validated_data.pop("pz_ids", None)
        items_data = validated_data.pop("items_write", None)
        # Legacy field handled: if passed, treat as add (not replace)
        legacy_pz = validated_data.pop("delivery_document", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item_data in items_data:
                product = self._resolve_product(item_data)
                PurchaseDocumentItem.objects.create(document=instance, product=product, **item_data)
        if pz_uuids is not None:
            self._link_pz_uuids(instance, pz_uuids)
        if legacy_pz:
            self._link_pz_uuids(instance, [legacy_pz.uuid])
        return instance
