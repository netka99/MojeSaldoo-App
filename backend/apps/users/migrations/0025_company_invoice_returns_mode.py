from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0024_add_purchase_orders_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="invoice_returns_mode",
            field=models.CharField(
                choices=[
                    ("fv_kor", "Oddzielna korekta FV-KOR (domyślne)"),
                    ("net_qty", "Netto w ilości (dostarczone − zwroty)"),
                    ("lines", "Osobna linia ze zwrotem"),
                ],
                default="fv_kor",
                help_text="Sposób ujmowania zwrotów na fakturach sprzedaży.",
                max_length=10,
            ),
        ),
    ]
