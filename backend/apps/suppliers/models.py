import uuid

from django.db import models


class Supplier(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        'users.Company', on_delete=models.CASCADE, related_name='suppliers'
    )
    name = models.CharField(max_length=255)
    nip = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    street = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=100, default='Polska')
    payment_terms = models.PositiveIntegerField(
        default=14, help_text="Dni do płatności"
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'nip'],
                condition=models.Q(nip__gt=''),
                name='unique_supplier_nip_per_company'
            )
        ]

    def __str__(self):
        return self.name
