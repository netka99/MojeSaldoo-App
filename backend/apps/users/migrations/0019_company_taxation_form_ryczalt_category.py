from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0018_company_deleted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="taxation_form",
            field=models.CharField(
                blank=True,
                choices=[
                    ("kpir", "KPiR (Podatkowa Księga Przychodów i Rozchodów)"),
                    ("ryczalt", "Ryczałt ewidencjonowany"),
                ],
                default="kpir",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="ryczalt_category",
            field=models.CharField(
                blank=True,
                null=True,
                choices=[
                    ("rolnicze",     "2% — Sprzedaż produktów rolnych"),
                    ("handel",       "3% — Handel (zakup i odsprzedaż)"),
                    ("budownictwo",  "5,5% — Budownictwo"),
                    ("uslugi",       "8,5% — Usługi"),
                    ("it",           "12% — Usługi IT i pośrednictwo finansowe"),
                    ("medyczne",     "14% — Usługi medyczne, architektoniczne, inżynieryjne"),
                    ("finansowe",    "15% — Doradztwo finansowe i rachunkowość"),
                    ("wolne_zawody", "17% — Wolne zawody (prawnicy, lekarze itp.)"),
                ],
                max_length=20,
            ),
        ),
    ]
