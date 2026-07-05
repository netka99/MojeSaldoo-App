import uuid

from django.db import models


class CostProject(models.Model):
    """User-defined project/cost-centre that invoice lines can be tagged with."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="cost_projects",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=20, blank=True)   # short label, e.g. "PROJ-1"
    color = models.CharField(max_length=7, blank=True)   # hex, e.g. "#3B82F6"
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("company", "name")]
        ordering = ["name"]
        verbose_name = "Cost project"
        verbose_name_plural = "Cost projects"

    def __str__(self) -> str:
        return f"{self.code} – {self.name}" if self.code else self.name


class InvoiceAnnotation(models.Model):
    """Accounting annotation for a received KSeF invoice — one per invoice."""

    STATUS_PENDING = "pending"
    STATUS_ANNOTATED = "annotated"
    STATUS_EXPORTED = "exported"
    STATUS_BOOKED = "booked"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Do opisania"),
        (STATUS_ANNOTATED, "Opisana"),
        (STATUS_EXPORTED, "Wyeksportowana"),
        (STATUS_BOOKED, "Zaksięgowana"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    invoice = models.OneToOneField(
        "ksef.ReceivedKSeFInvoice",
        on_delete=models.CASCADE,
        related_name="annotation",
    )
    accounting_status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
    )
    accounting_notes = models.TextField(blank=True)
    exported_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Invoice annotation"
        verbose_name_plural = "Invoice annotations"

    def __str__(self) -> str:
        return f"Annotation({self.invoice.ksef_number}, {self.accounting_status})"


class InvoiceLineAnnotation(models.Model):
    """Per-line cost allocation — one per ReceivedKSeFInvoiceLine."""

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    line = models.OneToOneField(
        "ksef.ReceivedKSeFInvoiceLine",
        on_delete=models.CASCADE,
        related_name="annotation",
    )
    project = models.ForeignKey(
        CostProject,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="line_annotations",
    )
    is_private = models.BooleanField(default=False)
    note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Invoice line annotation"
        verbose_name_plural = "Invoice line annotations"

    def __str__(self) -> str:
        return f"LineAnnotation(line={self.line_id})"


class InvoiceLineAnnotationSplit(models.Model):
    """Cost split for a single invoice line across multiple projects.

    When splits exist, they take priority over InvoiceLineAnnotation.project.
    All splits for a line should sum to 100%.
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    line_annotation = models.ForeignKey(
        InvoiceLineAnnotation,
        on_delete=models.CASCADE,
        related_name="splits",
    )
    project = models.ForeignKey(
        CostProject,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="line_splits",
    )
    percentage = models.DecimalField(
        max_digits=6, decimal_places=2, default=100,
        help_text="Share of this line allocated to this project (0–100).",
    )
    quantity = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Actual quantity allocated (when split was entered by items, not %).",
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Invoice line annotation split"
        verbose_name_plural = "Invoice line annotation splits"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Split({self.line_annotation_id}, {self.project_id}, {self.percentage}%)"
