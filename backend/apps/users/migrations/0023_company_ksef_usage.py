from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0022_add_is_vat_payer"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="ksef_usage",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("mandatory", "Obowiązkowy KSeF"),
                    ("voluntary", "Dobrowolny KSeF"),
                    ("exempt", "Zwolniony z KSeF (np. rolnik, do 200k/rok)"),
                    ("none", "Nie używam KSeF"),
                ],
                default="mandatory",
                help_text="Czy firma używa KSeF. Wpływa na widoczność modułów i komunikaty.",
            ),
        ),
    ]
