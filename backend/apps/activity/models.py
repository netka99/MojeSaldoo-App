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
