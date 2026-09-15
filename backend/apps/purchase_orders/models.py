import re
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.utils import timezone


class SupplierOrder(models.Model):
    """
    ZD — Zamówienie do Dostawcy (Purchase Order).

    Optional step before a PZ (goods receipt). Allows tracking:
    - what is "in transit" from a supplier,
    - agreed prices (detect invoice discrepancies),
    - back-to-back links to customer orders.

    Flow: ZD → create_pz action → PZ (DeliveryDocument) → FZ (PurchaseDocument)
    """

    STATUS_DRAFT = "draft"
    STATUS_SENT = "sent"
    STATUS_PARTIAL = "partial"      # some items received
    STATUS_FULFILLED = "fulfilled"  # all items received
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Szkic"),
        (STATUS_SENT, "Wysłane"),
        (STATUS_PARTIAL, "Częściowo zrealizowane"),
        (STATUS_FULFILLED, "Zrealizowane"),
        (STATUS_CANCELLED, "Anulowane"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="supplier_orders",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_supplier_orders",
    )
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supplier_orders",
    )
    # Snapshot of supplier name at creation time (in case supplier is deleted later)
    supplier_name = models.CharField(max_length=255, blank=True)

    document_number = models.CharField(max_length=50, blank=True, db_index=True)
    issue_date = models.DateField(default=timezone.localdate)
    expected_delivery_date = models.DateField(null=True, blank=True)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )

    # Back-to-back: link to the customer order that triggered this supplier order
    source_order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supplier_orders",
        help_text="Customer order that triggered this supplier order (back-to-back).",
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "document_number"],
                name="supplier_order_company_document_number_uniq",
            )
        ]

    @classmethod
    def _next_document_number(cls, company_id, issue_date) -> str:
        doc_type = "ZD"
        y = (issue_date or timezone.localdate()).year
        prefix = f"{doc_type}/{y}/"
        pat = re.compile(rf"^{doc_type}/{y}/" + r"(\d{4})$")
        max_seq = 0
        for num in cls.objects.filter(
            company_id=company_id,
            document_number__startswith=prefix,
        ).values_list("document_number", flat=True):
            m = pat.match(num)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
        return f"{doc_type}/{y}/{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.document_number and self.company_id:
            with transaction.atomic():
                from apps.users.models import Company
                Company.objects.select_for_update().get(pk=self.company_id)
                self.document_number = self._next_document_number(
                    self.company_id, self.issue_date
                )
        # Snapshot supplier name
        if self.supplier_id and not self.supplier_name:
            self.supplier_name = self.supplier.name
        super().save(*args, **kwargs)

    def __str__(self):
        return self.document_number or str(self.uuid)

    def refresh_status(self):
        """Recalculate status based on items' received quantities. Call after PZ is posted."""
        items = list(self.items.all())
        if not items:
            return
        all_fulfilled = all(i.quantity_received >= i.quantity_ordered for i in items)
        any_received = any(i.quantity_received > 0 for i in items)
        if all_fulfilled:
            new_status = self.STATUS_FULFILLED
        elif any_received:
            new_status = self.STATUS_PARTIAL
        else:
            new_status = self.status  # don't downgrade sent→draft
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status", "updated_at"])


class SupplierOrderItem(models.Model):
    """Single line of a SupplierOrder."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    supplier_order = models.ForeignKey(
        SupplierOrder,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.PROTECT,
        related_name="supplier_order_items",
    )
    # Snapshot of product name at time of ordering
    product_name = models.CharField(max_length=255, blank=True)
    product_unit = models.CharField(max_length=50, blank=True)

    quantity_ordered = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    # Updated when PZ is posted against this order
    quantity_received = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    # Agreed price (used to detect FZ discrepancies). Optional.
    unit_price_net = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )
    vat_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def save(self, *args, **kwargs):
        if self.product_id and not self.product_name:
            self.product_name = self.product.name
        if self.product_id and not self.product_unit:
            self.product_unit = getattr(self.product, "unit", "") or ""
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.product_name} × {self.quantity_ordered}"
