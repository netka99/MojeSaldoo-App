from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0018_invoice_due_date_description"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="contracts",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Lista umów powiązanych z fakturą (Umowa w FA-3). Format: [{"date": "YYYY-MM-DD", "number": "NR"}]',
            ),
        ),
        migrations.AddField(
            model_name="invoice",
            name="purchase_orders",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Lista zamówień klienta (Zamowienie w FA-3). Format: [{"date": "YYYY-MM-DD", "number": "NR"}]',
            ),
        ),
    ]
