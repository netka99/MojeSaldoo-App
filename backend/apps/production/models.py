"""
Production module — Recipe/BOM and ProductionOrder management.

Two modes:
  simple — consumed quantities derived from recipe × quantity_produced (FIFO priced)
  batch  — user specifies actual raw material inputs; waste absorbed into cost

On order completion:
  1. RW document created (raw materials deducted from warehouse via FIFO)
  2. PW document created (finished goods added to warehouse)
  3. Product.avg_cost updated for the finished good
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models


class Recipe(models.Model):
    """Bill of materials for a finished product."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="recipes",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.PROTECT,
        related_name="recipes",
        help_text="The finished good this recipe produces.",
    )
    name = models.CharField(max_length=255, blank=True, help_text="Optional display name override.")
    yield_quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("1"),
        help_text="How many units one full recipe produces (e.g. 100 kartaczy).",
    )
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["product__name", "name"]
        indexes = [
            models.Index(fields=["company"], name="idx_recipe_company"),
            models.Index(fields=["product"], name="idx_recipe_product"),
        ]

    def __str__(self):
        label = self.name or (self.product.name if self.product_id else "—")
        return f"{label} (×{self.yield_quantity})"


class RecipeItem(models.Model):
    """One ingredient line inside a Recipe."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name="items")
    ingredient = models.ForeignKey(
        "products.Product",
        on_delete=models.PROTECT,
        related_name="recipe_uses",
    )
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        help_text="Quantity per recipe.yield_quantity units of finished good.",
    )
    unit = models.CharField(max_length=20, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = [("recipe", "ingredient")]
        ordering = ["ingredient__name"]

    def __str__(self):
        return f"{self.ingredient_id} × {self.quantity}"


class ProductionOrder(models.Model):
    """A single production run."""

    MODE_SIMPLE = "simple"
    MODE_BATCH = "batch"
    MODE_CHOICES = [
        (MODE_SIMPLE, "Tryb prosty (z receptury)"),
        (MODE_BATCH, "Tryb wsadu (realne zużycie)"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_COMPLETED = "completed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Szkic"),
        (STATUS_COMPLETED, "Zakończone"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="production_orders",
    )
    order_number = models.CharField(max_length=32, blank=True)
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.PROTECT,
        related_name="production_orders",
    )
    date = models.DateField()
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MODE_SIMPLE)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    quantity_produced = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Actual finished units produced.",
    )
    # Computed on completion
    total_input_cost = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    real_unit_cost = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    # Documents created on completion
    rw_document = models.OneToOneField(
        "delivery.DeliveryDocument",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="production_order_rw",
    )
    pw_document = models.OneToOneField(
        "delivery.DeliveryDocument",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="production_order_pw",
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="production_orders_created",
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["company"], name="idx_prodorder_company"),
            models.Index(fields=["date"], name="idx_prodorder_date"),
            models.Index(fields=["status"], name="idx_prodorder_status"),
        ]

    def __str__(self):
        return self.order_number or str(self.id)

    def save(self, *args, **kwargs):
        if not self.order_number:
            self.order_number = self._generate_order_number()
        super().save(*args, **kwargs)

    def _generate_order_number(self) -> str:
        from django.utils import timezone

        year = timezone.localdate().year
        prefix = f"PRD/{year}/"
        last = (
            ProductionOrder.objects.filter(
                company=self.company,
                order_number__startswith=prefix,
            )
            .order_by("-order_number")
            .values_list("order_number", flat=True)
            .first()
        )
        seq = int(last.split("/")[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"


class ProductionOrderInput(models.Model):
    """
    Actual raw material consumed — only used when order.mode == 'batch'.
    In simple mode, inputs are computed from the recipe at completion time.
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    order = models.ForeignKey(ProductionOrder, on_delete=models.CASCADE, related_name="inputs")
    ingredient = models.ForeignKey(
        "products.Product",
        on_delete=models.PROTECT,
        related_name="production_inputs",
    )
    quantity_used = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        help_text="Actual quantity consumed (includes waste).",
    )
    unit = models.CharField(max_length=20, blank=True)
    # Filled in on completion
    fifo_cost = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)

    class Meta:
        unique_together = [("order", "ingredient")]
        ordering = ["ingredient__name"]
