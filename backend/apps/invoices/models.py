import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order, OrderItem
from apps.products.models import Product


class Invoice(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_ISSUED = "issued"
    STATUS_SENT = "sent"
    STATUS_PAID = "paid"
    STATUS_OVERDUE = "overdue"
    STATUS_CANCELLED = "cancelled"

    # FA-3 RodzajFaktury: KOR is derived from is_correction=True; ZAL/ROZ must be
    # set explicitly. ZAL (advance) and ROZ (settlement) require additional XML
    # blocks not yet implemented — the validator blocks sending them until they are.
    KSEF_TYPE_VAT = "VAT"
    KSEF_TYPE_ZAL = "ZAL"
    KSEF_TYPE_ROZ = "ROZ"
    KSEF_INVOICE_TYPE_CHOICES = [
        (KSEF_TYPE_VAT, "Podstawowa (VAT)"),
        (KSEF_TYPE_ZAL, "Zaliczkowa (ZAL)"),
        (KSEF_TYPE_ROZ, "Rozliczeniowa (ROZ)"),
    ]

    PAYMENT_METHOD_CHOICES = [
        ("transfer", "Przelew bankowy"),
        ("cash", "Gotówka"),
        ("card", "Karta płatnicza"),
        ("voucher", "Bon"),
        ("check", "Czek"),
        ("credit", "Kredyt"),
        ("mobile", "Płatność mobilna"),
        ("other", "Inna forma płatności"),
    ]
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_ISSUED, "Wystawiona"),
        (STATUS_SENT, "Wysłana"),
        (STATUS_PAID, "Opłacona"),
        (STATUS_OVERDUE, "Przeterminowana"),
        (STATUS_CANCELLED, "Anulowana"),
    ]
    KSEF_STATUS_CHOICES = [
        ("not_sent", "Nie wysłana"),
        ("pending", "Oczekuje"),
        ("sent", "Wysłana"),
        ("accepted", "Przyjęta"),
        ("rejected", "Odrzucona"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="invoices",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices",
        help_text="User who created or last updated (audit).",
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invoices",
        help_text="Primary order (legacy single-order invoices). Null for manual invoices.",
    )
    orders = models.ManyToManyField(
        Order,
        through="InvoiceOrder",
        related_name="multi_invoices",
        blank=True,
        help_text="All orders covered by this invoice (multi-order flow).",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    delivery_document = models.ForeignKey(
        DeliveryDocument,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invoices",
    )

    invoice_number = models.CharField(
        max_length=32,
        null=True,
        blank=True,
        help_text="Assigned on save, e.g. FV/2026/0001 (unique per company).",
    )
    # P_6 variants — "Wybierz datę albo okres, którego dotyczy faktura"
    SALE_DATE_TYPE_SINGLE = 'single'       # [4a] Wspólna data dokonania dostawy/usługi → <P_6>
    SALE_DATE_TYPE_PERIOD = 'period'       # [4b] Okres (art. 19a ust. 3/4/5) → <OkresFa>
    SALE_DATE_TYPE_ISSUE  = 'issue'        # [4c] Data wystawienia = data wykonania → brak P_6
    SALE_DATE_TYPE_VARIOUS = 'various'     # [4d] Różne daty per wiersz → brak P_6 na poziomie Fa
    SALE_DATE_TYPE_CHOICES = [
        (SALE_DATE_TYPE_SINGLE,  'Wspólna dla całej faktury data dokonania lub zakończenia dostawy towarów lub wykonania usługi'),
        (SALE_DATE_TYPE_PERIOD,  'Okres, którego dotyczy faktura (art. 19a ust. 3/4/5)'),
        (SALE_DATE_TYPE_ISSUE,   'Data wystawienia jest taka sama jak data wykonania czynności'),
        (SALE_DATE_TYPE_VARIOUS, 'Różne daty dla poszczególnych towarów lub usług'),
    ]
    sale_date_type = models.CharField(
        max_length=10,
        choices=SALE_DATE_TYPE_CHOICES,
        default=SALE_DATE_TYPE_SINGLE,
        help_text="Wariant pola P_6 w FA-3.",
    )
    issue_date = models.DateField()
    sale_date = models.DateField()
    sale_date_to = models.DateField(
        null=True, blank=True,
        help_text="Koniec okresu dla OkresFa (gdy sale_date_type='period').",
    )
    due_date = models.DateField()
    payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default="transfer",
    )

    subtotal_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    subtotal_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    vat_amount = models.DecimalField(
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

    ksef_reference_number = models.CharField(max_length=255, blank=True, default="")
    ksef_number = models.CharField(max_length=255, blank=True, default="")
    ksef_status = models.CharField(
        max_length=20,
        choices=KSEF_STATUS_CHOICES,
        default="not_sent",
    )
    ksef_sent_at = models.DateTimeField(null=True, blank=True)
    ksef_error_message = models.TextField(blank=True, default="")
    invoice_hash = models.CharField(max_length=255, blank=True, default="")
    upo_received = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
    )
    is_correction = models.BooleanField(
        default=False,
        help_text="True for FV-KOR (correction invoice).",
    )
    corrects_invoice = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="corrections",
        help_text="For FV-KOR: the original invoice this document corrects.",
    )
    correction_reason = models.TextField(
        blank=True,
        default="",
        help_text="Required reason for FV-KOR.",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    # ---------------------------------------------------------------
    # KSeF FA-3 optional fields
    # ---------------------------------------------------------------

    # RodzajFaktury — VAT/ZAL/ROZ (KOR overrides this when is_correction=True).
    ksef_invoice_type = models.CharField(
        max_length=3,
        choices=KSEF_INVOICE_TYPE_CHOICES,
        default=KSEF_TYPE_VAT,
        help_text="Rodzaj faktury w KSeF FA-3. KOR jest ustawiany automatycznie.",
    )

    # Adnotacje (P_16–P_23): FA-3 requires these flags to be set explicitly.
    # Default False → emits code "2" (nie dotyczy) in the XML for all of them.
    annotation_mpp = models.BooleanField(
        default=False,
        help_text="Mechanizm podzielonej płatności (MPP, P_16). "
                  "Wymagany gdy faktura opiewa na ≥15 000 PLN i zawiera towary/usługi z załącznika nr 15 do ustawy VAT.",
    )
    annotation_kasowa = models.BooleanField(
        default=False,
        help_text="Metoda kasowa (P_17, art. 21 ust. 1 ustawy VAT). "
                  "Dotyczy podatników rozliczających VAT metodą kasową.",
    )
    annotation_odwrotne = models.BooleanField(
        default=False,
        help_text="Odwrotne obciążenie (P_18). "
                  "Stosowane gdy VAT rozlicza nabywca (np. złom, odpady, usługi budowlane B2B).",
    )
    annotation_trojstronna = models.BooleanField(
        default=False,
        help_text="Uproszczona procedura trójstronna (P_18A, art. 135 ust. 1 pkt 4 ustawy VAT). "
                  "Dotyczy transakcji wewnątrzwspólnotowych z trzema podmiotami.",
    )
    annotation_zwolnienie = models.BooleanField(
        default=False,
        help_text="Dostawa zwolniona od podatku (P_19, art. 43 ust. 1, art. 113 ust. 1 i 9 lub art. 82 ust. 3). "
                  "Zaznacz gdy sprzedajesz towary/usługi zwolnione z VAT.",
    )
    annotation_marza = models.BooleanField(
        default=False,
        help_text="Procedura marży (P_23, art. 119 lub 120 ustawy VAT). "
                  "Dotyczy biur podróży i handlu używanymi towarami.",
    )
    annotation_tp = models.BooleanField(
        default=False,
        help_text="Powiązania między nabywcą a sprzedawcą (TP, P_106E_2). "
                  "Wymagany zgodnie z §10 ust. 4 pkt 3 rozporządzenia JPK, gdy strony są podmiotami powiązanymi.",
    )
    annotation_fp = models.BooleanField(
        default=False,
        help_text="Faktura do paragonu z kasy fiskalnej (FP, P_106E_3, art. 109 ust. 3d ustawy VAT). "
                  "Zaznacz gdy wystawiasz fakturę do wcześniej wydrukowanego paragonu.",
    )
    annotation_oss = models.BooleanField(
        default=False,
        help_text="Procedura OSS — One Stop Shop (P_106E_1). "
                  "Dotyczy sprzedaży B2C do konsumentów w innych krajach UE.",
    )

    # Płatność — dane bankowe
    bank_account_iban = models.CharField(
        max_length=34, blank=True, default="",
        help_text="Numer rachunku bankowego IBAN (np. PL12 1234 5678 9012 3456 7890 1234). "
                  "Wymagany przy formie płatności 'przelew'.",
    )
    bank_swift = models.CharField(
        max_length=11, blank=True, default="",
        help_text="Kod SWIFT/BIC banku (opcjonalnie).",
    )
    bank_name = models.CharField(
        max_length=100, blank=True, default="",
        help_text="Nazwa banku (opcjonalnie).",
    )
    payment_link = models.CharField(
        max_length=512, blank=True, default="",
        help_text="Link do płatności bezgotówkowej (opcjonalnie, max 512 znaków).",
    )
    ksef_payment_id = models.CharField(
        max_length=50, blank=True, default="",
        help_text="Identyfikator płatności KSeF (opcjonalnie, max 50 znaków).",
    )
    discount_conditions = models.CharField(
        max_length=256, blank=True, default="",
        help_text="Warunki skonta — opis rabatu za wcześniejszą płatność (opcjonalnie, max 256 znaków).",
    )
    other_payment_description = models.CharField(
        max_length=256, blank=True, default="",
        help_text="Opis innej formy płatności (InnyRodzajPlatnosci w FA-3). "
                  "Wymagane gdy payment_method='other'.",
    )
    payment_received_at = models.DateField(
        null=True, blank=True,
        help_text="Data otrzymania zapłaty (P_IZ / DataZaplaty w FA-3). "
                  "Gdy ustawione → <P_IZ>1</P_IZ> + <DataZaplaty> w XML KSeF. "
                  "Przy gotówce ustaw = data wystawienia. Zostaw puste dla przelewów.",
    )
    due_date_description = models.CharField(
        max_length=256, blank=True, default="",
        help_text="Opis terminu płatności (OpisTerminuPlatnosci w FA-3). "
                  "Gdy ustawiony — zastępuje datę due_date w XML (<OpisTerminuPlatnosci> zamiast <Termin>). "
                  "Np. 'Płatność przy odbiorze', 'Przelew w ciągu 7 dni od dostawy'.",
    )

    # Warunki transakcji — umowy i zamówienia klienta (FA-3 WarunkiTransakcji)
    # Format: [{"date": "YYYY-MM-DD", "number": "..."}, ...]  (oba pola opcjonalne)
    contracts = models.JSONField(
        default=list, blank=True,
        help_text="Lista umów powiązanych z fakturą (Umowa w FA-3 WarunkiTransakcji). "
                  "Format: [{\"date\": \"YYYY-MM-DD\", \"number\": \"NR\"}, ...]",
    )
    purchase_orders = models.JSONField(
        default=list, blank=True,
        help_text="Lista zamówień klienta (Zamowienie w FA-3 WarunkiTransakcji). "
                  "Format: [{\"date\": \"YYYY-MM-DD\", \"number\": \"NR\"}, ...]",
    )

    # Dokumenty WZ — numery magazynowych dokumentów wydania zewnętrznego
    wz_numbers = models.JSONField(
        default=list, blank=True,
        help_text="Lista numerów dokumentów magazynowych WZ powiązanych z fakturą (opcjonalnie).",
    )

    # Stopka i opis
    footer_text = models.CharField(
        max_length=3500, blank=True, default="",
        help_text="Stopka faktury — tekst drukowany u dołu faktury (opcjonalnie, max 3500 znaków).",
    )
    extra_notes = models.TextField(
        blank=True, default="",
        help_text="Dodatkowy opis do faktury (widoczny na wydruku, nie wysyłany do KSeF).",
    )

    # prices_include_vat: True = FaWiersz używa P_9B+P_11A (brutto, domyślne zachowanie).
    # False = P_9A+P_11 (netto). Default True zachowuje kompatybilność ze starymi fakturami.
    prices_include_vat = models.BooleanField(
        default=True,
        help_text="True = faktura w cenach brutto (P_9B/P_11A). "
                  "False = faktura w cenach netto (P_9A/P_11). "
                  "Domyślnie True dla zgodności z istniejącymi fakturami.",
    )

    # Miejsce wystawienia (P_1M w FA-3). Jeśli puste — fallback do company.city.
    place_of_issue = models.CharField(
        max_length=100, blank=True, default="",
        help_text="Miejsce wystawienia faktury (P_1M). Jeśli puste — używane jest miasto firmy.",
    )

    # Czy drukować numery dokumentów WZ na fakturze (dla faktur zbiorczych).
    show_wz_numbers = models.BooleanField(
        default=True,
        help_text="Czy wyświetlać numery dokumentów WZ na fakturze zbiorczej.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def _next_invoice_number(cls, company_id, issue_date, is_correction: bool = False) -> str:
        """
        Next invoice number for this company, respecting Company numbering settings.
        Must run inside the same transaction.atomic() as a Company row lock.
        """
        from apps.users.models import Company
        company = Company.objects.get(pk=company_id)

        prefix = (company.invoice_number_prefix or "FV").strip()
        padding = max(1, min(int(company.invoice_number_padding or 4), 8))
        period = company.invoice_number_period or "yearly"
        start = int(company.invoice_number_start or 1)

        y = (issue_date or timezone.localdate()).year
        m = (issue_date or timezone.localdate()).month

        type_prefix = f"{prefix}-KOR" if is_correction else prefix
        date_part = f"{y}/{m:02d}" if period == "monthly" else str(y)
        search_prefix = f"{type_prefix}/{date_part}/"

        max_seq = 0
        for num in cls.objects.filter(
            company_id=company_id,
            invoice_number__startswith=search_prefix,
        ).values_list("invoice_number", flat=True):
            if not num:
                continue
            try:
                seq = int(num[len(search_prefix):].split("/")[0])
                if seq > max_seq:
                    max_seq = seq
            except (ValueError, IndexError):
                continue

        next_seq = start if max_seq == 0 else max_seq + 1
        return f"{type_prefix}/{date_part}/{next_seq:0{padding}d}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Invoice {self.invoice_number or self.pk}"

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "invoice_number"],
                name="invoices_invoice_company_invoice_number_uniq",
            ),
            # NOTE: active-invoice-per-order uniqueness is now enforced in service
            # (supports multi-order invoices via InvoiceOrder M2M).
        ]


class InvoiceItem(models.Model):
    """
    Invoice line: optional link to order line / product, snapshots, and computed net/VAT/gross.
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="items",
    )
    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_items",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_items",
    )
    product_name = models.CharField(max_length=255, blank=True, default="")
    product_unit = models.CharField(max_length=20, blank=True, default="")
    pkwiu = models.CharField(max_length=32, blank=True, default="")
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    is_removed = models.BooleanField(
        default=False,
        help_text="True for correction lines that remove the original line entirely.",
    )
    unit_price_net = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        default=Decimal("0.0000"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    vat_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_net = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_vat = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    line_gross = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def _recompute_line_amounts(self) -> None:
        if self.is_removed:
            self.line_net = Decimal("0.00")
            self.line_vat = Decimal("0.00")
            self.line_gross = Decimal("0.00")
            return
        net = (self.quantity * self.unit_price_net).quantize(Decimal("0.01"))
        self.line_net = net
        self.line_vat = (net * (self.vat_rate / Decimal("100"))).quantize(Decimal("0.01"))
        self.line_gross = (self.line_net + self.line_vat).quantize(Decimal("0.01"))

    def save(self, *args, **kwargs):
        if self.product_id:
            p = self.product
            if not self.product_name:
                self.product_name = p.name
            if not self.product_unit:
                self.product_unit = p.unit or ""
        elif self.order_item_id:
            oi = self.order_item
            if oi.product_name and not self.product_name:
                self.product_name = oi.product_name
            if oi.product_unit and not self.product_unit:
                self.product_unit = oi.product_unit
        self._recompute_line_amounts()
        super().save(*args, **kwargs)

    def __str__(self):
        label = self.product_name or (self.product.name if self.product_id else "")
        return f"{self.quantity} × {label}"

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Invoice item"
        verbose_name_plural = "Invoice items"


class InvoiceOrder(models.Model):
    """Junction table linking an Invoice to one or more Orders (multi-order invoicing)."""

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="invoice_orders",
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.PROTECT,
        related_name="invoice_orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("invoice", "order")]
        ordering = ["created_at"]
        verbose_name = "Invoice order"
        verbose_name_plural = "Invoice orders"

    def __str__(self):
        return f"{self.invoice_id} ↔ {self.order_id}"


class InvoiceAdvance(models.Model):
    """
    Junction table linking a ROZ (settlement) invoice to one or more ZAL (advance) invoices.
    deduction_amount: amount deducted from this ZAL on the ROZ.
                      None = full ZAL total_gross is deducted.
    """

    roz_invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="advance_links",
    )
    zal_invoice = models.ForeignKey(
        Invoice,
        on_delete=models.PROTECT,
        related_name="settlement_links",
    )
    deduction_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Amount deducted from this ZAL on the ROZ. Null = full ZAL total_gross.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["roz_invoice", "zal_invoice"],
                name="invoices_advance_roz_zal_uniq",
            )
        ]
        ordering = ["created_at"]
        verbose_name = "Invoice advance link"
        verbose_name_plural = "Invoice advance links"

    def __str__(self):
        return f"ROZ {self.roz_invoice_id} ← ZAL {self.zal_invoice_id}"
