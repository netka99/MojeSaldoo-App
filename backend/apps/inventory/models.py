import re
import uuid

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.products.models import Product, Warehouse
from apps.users.models import Company


class InventoryCount(models.Model):
    """
    Periodic inventory count document (INW).
    Document numbers are auto-assigned per company: ``INW/{year}/{seq:04d}``.
    """

    STATUS_DRAFT = "draft"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name="inventory_counts",
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="inventory_counts",
    )
    document_number = models.CharField(
        max_length=50,
        blank=True,
        db_index=True,
        help_text="Auto-assigned, e.g. INW/2026/0001 (unique per company).",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
    )
    count_date = models.DateField()
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_counts_created",
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def _next_document_number(cls, company_id, count_date) -> str:
        """
        Next ``INW/{year}/{seq:04d}`` for this company.
        Must run inside the same transaction.atomic() as a Company row lock.
        """
        y = (count_date or timezone.localdate()).year
        prefix = f"INW/{y}/"
        pat = re.compile(rf"^INW/{y}/" + r"(\d{4})$")
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
        return f"INW/{y}/{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.document_number and self.company_id:
            with transaction.atomic():
                Company.objects.select_for_update().get(pk=self.company_id)
                count_date = self.count_date or timezone.localdate()
                self.document_number = self._next_document_number(
                    self.company_id,
                    count_date,
                )
        super().save(*args, **kwargs)

    def __str__(self):
        if self.document_number:
            return self.document_number
        return f"Inventory {self.id}"

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Inventory count"
        verbose_name_plural = "Inventory counts"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "document_number"],
                name="inventory_count_company_document_number_uniq",
            ),
        ]


class InventoryCountItem(models.Model):
    """Line item on an inventory count document."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    inventory_count = models.ForeignKey(
        InventoryCount,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="inventory_count_items",
    )
    product_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Snapshot of product name at time of count creation.",
    )
    product_unit = models.CharField(
        max_length=20,
        blank=True,
        help_text="Snapshot of product unit at time of count creation.",
    )
    quantity_system = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        help_text="Stock quantity at time of count creation (system value).",
    )
    quantity_actual = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Physically counted quantity (filled by user).",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def difference(self):
        """Returns quantity_actual - quantity_system, or None if quantity_actual is not set."""
        if self.quantity_actual is None:
            return None
        return self.quantity_actual - self.quantity_system

    def __str__(self):
        return f"{self.inventory_count} — {self.product_name or self.product_id}"

    class Meta:
        ordering = ["product__name"]
        verbose_name = "Inventory count item"
        verbose_name_plural = "Inventory count items"
