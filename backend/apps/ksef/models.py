import json
import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone


class KSeFSession(models.Model):
    """
    Stores the SSAPI session cookies for a company's active KSeF authentication.
    One session per company (OneToOne). Replaced on each new authentication.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.OneToOneField(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="ksef_session",
    )
    # Legacy: SSAPI session cookies — kept for backward compat, no longer used.
    session_cookies_json = models.TextField(default="{}")
    # KSeF API tokens — stored after successful authentication
    access_token_body = models.TextField(blank=True)
    refresh_token_body = models.TextField(blank=True)
    access_valid_until = models.DateTimeField(null=True, blank=True)
    refresh_valid_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def get_cookies(self) -> dict:
        try:
            return json.loads(self.session_cookies_json)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_cookies(self, cookies: dict) -> None:
        self.session_cookies_json = json.dumps(cookies)

    def is_active(self) -> bool:
        if not self.access_valid_until:
            return False
        return self.access_valid_until > timezone.now()

    def __str__(self):
        status = "active" if self.is_active() else "expired"
        return f"KSeFSession({self.company.name}, {status})"

    class Meta:
        verbose_name = "KSeF session"
        verbose_name_plural = "KSeF sessions"


class KSeFSentInvoice(models.Model):
    """
    Tracks invoices sent to KSeF via the consolidated crypto client.
    Replaces SSAPI's SQLite invoice table.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="ksef_sent_invoices",
    )
    # KSeF submission reference (returned by sessions/online/{ref}/invoices)
    reference_number = models.CharField(max_length=255, unique=True)
    # The session in which this invoice was sent
    session_reference_number = models.CharField(max_length=255)
    # Hash of the unencrypted invoice XML (for QR/verification URL)
    invoice_hash = models.CharField(max_length=255, blank=True)
    # P_1 field from the FA-3 XML (issue date)
    issue_date = models.CharField(max_length=20, blank=True)
    # Human-readable identifier for the buyer (shop name)
    shop = models.CharField(max_length=255, blank=True)
    total_gross_cents = models.IntegerField(null=True, blank=True)
    # Populated after KSeF processes the invoice
    ksef_number = models.CharField(max_length=255, blank=True)
    invoice_number = models.CharField(max_length=255, blank=True)
    status_code = models.IntegerField(null=True, blank=True)
    status_description = models.CharField(max_length=512, blank=True)
    # UPO XML — stored on first successful status poll; served without requiring a live session
    upo_xml = models.TextField(blank=True)
    upo_hash = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "KSeF sent invoice"
        verbose_name_plural = "KSeF sent invoices"

    def __str__(self):
        return f"{self.reference_number} ({self.shop})"


class ReceivedKSeFInvoice(models.Model):
    """
    Local cache of invoices received via KSeF (as buyer).
    Populated by syncing with KSeF API; never deleted automatically.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="received_ksef_invoices",
    )
    # KSeF identifier — unique per company
    ksef_number = models.CharField(max_length=255)

    invoice_number = models.CharField(max_length=255, blank=True)
    issue_date = models.DateField(null=True, blank=True)
    invoicing_date = models.DateField(null=True, blank=True)

    # Seller (Podmiot1)
    seller_nip = models.CharField(max_length=20, blank=True)
    seller_name = models.CharField(max_length=512, blank=True)

    # Buyer (Podmiot2)
    buyer_nip = models.CharField(max_length=20, blank=True)
    buyer_name = models.CharField(max_length=512, blank=True)

    net_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    gross_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    vat_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default="PLN")
    invoice_type = models.CharField(max_length=50, blank=True)

    # For KOR / KOR_ZAL / KOR_ROZ invoices — the KSeF number of the original invoice being corrected.
    # Populated when the FA-3 XML is downloaded and parsed (Fa/DaneFaKorygowanej/NrKSeFFaKorygowanej).
    original_ksef_number = models.CharField(max_length=255, blank=True)

    # Seller address — populated when XML is downloaded and parsed
    seller_address_l1 = models.CharField(max_length=512, blank=True)
    seller_address_l2 = models.CharField(max_length=512, blank=True)
    seller_country = models.CharField(max_length=10, blank=True)

    # Raw FA-3 XML stored on first download — allows parsing without KSeF session
    xml_content = models.TextField(blank=True)

    # Optional payment tracking — only used when CompanyWorkflowSettings.track_supplier_payments is True
    due_date = models.DateField(
        null=True,
        blank=True,
        help_text="Payment due date, parsed from XML TerminyPlatnosci or set manually.",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    is_paid = models.BooleanField(default=False)

    # OPEX tagging — mark service invoices as operating costs (not product purchases)
    OPEX_UTILITIES = "utilities"
    OPEX_RENT = "rent"
    OPEX_SERVICES = "services"
    OPEX_TRANSPORT = "transport"
    OPEX_MARKETING = "marketing"
    OPEX_OTHER = "other"
    OPEX_CATEGORY_CHOICES = [
        (OPEX_UTILITIES, "Media (prąd, gaz, woda)"),
        (OPEX_RENT, "Czynsz / leasing"),
        (OPEX_SERVICES, "Usługi zewnętrzne"),
        (OPEX_TRANSPORT, "Transport / logistyka"),
        (OPEX_MARKETING, "Marketing / reklama"),
        (OPEX_OTHER, "Inne"),
    ]
    opex_category = models.CharField(
        max_length=20,
        choices=OPEX_CATEGORY_CHOICES,
        null=True,
        blank=True,
        help_text="Set to classify this invoice as an operating cost (OPEX) rather than a product purchase.",
    )
    opex_tagged_at = models.DateTimeField(null=True, blank=True)

    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("company", "ksef_number")]
        ordering = ["-issue_date", "-first_seen_at"]
        verbose_name = "Received KSeF invoice"
        verbose_name_plural = "Received KSeF invoices"

    def __str__(self):
        return f"{self.ksef_number} ({self.seller_name})"

    @property
    def lines_cached(self) -> bool:
        return self.lines.exists()

    @classmethod
    def upsert_from_ksef(cls, company, invoices: list) -> tuple:
        """
        Upsert a list of invoice dicts (from KSeF API response) for a company.
        Returns (new_count, new_invoice_objects) — new objects have xml_content empty.
        """
        from datetime import date as date_type

        def _nip(party):
            return (party.get("nip") or party.get("identifier", {}).get("value") or "")[:20]

        def _name(party):
            return (party.get("name") or "")[:512]

        def _date(val):
            if not val:
                return None
            try:
                return date_type.fromisoformat(val[:10])
            except (ValueError, TypeError):
                return None

        def _dec(val):
            if val is None:
                return None
            try:
                return Decimal(str(val))
            except Exception:
                return None

        new_count = 0
        new_objects = []
        for inv in invoices:
            seller = inv.get("seller") or {}
            buyer = inv.get("buyer") or {}

            defaults = {
                "invoice_number": (inv.get("invoiceNumber") or "")[:255],
                "issue_date": _date(inv.get("issueDate")),
                "invoicing_date": _date(inv.get("invoicingDate")),
                "seller_nip": _nip(seller),
                "seller_name": _name(seller),
                "buyer_nip": _nip(buyer),
                "buyer_name": _name(buyer),
                "net_amount": _dec(inv.get("netAmount")),
                "gross_amount": _dec(inv.get("grossAmount")),
                "vat_amount": _dec(inv.get("vatAmount")),
                "currency": (inv.get("currency") or "PLN")[:10],
                "invoice_type": (inv.get("invoiceType") or "")[:50],
            }

            obj, created = cls.objects.update_or_create(
                company=company,
                ksef_number=inv["ksefNumber"],
                defaults=defaults,
            )
            if created:
                new_count += 1
                new_objects.append(obj)

        return new_count, new_objects


class KSeFProductMapping(models.Model):
    """
    Remembers which internal Product maps to a given invoice line name from a specific seller.
    Built up as users manually pick products in KSeFInboxPZPage.
    Used to auto-fill product suggestions on repeated imports from the same supplier.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="ksef_product_mappings",
    )
    seller_nip = models.CharField(max_length=20)
    invoice_line_name = models.CharField(max_length=512)
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="ksef_mappings",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("company", "seller_nip", "invoice_line_name")]
        verbose_name = "KSeF product mapping"
        verbose_name_plural = "KSeF product mappings"

    def __str__(self):
        return f"{self.seller_nip} / {self.invoice_line_name} → {self.product_id}"


class ReceivedKSeFInvoiceLine(models.Model):
    """Parsed line items from a received KSeF invoice XML — cached in DB after first download."""

    invoice = models.ForeignKey(
        ReceivedKSeFInvoice,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    position = models.PositiveSmallIntegerField(default=0)
    name = models.CharField(max_length=512, blank=True)
    unit = models.CharField(max_length=50, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit_net_price = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    vat_rate = models.CharField(max_length=10, blank=True)
    line_net = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        ordering = ["position"]
