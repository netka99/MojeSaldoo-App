from django.db import migrations


def cleanup_invalid_wz_van_route(apps, schema_editor):
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
    VanRoute = apps.get_model("van_routes", "VanRoute")

    route_info = {}
    for route in VanRoute.objects.prefetch_related("orders").iterator():
        route_info[route.id] = {
            "order_ids": set(route.orders.values_list("id", flat=True)),
            "date": route.date,
            "van_warehouse_id": route.van_warehouse_id,
        }

    for doc in DeliveryDocument.objects.filter(
        document_type="WZ",
        van_route_id__isnull=False,
    ).iterator():
        info = route_info.get(doc.van_route_id)
        if not info:
            DeliveryDocument.objects.filter(pk=doc.pk).update(van_route_id=None)
            continue

        invalid = False
        if doc.order_id:
            if doc.order_id not in info["order_ids"]:
                invalid = True
            if doc.issue_date != info["date"]:
                invalid = True
        else:
            if doc.issue_date != info["date"]:
                invalid = True
            if doc.from_warehouse_id and doc.from_warehouse_id != info["van_warehouse_id"]:
                invalid = True

        if not invalid:
            continue

        updates = {"van_route_id": None}
        if doc.status == "draft":
            updates["status"] = "cancelled"
        DeliveryDocument.objects.filter(pk=doc.pk).update(**updates)


def backfill_valid_wz_van_route(apps, schema_editor):
    """Link order WZ that match route date + warehouse but were missed."""
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
        ("delivery", "0008_backfill_wz_van_route"),
    ]

    operations = [
        migrations.RunPython(cleanup_invalid_wz_van_route, migrations.RunPython.noop),
        migrations.RunPython(backfill_valid_wz_van_route, migrations.RunPython.noop),
    ]
