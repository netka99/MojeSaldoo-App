from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0020_backfill_corrected_wz_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverydocument",
            name="order_correction_applied",
            field=models.BooleanField(
                default=False,
                help_text="True when this WZ-KOR's quantities have been applied to the linked order (OrderItem.quantity updated).",
            ),
        ),
    ]
