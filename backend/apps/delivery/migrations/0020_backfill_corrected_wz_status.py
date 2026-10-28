"""
Backfill WZ documents that are already fully corrected by existing WZ-KOR documents.
For each WZ that has at least one WZ-KOR, check if the total quantities returned across
all corrections equal or exceed the delivered quantities on the original WZ.
If yes, mark the original WZ as 'corrected'.
"""
from decimal import Decimal

from django.db import migrations


def backfill_corrected_wz(apps, schema_editor):
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")

    wz_docs = DeliveryDocument.objects.filter(
        document_type="WZ",
        status="delivered",
    ).prefetch_related("wz_corrections__items", "items")

    for wz in wz_docs:
        corrections = list(wz.wz_corrections.all())
        if not corrections:
            continue

        # Sum quantities returned per product across all WZ-KOR documents
        returned_by_product = {}
        for kor in corrections:
            for kor_item in kor.items.all():
                pid = kor_item.product_id
                qty = kor_item.quantity_actual if kor_item.quantity_actual is not None else kor_item.quantity_planned
                returned_by_product[pid] = returned_by_product.get(pid, Decimal("0")) + qty

        # Check if all original items are fully returned
        orig_items = list(wz.items.all())
        if not orig_items:
            continue

        all_returned = all(
            returned_by_product.get(item.product_id, Decimal("0"))
            >= (item.quantity_actual if item.quantity_actual is not None else item.quantity_planned)
            for item in orig_items
        )

        if all_returned:
            DeliveryDocument.objects.filter(pk=wz.pk).update(status="corrected")


def reverse_backfill(apps, schema_editor):
    # Reversing is not safe — we can't know which were corrected by this migration vs. manually
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0019_add_corrected_status"),
    ]

    operations = [
        migrations.RunPython(backfill_corrected_wz, reverse_backfill),
    ]
