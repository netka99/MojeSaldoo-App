import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0007_add_van_route_to_delivery_document"),
        ("van_routes", "0002_add_reconciliation_summary"),
    ]

    operations = [
        migrations.AlterField(
            model_name="vanroute",
            name="mm_document",
            field=models.OneToOneField(
                blank=True,
                help_text="MM document created when the van is loaded.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loading_route",
                to="delivery.deliverydocument",
            ),
        ),
    ]
