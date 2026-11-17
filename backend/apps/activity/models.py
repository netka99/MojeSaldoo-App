import uuid

from django.db import models
from django.conf import settings


class ActivityLog(models.Model):
    STATUS_SUCCESS = "success"
    STATUS_ERROR = "error"
    STATUS_WARNING = "warning"
    STATUS_CHOICES = [
        (STATUS_SUCCESS, "Success"),
        (STATUS_ERROR, "Error"),
        (STATUS_WARNING, "Warning"),
    ]

    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="activity_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    # e.g. "ksef.auth", "ksef.send", "ksef.status", "invoice.issued"
    action = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    # Object this event relates to
    object_type = models.CharField(max_length=32, blank=True)  # "invoice", "ksef_session"
    object_id = models.CharField(max_length=64, blank=True)    # invoice number or UUID
    # Error classification — drives human-readable messages on the frontend
    error_code = models.CharField(max_length=64, blank=True)
    # Raw technical detail — shown only in Django admin, never exposed to end users
    error_detail = models.CharField(max_length=1024, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["company", "-created_at"]),
        ]

    def __str__(self):
        return f"[{self.status}] {self.action} ({self.company_id}) @ {self.created_at:%Y-%m-%d %H:%M}"


class AuditLog(models.Model):
    """Business audit trail — who changed what in company data."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="audit_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    # e.g. "invoice.created", "invoice.deleted", "product.price_changed", "stock.adjusted"
    action = models.CharField(max_length=64)
    object_type = models.CharField(max_length=64)   # "Invoice", "Product", "StockBatch"
    object_id = models.CharField(max_length=64)     # UUID or other identifier
    object_repr = models.CharField(max_length=256, blank=True)  # human label e.g. "FV/2026/0001"
    before = models.JSONField(null=True, blank=True)  # state before change
    after = models.JSONField(null=True, blank=True)   # state after change
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["company", "-created_at"]),
            models.Index(fields=["company", "object_type", "object_id"]),
        ]

    def __str__(self):
        return f"{self.action} {self.object_type}({self.object_id}) by {self.user_id} @ {self.created_at:%Y-%m-%d %H:%M}"
