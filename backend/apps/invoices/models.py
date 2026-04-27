import re
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order, OrderItem
from apps.products.models import Product


class Invoice(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_ISSUED = "issued"
    STATUS_SENT = "sent"
    STATUS_PAID = "paid"
    STATUS_OVERDUE = "overdue"
    STATUS_CANCELLED = "cancelled"

    PAYMENT_METHOD_CHOICES = [
        ("transfer", "Przelew"),
        ("cash", "Gotówka"),
        ("card", "Karta"),
    ]
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_ISSUED, "Wystawiona"),
        (STATUS_SENT, "Wysłana"),
        (STATUS_PAID, "Opłacona"),
        (STATUS_OVERDUE, "Przeterminowana"),
        (STATUS_CANCELLED, "Anulowana"),
    ]
    KSEF_STATUS_CHOICES = [
        ("not_sent", "Nie wysłana"),
        ("pending", "Oczekuje"),
        ("sent", "Wysłana"),
        ("accepted", "Przyjęta"),
        ("rejected", "Odrzucona"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="invoices",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices",
        help_text="User who created or last updated (audit).",
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    delivery_document = models.ForeignKey(
        DeliveryDocument,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invoices",
    )

    invoice_number = models.CharField(
        max_length=32,
        null=True,
        blank=True,
        help_text="Assigned on save, e.g. FV/2026/0001 (unique per company).",
    )
    issue_date = models.DateField()
    sale_date = models.DateField()
    due_date = models.DateField()
    payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default="transfer",
    )

    subtotal_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    subtotal_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    vat_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    total_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    ksef_reference_number = models.CharField(max_length=255, blank=True, default="")
    ksef_number = models.CharField(max_length=255, blank=True, default="")
    ksef_status = models.CharField(
        max_length=20,
        choices=KSEF_STATUS_CHOICES,
        default="not_sent",
    )
    ksef_sent_at = models.DateTimeField(null=True, blank=True)
    ksef_error_message = models.TextField(blank=True, default="")
    invoice_hash = models.CharField(max_length=255, blank=True, default="")
    upo_received = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def _next_invoice_number(cls, company_id, issue_date) -> str:
        """
        Next FV/{year}/{seq:04d} for this company, using issue_date's year.
        Must run inside the same transaction.atomic() as a Company row lock.
        """
        y = (issue_date or timezone.localdate()).year
        prefix = f"FV/{y}/"
        pat = re.compile(rf"^FV/{y}/" + r"(\d{4})$")
        max_seq = 0
        for num in (
            cls.objects.filter(
                company_id=company_id,
                invoice_number__startswith=prefix,
            ).values_list("invoice_number", flat=True)
        ):
            if not num:
                continue
            m = pat.match(num)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
        return f"FV/{y}/{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.invoice_number and self.company_id:
            with transaction.atomic():
                from apps.users.models import Company

                Company.objects.select_for_update().get(pk=self.company_id)
                issue_date = self.issue_date or timezone.localdate()
                self.invoice_number = self._next_invoice_number(
                    self.company_id,
                    issue_date,
                )
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Invoice {self.invoice_number or self.pk}"

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "invoice_number"],
                name="invoices_invoice_company_invoice_number_uniq",
            ),
        ]


class InvoiceItem(models.Model):
    """
    Invoice line: optional link to order line / product, snapshots, and computed net/VAT/gross.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="items",
    )
    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_items",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_items",
    )
    product_name = models.CharField(max_length=255, blank=True, default="")
    product_unit = models.CharField(max_length=20, blank=True, default="")
    pkwiu = models.CharField(max_length=32, blank=True, default="")
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    unit_price_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    vat_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_vat = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def _recompute_line_amounts(self) -> None:
        net = (self.quantity * self.unit_price_net).quantize(Decimal("0.01"))
        self.line_net = net
        self.line_vat = (net * (self.vat_rate / Decimal("100"))).quantize(Decimal("0.01"))
        self.line_gross = (self.line_net + self.line_vat).quantize(Decimal("0.01"))

    def save(self, *args, **kwargs):
        if self.product_id:
            p = self.product
            if not self.product_name:
                self.product_name = p.name
            if not self.product_unit:
                self.product_unit = p.unit or ""
        elif self.order_item_id:
            oi = self.order_item
            if oi.product_name and not self.product_name:
                self.product_name = oi.product_name
            if oi.product_unit and not self.product_unit:
                self.product_unit = oi.product_unit
        self._recompute_line_amounts()
        super().save(*args, **kwargs)

    def __str__(self):
        label = self.product_name or (self.product.name if self.product_id else "")
        return f"{self.quantity} × {label}"

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Invoice item"
        verbose_name_plural = "Invoice items"
