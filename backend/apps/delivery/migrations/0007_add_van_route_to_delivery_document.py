import django.db.models.deletion
from django.db import migrations, models


def backfill_mm_van_route(apps, schema_editor):
    VanRoute = apps.get_model("van_routes", "VanRoute")
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
    for route in VanRoute.objects.exclude(mm_document_id=None).iterator():
        DeliveryDocument.objects.filter(pk=route.mm_document_id        ).update(van_route_id=route.id)


class Migration(migrations.Migration):

    dependencies = [
        ("van_routes", "0002_add_reconciliation_summary"),
        ("delivery", "0006_add_rw_document_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverydocument",
            name="van_route",
            field=models.ForeignKey(
                blank=True,
                help_text="Van route (trip) this document belongs to.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="delivery_documents",
                to="van_routes.vanroute",
            ),
        ),
        migrations.RunPython(backfill_mm_van_route, migrations.RunPython.noop),
    ]
