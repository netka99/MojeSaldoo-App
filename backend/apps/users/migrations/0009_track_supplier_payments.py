from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0008_alter_companymodule_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyworkflowsettings",
            name="track_supplier_payments",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "If True, show payment tracking fields (due_date, paid_at, is_paid) "
                    "on received supplier invoices (ReceivedKSeFInvoice). "
                    "Disable for companies that do not track when they pay suppliers."
                ),
            ),
        ),
    ]
