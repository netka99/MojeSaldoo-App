from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0019_invoice_contract_po_number"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="manually_edited",
            field=models.BooleanField(
                default=False,
                help_text="True when invoice was manually edited after creation from orders.",
            ),
        ),
    ]
