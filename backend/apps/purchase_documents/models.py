import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class PurchaseDocument(models.Model):
    """
    Incoming document from a supplier — registered manually (outside KSeF).

    Covers three document types:
      FZ  — Faktura Zakupowa (purchase VAT invoice)
      PAR — Paragon fiskalny (fiscal receipt)
      PAR_VAT — Paragon z NIP (simplified VAT invoice, ≤450 PLN)

    Each can optionally be linked to a PZ (goods receipt) in DeliveryDocument.
    Documents can also be linked to cost allocation (cost_allocation app).
    """

    DOC_TYPE_FZ = "FZ"
    DOC_TYPE_PAR = "PAR"
    DOC_TYPE_PAR_VAT = "PAR_VAT"

    DOC_TYPE_CHOICES = [
        (DOC_TYPE_FZ, "Faktura zakupowa"),
        (DOC_TYPE_PAR, "Paragon fiskalny"),
        (DOC_TYPE_PAR_VAT, "Paragon z NIP (faktura uproszczona)"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_REGISTERED = "registered"
    STATUS_MATCHED = "matched"   # linked to PZ

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Szkic"),
        (STATUS_REGISTERED, "Zarejestrowany"),
        (STATUS_MATCHED, "Powiązany z PZ"),
    ]

    PAYMENT_METHOD_CHOICES = [
        ("transfer", "Przelew"),
        ("cash", "Gotówka"),
        ("card", "Karta"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)

    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="purchase_documents",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_documents",
    )

    doc_type = models.CharField(
        max_length=10,
        choices=DOC_TYPE_CHOICES,
        default=DOC_TYPE_FZ,
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_REGISTERED,
    )

    # --- Supplier info (snapshot + optional FK) ---
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_documents",
    )
    supplier_name = models.CharField(max_length=255, blank=True, default="")
    supplier_nip = models.CharField(max_length=15, blank=True, default="")

    # --- Document fields ---
    document_number = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Numer dokumentu od dostawcy (np. FV/2026/001, nr paragonu).",
    )
    issue_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(
        null=True,
        blank=True,
        help_text="Termin płatności (opcjonalnie).",
    )
    payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default="transfer",
        blank=True,
    )

    # --- Amounts ---
    total_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    total_vat = models.DecimalField(
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

    # --- Links to other documents ---
    delivery_document = models.ForeignKey(
        "delivery.DeliveryDocument",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_documents",
        help_text="PZ powiązane z tym dokumentem zakupowym.",
    )

    # --- Payment tracking ---
    is_paid = models.BooleanField(
        default=False,
        help_text="Czy dokument został opłacony. Paragony domyślnie True (płatność przy kasie).",
    )
    paid_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Data i godzina oznaczenia jako opłacone.",
    )

    # --- Cost categorisation (same slugs as cashflow OpexCategory) ---
    opex_category = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text="Slug kategorii kosztu OPEX (np. 'raw_materials', kategoria niestandardowa).",
    )

    # --- Accounting annotation ---
    ACCOUNTING_STATUS_PENDING = "pending"
    ACCOUNTING_STATUS_ANNOTATED = "annotated"
    ACCOUNTING_STATUS_BOOKED = "booked"

    ACCOUNTING_STATUS_CHOICES = [
        (ACCOUNTING_STATUS_PENDING, "Oczekuje"),
        (ACCOUNTING_STATUS_ANNOTATED, "Opisana"),
        (ACCOUNTING_STATUS_BOOKED, "Zaksięgowana"),
    ]

    accounting_status = models.CharField(
        max_length=20,
        choices=ACCOUNTING_STATUS_CHOICES,
        default=ACCOUNTING_STATUS_PENDING,
        help_text="Status księgowy dokumentu.",
    )
    accounting_notes = models.TextField(
        blank=True,
        default="",
        help_text="Notatki dla księgowości (opis kosztów, MPK, itp.).",
    )

    notes = models.TextField(blank=True, default="")

    # --- OCR metadata ---
    ocr_raw_filename = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Oryginalna nazwa pliku zeskanowanego dokumentu.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]
        verbose_name = "Dokument zakupowy"
        verbose_name_plural = "Dokumenty zakupowe"

    def save(self, *args, **kwargs):
        # Paragony są płacone przy kasie — domyślnie oznaczone jako opłacone
        if not self.pk and self.doc_type in (self.DOC_TYPE_PAR, self.DOC_TYPE_PAR_VAT):
            if not self.is_paid:
                self.is_paid = True
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.get_doc_type_display()} {self.document_number or self.uuid}"


class PurchaseDocumentItem(models.Model):
    """
    Line item on a purchase document.
    Optionally linked to a Product for warehouse matching.
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    document = models.ForeignKey(
        PurchaseDocument,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchase_document_items",
    )

    # Snapshot fields (from OCR or manual entry)
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=20, default="szt")
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        validators=[MinValueValidator(Decimal("0.0001"))],
    )
    unit_price_gross = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Cena brutto za jednostkę.",
    )
    vat_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("23.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Pozycja dokumentu zakupowego"
        verbose_name_plural = "Pozycje dokumentów zakupowych"

    def __str__(self):
        return f"{self.quantity} × {self.product_name}"
