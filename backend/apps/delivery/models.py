import re
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.orders.models import Order, OrderItem
from apps.products.models import Product, Warehouse


class DeliveryDocument(models.Model):
    """
    Outbound / transfer document (WZ, MM, PZ). WZ is typically linked to an order; MM
    (inter-warehouse) may exist without a sales order (e.g. van loading).
    Document numbers are auto-assigned per company: ``{TYPE}/{year}/{seq:04d}``.
    """

    DOC_TYPE_WZ = "WZ"
    DOC_TYPE_MM = "MM"
    DOC_TYPE_PZ = "PZ"

    DOC_TYPE_CHOICES = [
        (DOC_TYPE_WZ, "Wydanie Zewnętrzne"),
        (DOC_TYPE_MM, "Przesunięcie Międzymagazynowe"),
        (DOC_TYPE_PZ, "Przyjęcie Zewnętrzne"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_SAVED = "saved"
    STATUS_IN_TRANSIT = "in_transit"
    STATUS_DELIVERED = "delivered"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SAVED, "Saved"),
        (STATUS_IN_TRANSIT, "In Transit"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="delivery_documents",
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="delivery_documents",
        null=True,
        blank=True,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_documents",
        help_text="User who created or last updated (audit).",
    )
    document_type = models.CharField(max_length=2, choices=DOC_TYPE_CHOICES)
    document_number = models.CharField(
        max_length=32,
        null=True,
        blank=True,
        help_text="Assigned on save, e.g. WZ/2026/0001 (unique per company).",
    )
    issue_date = models.DateField(help_text="Document issue date (year drives numbering).")
    from_warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_documents_from",
    )
    to_warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_documents_to",
    )
    to_customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delivery_documents",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
    )
    has_returns = models.BooleanField(default=False)
    returns_notes = models.TextField(blank=True, default="")
    driver_name = models.CharField(max_length=255, blank=True, default="")
    receiver_name = models.CharField(max_length=255, blank=True, default="")
    delivered_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def _next_document_number(cls, company_id, document_type, issue_date) -> str:
        """
        Next ``{TYPE}/{year}/{seq:04d}`` for this company and document type.
        Must run inside the same transaction.atomic() as a Company row lock.
        """
        y = (issue_date or timezone.localdate()).year
        prefix = f"{document_type}/{y}/"
        pat = re.compile(rf"^{document_type}/{y}/" + r"(\d{4})$")
        max_seq = 0
        for num in (
            cls.objects.filter(
                company_id=company_id,
                document_number__startswith=prefix,
            ).values_list("document_number", flat=True)
        ):
            m = pat.match(num)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
        return f"{document_type}/{y}/{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if (
            self._state.adding
            and not self.document_number
            and self.company_id
            and self.document_type
        ):
            with transaction.atomic():
                from apps.users.models import Company

                Company.objects.select_for_update().get(pk=self.company_id)
                issue_date = self.issue_date or timezone.localdate()
                self.document_number = self._next_document_number(
                    self.company_id,
                    self.document_type,
                    issue_date,
                )
        super().save(*args, **kwargs)

    def __str__(self):
        if self.document_number:
            return self.document_number
        return f"Delivery {self.id}"

    def is_locked_by_invoice(self) -> bool:
        """True if any invoice references this document (edits must be blocked)."""
        return self.invoices.exists()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Delivery document"
        verbose_name_plural = "Delivery documents"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "document_number"],
                name="delivery_document_company_document_number_uniq",
            ),
        ]


class DeliveryItem(models.Model):
    """Line on a delivery document: planned vs actual quantities and returns."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    delivery_document = models.ForeignKey(
        DeliveryDocument,
        on_delete=models.CASCADE,
        related_name="items",
    )
    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.PROTECT,
        related_name="delivery_items",
        null=True,
        blank=True,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="delivery_items",
    )
    quantity_planned = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    quantity_actual = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )
    quantity_returned = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    return_reason = models.CharField(max_length=255, blank=True, default="")
    is_damaged = models.BooleanField(default=False)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        label = self.product.name if self.product_id else ""
        num = (
            self.delivery_document.document_number
            if self.delivery_document_id and self.delivery_document.document_number
            else str(self.delivery_document_id or "")
        )
        return f"{num} — {label}"

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Delivery item"
        verbose_name_plural = "Delivery items"
