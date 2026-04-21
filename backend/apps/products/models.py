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