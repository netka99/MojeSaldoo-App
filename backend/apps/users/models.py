import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    current_company = models.ForeignKey(
        "Company",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    def __str__(self):
        return self.username


class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    nip = models.CharField(max_length=10, unique=True, blank=True, null=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=10, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class CompanyMembership(models.Model):
    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("driver", "Driver"),
        ("viewer", "Viewer"),
    ]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="viewer")
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "company")


class CompanyModule(models.Model):
    MODULE_CHOICES = [
        ("products", "Products & Inventory"),
        ("customers", "Customers"),
        ("warehouses", "Warehouse Management"),
        ("orders", "Orders"),
        ("delivery", "Delivery & WZ Documents"),
        ("invoicing", "Invoicing"),
        ("ksef", "KSeF Integration"),
        ("reporting", "Reporting & Analytics"),
    ]
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="modules")
    module = models.CharField(max_length=50, choices=MODULE_CHOICES)
    is_enabled = models.BooleanField(default=False)
    enabled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("company", "module")
