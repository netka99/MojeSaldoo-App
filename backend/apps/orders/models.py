import re
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.products.models import Product


class Order(models.Model):
    """
    Order with company scope, line totals, and lifecycle timestamps.
    """

    STATUS_DRAFT = "draft"
    STATUS_CONFIRMED = "confirmed"
    STATUS_IN_PREPARATION = "in_preparation"
    STATUS_LOADED = "loaded"
    STATUS_IN_DELIVERY = "in_delivery"
    STATUS_DELIVERED = "delivered"
    STATUS_INVOICED = "invoiced"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_IN_PREPARATION, "In preparation"),
        (STATUS_LOADED, "Loaded"),
        (STATUS_IN_DELIVERY, "In delivery"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_INVOICED, "Invoiced"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="orders",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
        help_text="User who created or last updated (audit).",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="orders",
        help_text="Customer who placed the order",
    )
    order_number = models.CharField(
        max_length=32,
        null=True,
        blank=True,
        help_text="Human-readable id, e.g. ZAM/2026/0001 (unique per company)",
    )
    order_date = models.DateField(help_text="Date when the order was placed")
    delivery_date = models.DateField(help_text="Planned delivery date")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        help_text="Current status of the order",
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
    discount_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    discount_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    total_net = models.DecimalField(
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
    customer_notes = models.TextField(blank=True, default="")
    internal_notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def _next_order_number(cls, company_id, order_date) -> str:
        """
        Next value for ZAM/{year}/{seq:04d} for this company, using order_date's year.
        Must run inside the same transaction.atomic() as a Company row lock.
        """
        y = (order_date or timezone.localdate()).year
        prefix = f"ZAM/{y}/"
        # Avoid rf"...(\d{4})" — f-strings interpret {4} and break the regex.
        pat = re.compile(rf"^ZAM/{y}/" + r"(\d{4})$")
        max_seq = 0
        for onum in (
            cls.objects.filter(company_id=company_id, order_number__startswith=prefix)
            .values_list("order_number", flat=True)
        ):
            m = pat.match(onum)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
        return f"ZAM/{y}/{max_seq + 1:04d}"

    def save(self, *args, **kwargs):
        if self._state.adding and not self.order_number and self.company_id:
            with transaction.atomic():
                from apps.users.models import Company

                Company.objects.select_for_update().get(pk=self.company_id)
                order_date = self.order_date or timezone.localdate()
                self.order_number = self._next_order_number(self.company_id, order_date)
        super().save(*args, **kwargs)

    def __str__(self):
        if self.order_number:
            return f"{self.order_number} — {self.customer.name}"
        return f"Order {self.id} - {self.customer.name}"

    def calculate_total(self):
        subtotal_net = sum(
            (item.line_total_net for item in self.items.all()),
            Decimal("0.00"),
        )
        subtotal_gross = sum(
            (item.line_total_gross for item in self.items.all()),
            Decimal("0.00"),
        )
        self.subtotal_net = subtotal_net
        self.subtotal_gross = subtotal_gross
        if self.discount_percent and self.discount_percent > 0:
            factor = max(
                Decimal("1") - (self.discount_percent / Decimal("100")),
                Decimal("0"),
            )
            self.discount_amount = (
                subtotal_gross * (self.discount_percent / Decimal("100"))
            ).quantize(Decimal("0.01"))
            self.total_gross = (subtotal_gross * factor).quantize(Decimal("0.01"))
            self.total_net = (subtotal_net * factor).quantize(Decimal("0.01"))
        else:
            da = self.discount_amount or Decimal("0.00")
            after_g = subtotal_gross - da
            if after_g < 0:
                after_g = Decimal("0.00")
            self.total_gross = after_g
            if subtotal_gross > 0:
                self.total_net = (subtotal_net * (after_g / subtotal_gross)).quantize(
                    Decimal("0.01")
                )
            else:
                self.total_net = Decimal("0.00")
        self.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "discount_amount",
                "total_net",
                "total_gross",
            ]
        )
        return self.total_gross

    def update_status(self, new_status):
        """
        Update order status with validation
        """
        if new_status not in dict(self.STATUS_CHOICES):
            raise ValueError(f"Invalid status: {new_status}")
        self.status = new_status
        if new_status == self.STATUS_CONFIRMED and not self.confirmed_at:
            self.confirmed_at = timezone.now()
        if new_status == self.STATUS_DELIVERED and not self.delivered_at:
            self.delivered_at = timezone.now()
        self.save()
        return self.status

    def can_be_modified(self):
        return self.status in {self.STATUS_DRAFT, self.STATUS_CONFIRMED}

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Order"
        verbose_name_plural = "Orders"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "order_number"],
                name="orders_order_company_order_number_uniq",
            ),
        ]


class OrderItem(models.Model):
    """
    Order line: product snapshot, pricing, and computed line totals.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        Order,
        related_name="items",
        on_delete=models.CASCADE,
        help_text="Parent order",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        help_text="Product in the order",
    )
    product_name = models.CharField(max_length=255, blank=True, default="")
    product_unit = models.CharField(max_length=20, blank=True, default="")
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
        help_text="Ordered quantity",
    )
    quantity_delivered = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    quantity_returned = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    unit_price_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    unit_price_gross = models.DecimalField(
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
    discount_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    line_total_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_total_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    def _recompute_line_totals(self) -> None:
        disc = max(
            Decimal("1") - (self.discount_percent / Decimal("100")),
            Decimal("0"),
        )
        self.line_total_net = (
            self.quantity * self.unit_price_net * disc
        ).quantize(Decimal("0.01"))
        self.line_total_gross = (
            self.quantity * self.unit_price_gross * disc
        ).quantize(Decimal("0.01"))

    def save(self, *args, **kwargs):
        if self.product_id:
            p = self.product
            self.product_name = p.name
            self.product_unit = p.unit or ""
        self._recompute_line_totals()
        super().save(*args, **kwargs)
        self.order.calculate_total()

    def delete(self, *args, **kwargs):
        order = self.order
        super().delete(*args, **kwargs)
        order.calculate_total()

    def __str__(self):
        label = self.product_name or (self.product.name if self.product_id else "")
        return f"{self.quantity} x {label}"

    class Meta:
        verbose_name = "Order Item"
        verbose_name_plural = "Order Items"
