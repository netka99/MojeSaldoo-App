"""
Add kpir_column to CompanyOpexCategory.
Backfills existing rows using the KPIR_COLUMN_DEFAULTS map.
"""
from django.db import migrations, models


KPIR_COLUMN_DEFAULTS = {
    "raw_materials": "10",
    "packaging":     "10",
    "salaries":      "12",
}


def backfill_kpir_column(apps, schema_editor):
    CompanyOpexCategory = apps.get_model("cash_flow", "CompanyOpexCategory")
    for cat in CompanyOpexCategory.objects.all():
        cat.kpir_column = KPIR_COLUMN_DEFAULTS.get(cat.slug, "13")
        cat.save(update_fields=["kpir_column"])


class Migration(migrations.Migration):

    dependencies = [
        ("cash_flow", "0012_add_vat_deduction_and_is_private"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyopexcategory",
            name="kpir_column",
            field=models.CharField(
                choices=[
                    ("10", "Kol. 10 — Zakup towarów i materiałów"),
                    ("12", "Kol. 12 — Wynagrodzenia"),
                    ("13", "Kol. 13 — Pozostałe wydatki"),
                ],
                default="13",
                help_text="KPiR column this category maps to for the accountant export.",
                max_length=2,
            ),
        ),
        migrations.RunPython(backfill_kpir_column, migrations.RunPython.noop),
    ]
