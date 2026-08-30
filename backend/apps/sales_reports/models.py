import uuid
from decimal import Decimal

from django.db import models, transaction


# ---------------------------------------------------------------------------
# DailySalesReport  — Raport Kasowy (RK)
# ---------------------------------------------------------------------------

class DailySalesReport(models.Model):
    """
    Dzienny raport sprzedaży gotówkowej / B2C.
    Numerowany automatycznie: RK/{year}/{seq:04d} per firma.
    """

    STATUS_DRAFT = "draft"
    STATUS_SAVED = "saved"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Szkic"),
        (STATUS_SAVED, "Zapisany"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="sales_reports",
    )
    report_number = models.CharField(max_length=32, blank=True)
    date = models.DateField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    notes = models.CharField(max_length=500, blank=True)

    # Totals — denormalized for fast dashboard queries
    amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00"),
        help_text="Łączny przychód brutto (suma linii).",
    )
    cost_total = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="Łączny koszt własny (qty × avg_cost). Null jeśli brak kosztów.",
    )
    vat_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("8.00"),
        help_text="Dominująca stawka VAT (dla prostych raportów kwotowych).",
    )
    vat_included = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "Daily Sales Report"
        verbose_name_plural = "Daily Sales Reports"

    def __str__(self):
        return f"{self.report_number or 'SZKIC'} | {self.date} | {self.amount} PLN"

    def save(self, *args, **kwargs):
        if not self.report_number and self.status == self.STATUS_SAVED:
            self._assign_number()
        super().save(*args, **kwargs)

    def _assign_number(self):
        year = self.date.year
        with transaction.atomic():
            from apps.users.models import Company
            Company.objects.select_for_update().get(pk=self.company_id)
            last = (
                DailySalesReport.objects.filter(
                    company=self.company,
                    report_number__startswith=f"RK/{year}/",
                )
                .order_by("-report_number")
                .first()
            )
            seq = 1
            if last and last.report_number:
                try:
                    seq = int(last.report_number.split("/")[-1]) + 1
                except (ValueError, IndexError):
                    pass
            self.report_number = f"RK/{year}/{seq:04d}"

    def recalculate_totals(self):
        lines = list(self.lines.all())
        self.amount = sum(l.line_revenue for l in lines)
        costs = [l.line_cost for l in lines if l.line_cost is not None]
        self.cost_total = sum(costs) if costs else None
        self.save(update_fields=["amount", "cost_total", "updated_at"])


# ---------------------------------------------------------------------------
# DailySalesReportItem  — linia raportu
# ---------------------------------------------------------------------------

class DailySalesReportItem(models.Model):
    report = models.ForeignKey(
        DailySalesReport,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales_report_lines",
    )
    # Snapshot — survives product changes/deletion
    product_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=20, default="szt.")

    qty = models.DecimalField(max_digits=10, decimal_places=3)
    vat_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("23.00"),
        help_text="Stawka VAT produktu (snapshot z momentu sprzedaży).",
    )
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=4,
        help_text="Cena sprzedaży brutto per jednostka.",
    )
    unit_cost = models.DecimalField(
        max_digits=10, decimal_places=4, null=True, blank=True,
        help_text="Koszt własny per jednostka (avg_cost snapshot).",
    )
    line_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    line_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def save(self, *args, **kwargs):
        self.line_revenue = (self.qty * self.unit_price).quantize(Decimal("0.01"))
        if self.unit_cost is not None:
            self.line_cost = (self.qty * self.unit_cost).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.product_name} × {self.qty} = {self.line_revenue}"


# ---------------------------------------------------------------------------
# SalesReportTemplate  — szablon dzienny
# ---------------------------------------------------------------------------

class SalesReportTemplate(models.Model):
    """
    Zapisany szablon raportu — lista produktów z domyślnymi ilościami.
    User może mieć wiele szablonów (np. "Sklep Lipowa", "Targ sobotni").
    """

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company",
        on_delete=models.CASCADE,
        related_name="sales_report_templates",
    )
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(
        default=False,
        help_text="Czy ten szablon ładuje się automatycznie przy nowym raporcie.",
    )
    lines = models.JSONField(
        default=list,
        help_text="Lista linii: [{product_id, product_name, unit, qty, unit_price, unit_cost}]",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "name"]

    def __str__(self):
        return f"{self.name} ({self.company})"
