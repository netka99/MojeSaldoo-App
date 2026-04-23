import uuid

from django.conf import settings
from django.db import models


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="products",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    unit = models.CharField(max_length=20, default="")
    price_net = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    price_gross = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=23.00)
    sku = models.CharField(max_length=50, blank=True, null=True)
    barcode = models.CharField(max_length=50, blank=True, null=True)
    track_batches = models.BooleanField(default=True)
    min_stock_alert = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    shelf_life_days = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user"], name="idx_products_user"),
            models.Index(fields=["sku"], name="idx_products_sku"),
            models.Index(fields=["is_active"], name="idx_products_active"),
        ]

    def __str__(self):
        return self.name


class Warehouse(models.Model):
    """Physical or logical stock location for a user (inventory)."""

    class WarehouseType(models.TextChoices):
        MAIN = "main", "Main"
        MOBILE = "mobile", "Mobile"
        CUSTOMER = "customer", "Customer"
        EXTERNAL = "external", "External"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="warehouses",
    )
    code = models.CharField(
        max_length=10,
        unique=True,
        help_text="Short code, e.g. MG, MV.",
    )
    name = models.CharField(max_length=255)
    warehouse_type = models.CharField(
        max_length=20,
        choices=WarehouseType.choices,
        default=WarehouseType.MAIN,
    )
    address = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    allow_negative_stock = models.BooleanField(default=False)
    fifo_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        indexes = [
            models.Index(fields=["user"], name="idx_warehouses_user"),
            models.Index(fields=["code"], name="idx_warehouses_code"),
            models.Index(fields=["warehouse_type"], name="idx_warehouses_type"),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"


class ProductStock(models.Model):
    """Per-warehouse inventory quantities for a product."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="stocks",
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="product_stocks",
    )
    quantity_available = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )
    quantity_reserved = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )
    quantity_total = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["product", "warehouse"],
                name="uniq_productstock_product_warehouse",
            ),
        ]
        indexes = [
            models.Index(fields=["product"], name="idx_product_stock_product"),
            models.Index(fields=["warehouse"], name="idx_product_stock_warehouse"),
        ]

    def __str__(self):
        return f"{self.product_id} @ {self.warehouse_id}"


class StockBatch(models.Model):
    """FIFO lot / batch line for a product in a warehouse."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="batches",
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="batches",
    )
    batch_number = models.CharField(max_length=50, blank=True, null=True)
    received_date = models.DateField()
    expiry_date = models.DateField(blank=True, null=True)
    quantity_initial = models.DecimalField(max_digits=10, decimal_places=2)
    quantity_remaining = models.DecimalField(max_digits=10, decimal_places=2)
    unit_cost = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        blank=True,
        null=True,
    )

    class Meta:
        ordering = ["received_date", "id"]
        indexes = [
            models.Index(fields=["product"], name="idx_stock_batches_product"),
            models.Index(fields=["warehouse"], name="idx_stock_batches_warehouse"),
            models.Index(fields=["received_date"], name="idx_stock_batches_received"),
            models.Index(fields=["expiry_date"], name="idx_stock_batches_expiry"),
        ]

    def __str__(self):
        return f"{self.product_id} {self.received_date} ({self.quantity_remaining})"


class StockMovement(models.Model):
    """Audit line for inventory changes (per product and warehouse)."""

    class MovementType(models.TextChoices):
        PURCHASE = "purchase", "Purchase"
        SALE = "sale", "Sale"
        RETURN = "return", "Return"
        ADJUSTMENT = "adjustment", "Adjustment"
        TRANSFER = "transfer", "Transfer"
        DAMAGE = "damage", "Damage"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    movement_type = models.CharField(
        max_length=20,
        choices=MovementType.choices,
        default=MovementType.ADJUSTMENT,
    )
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Signed change applied to quantity_available.",
    )
    quantity_before = models.DecimalField(max_digits=10, decimal_places=2)
    quantity_after = models.DecimalField(max_digits=10, decimal_places=2)
    reference_type = models.CharField(max_length=50, blank=True, null=True)
    reference_id = models.UUIDField(blank=True, null=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="stock_movements_created",
        blank=True,
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["product"], name="idx_stock_movements_product"),
            models.Index(fields=["warehouse"], name="idx_stock_movements_warehouse"),
            models.Index(fields=["movement_type"], name="idx_stock_movements_type"),
            models.Index(fields=["created_at"], name="idx_stock_movements_created"),
        ]

    def __str__(self):
        return f"{self.movement_type} {self.quantity} @ {self.warehouse_id}"