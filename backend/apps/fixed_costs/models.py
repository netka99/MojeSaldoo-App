import uuid

from django.db import models


class FixedCost(models.Model):
    CAT_WYNAGRODZENIA = "wynagrodzenia"
    CAT_ZUS_ZDROWOTNE = "zus_zdrowotne"
    CAT_CZYNSZ = "czynsz"
    CAT_LEASING = "leasing"
    CAT_UBEZPIECZENIA = "ubezpieczenia"
    CAT_KSIEGOWOSC = "ksiegowosc"
    CAT_SUBSKRYPCJE = "subskrypcje"
    CAT_PALIWO = "paliwo"
    CAT_INNE = "inne"
    CATEGORY_CHOICES = [
        (CAT_WYNAGRODZENIA, "Wynagrodzenia"),
        (CAT_ZUS_ZDROWOTNE, "ZUS / Zdrowotne"),
        (CAT_CZYNSZ, "Czynsz / Najem"),
        (CAT_LEASING, "Leasing / Raty"),
        (CAT_UBEZPIECZENIA, "Ubezpieczenia"),
        (CAT_KSIEGOWOSC, "Biuro rachunkowe"),
        (CAT_SUBSKRYPCJE, "Subskrypcje i software"),
        (CAT_PALIWO, "Paliwo"),
        (CAT_INNE, "Inne"),
    ]

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    company = models.ForeignKey(
        "users.Company", on_delete=models.CASCADE, related_name="fixed_costs"
    )
    category = models.CharField(
        max_length=20, choices=CATEGORY_CHOICES, default=CAT_INNE
    )
    description = models.CharField(max_length=255, blank=True)
    amount_monthly = models.DecimalField(max_digits=12, decimal_places=2)
    # First month this cost applies — always store as the 1st of the month.
    active_from = models.DateField(
        help_text="Pierwszy miesiąc, od którego koszt obowiązuje (YYYY-MM-01)."
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "description"]

    def __str__(self):
        return (
            f"{self.get_category_display()} — "
            f"{self.description or '—'} ({self.amount_monthly} PLN/mc)"
        )
