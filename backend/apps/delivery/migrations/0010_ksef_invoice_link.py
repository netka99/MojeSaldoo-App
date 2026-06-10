from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0009_cleanup_invalid_wz_van_route"),
        ("ksef", "0005_ksefproductmapping"),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverydocument",
            name="ksef_invoice",
            field=models.ForeignKey(
                blank=True,
                help_text="KSeF invoice this PZ was created from.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pz_documents",
                to="ksef.receivedksefinvoice",
            ),
        ),
        migrations.AddField(
            model_name="deliveryitem",
            name="ksef_invoice_line_position",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Position of the source line in the KSeF invoice (0-based).",
                null=True,
            ),
        ),
    ]
