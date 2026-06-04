from django.db import migrations


def backfill_wz_van_route(apps, schema_editor):
    VanRoute = apps.get_model("van_routes", "VanRoute")
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
    for route in VanRoute.objects.prefetch_related("orders").iterator():
        order_ids = list(route.orders.values_list("id", flat=True))
        if not order_ids:
            continue
        DeliveryDocument.objects.filter(
            order_id__in=order_ids,
            document_type="WZ",
            van_route_id__isnull=True,
            issue_date=route.date,
            from_warehouse_id=route.van_warehouse_id,
        ).update(van_route_id=route.id)


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0007_add_van_route_to_delivery_document"),
    ]

    operations = [
        migrations.RunPython(backfill_wz_van_route, migrations.RunPython.noop),
    ]
