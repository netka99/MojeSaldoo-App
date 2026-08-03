import uuid
import datetime
from decimal import Decimal

from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


# ---------------------------------------------------------------------------
# Shared OPEX category vocabulary — used by both QuickExpense and
# ReceivedKSeFInvoice so that costs from both sources can be aggregated.
# ---------------------------------------------------------------------------

OPEX_CATEGORY_CHOICES = [
    ("raw_materials",  "Surowce / materiały"),
    ("packaging",      "Opakowania"),
    ("fuel",           "Paliwo"),
    ("transport",      "Transport / dostawa"),
    ("utilities",      "Media / rachunki"),
    ("rent",           "Czynsz / leasing"),
    ("services",       "Usługi zewnętrzne"),
    ("marketing",      "Marketing / reklama"),
    ("salaries",       "Wynagrodzenia"),
    ("repair",         "Naprawa / serwis"),
    ("other",          "Inne"),
]

OPEX_CATEGORY_LABELS = {k: v for k, v in OPEX_CATEGORY_CHOICES}


class CompanyOpexCategory(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="opex_categories",
    )
    name = models.CharField(max_length=100)
    slug = models.CharField(
        max_length=30,
        blank=True,
        help_text="Machine-readable key, e.g. 'raw_materials'. Used to match legacy hardcoded categories.",
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "slug"],
                condition=models.Q(slug__gt=""),
                name="unique_company_slug_nonempty",
            )
        ]
        verbose_name = "Company OPEX Category"
        verbose_name_plural = "Company OPEX Categories"

    def __str__(self):
        return f"{self.company.name} – {self.name}"


@receiver(post_save, sender="users.Company")
def seed_opex_categories(sender, instance, created, **kwargs):
    if not created:
        return
    for i, (slug, name) in enumerate(OPEX_CATEGORY_CHOICES):
        CompanyOpexCategory.objects.get_or_create(
            company=instance,
            slug=slug,
            defaults={"name": name, "sort_order": i},
        )


class CompanyTaxConfig(models.Model):
    TAX_FORM_KPIR_LINEAR = "kpir_linear"
    TAX_FORM_KPIR_SCALE = "kpir_scale"
    TAX_FORM_RYCZALT = "ryczalt"
    TAX_FORM_CHOICES = [
        (TAX_FORM_KPIR_LINEAR, "KPiR – podatek liniowy 19%"),
        (TAX_FORM_KPIR_SCALE, "KPiR – skala podatkowa"),
        (TAX_FORM_RYCZALT, "Ryczałt od przychodów"),
    ]

    VAT_METHOD_MEMORIAŁOWA = "memoriałowa"
    VAT_METHOD_KASOWA = "kasowa"
    VAT_METHOD_CHOICES = [
        (VAT_METHOD_MEMORIAŁOWA, "Memoriałowa (od daty faktury)"),
        (VAT_METHOD_KASOWA, "Kasowa (od daty zapłaty)"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.OneToOneField(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="tax_config",
    )
    tax_form = models.CharField(
        max_length=20,
        choices=TAX_FORM_CHOICES,
        default=TAX_FORM_KPIR_LINEAR,
    )
    tax_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("19.00"),
        help_text="Stawka podatku dochodowego w % (np. 19.00 dla KPiR liniowego).",
    )
    vat_payer = models.BooleanField(default=True, help_text="Czy firma jest płatnikiem VAT?")
    vat_method = models.CharField(
        max_length=20,
        choices=VAT_METHOD_CHOICES,
        default=VAT_METHOD_MEMORIAŁOWA,
    )
    vat_due_day = models.IntegerField(
        default=25,
        help_text="Dzień miesiąca, do którego należy zapłacić VAT (domyślnie 25).",
    )
    zus_due_day = models.IntegerField(
        default=20,
        help_text="Dzień miesiąca, do którego należy zapłacić ZUS (domyślnie 20).",
    )
    cash_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Gotówka w kasie/kasetce (wpisana ręcznie).",
    )
    bank_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Stan konta bankowego (wpisany ręcznie).",
    )
    balance_updated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Kiedy ostatnio zaktualizowano salda.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Company Tax Config"
        verbose_name_plural = "Company Tax Configs"

    def __str__(self):
        return f"{self.company.name} – {self.get_tax_form_display()}"


class QuickExpense(models.Model):
    # Keep legacy CAT_* constants so existing code that references them doesn't break.
    CAT_FUEL = "fuel"
    CAT_RAW_MATERIALS = "raw_materials"
    CAT_TRANSPORT = "transport"
    CAT_REPAIR = "repair"
    CAT_PACKAGING = "packaging"
    CAT_UTILITIES = "utilities"
    CAT_OTHER = "other"

    COST_TYPE_DIRECT = "direct"
    COST_TYPE_INDIRECT = "indirect"
    COST_TYPE_CHOICES = [
        (COST_TYPE_DIRECT, "Koszt bezpośredni (wpływa na marżę produktu)"),
        (COST_TYPE_INDIRECT, "Koszt ogólny (wpływa na cash flow)"),
    ]

    DOC_PARAGON = "paragon"
    DOC_FAKTURA = "faktura_vat"
    DOC_WZ = "wz"
    DOC_OTHER = "inne"
    DOCUMENT_TYPE_CHOICES = [
        ("paragon", "Paragon"),
        ("faktura_vat", "Faktura VAT"),
        ("wz", "WZ / dokument magazynowy"),
        ("inne", "Inny dokument"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="quick_expenses",
    )
    date = models.DateField(default=datetime.date.today)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(
        max_length=20,
        choices=OPEX_CATEGORY_CHOICES,
        default="other",
    )
    cost_type = models.CharField(
        max_length=10,
        choices=COST_TYPE_CHOICES,
        default=COST_TYPE_INDIRECT,
    )
    has_vat = models.BooleanField(
        default=False,
        help_text="Czy ten wydatek ma fakturę VAT do odliczenia?",
    )
    vendor = models.CharField(max_length=255, blank=True)
    document_number = models.CharField(max_length=100, blank=True)
    document_type = models.CharField(
        max_length=20,
        choices=DOCUMENT_TYPE_CHOICES,
        default="paragon",
    )
    product_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Optional product description (from product catalog or free text)",
    )
    notes = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "Quick Expense"
        verbose_name_plural = "Quick Expenses"

    def __str__(self):
        return f"{self.date} | {self.get_category_display()} | {self.amount} PLN"


class DailyB2CRevenue(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="b2c_revenues",
    )
    date = models.DateField()
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Kwota brutto (zawiera VAT, jeśli vat_included=True).",
    )
    vat_included = models.BooleanField(
        default=True,
        help_text="Czy kwota zawiera VAT?",
    )
    vat_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("23.00"),
        help_text="Stawka VAT w % (np. 23.00).",
    )
    notes = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "Daily B2C Revenue"
        verbose_name_plural = "Daily B2C Revenues"

    def __str__(self):
        return f"{self.date} | B2C | {self.amount} PLN"
