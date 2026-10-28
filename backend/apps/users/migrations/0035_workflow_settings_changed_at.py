from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0034_add_auto_deliver_wz"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyworkflowsettings",
            name="orders_required_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="companyworkflowsettings",
            name="wz_required_before_invoice_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="companyworkflowsettings",
            name="auto_wz_on_order_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="companyworkflowsettings",
            name="auto_deliver_wz_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
