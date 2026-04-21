import uuid

from django.conf import settings
from django.db import models


class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="customers",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=255)
    company_name = models.CharField(max_length=255, blank=True, null=True)
    nip = models.CharField(max_length=10, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    street = models.CharField(max_length=255, blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    postal_code = models.CharField(max_length=10, blank=True, null=True)
    country = models.CharField(max_length=2, default="PL")
    distance_km = models.IntegerField(blank=True, null=True)
    delivery_days = models.CharField(max_length=50, blank=True, null=True)
    payment_terms = models.IntegerField(default=14)
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user"], name="idx_customers_user"),
            models.Index(fields=["nip"], name="idx_customers_nip"),
            models.Index(fields=["is_active"], name="idx_customers_active"),
        ]

    def __str__(self):
        return self.name