"""
Data migration: copy existing DeliveryDocument.ksef_invoice (legacy 1:1 FK)
into the new DeliveryDocumentKSeFLink M:M table.

Safe to re-run: bulk_create with ignore_conflicts skips duplicates.
"""
from django.db import migrations


def migrate_fk_to_m2m(apps, schema_editor):
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
    DeliveryDocumentKSeFLink = apps.get_model("delivery", "DeliveryDocumentKSeFLink")

    qs = DeliveryDocument.objects.filter(
        ksef_invoice__isnull=False,
        document_type="PZ",
    ).values_list("id", "ksef_invoice_id")

    links = []
    for dd_id, inv_id in qs.iterator(chunk_size=500):
        links.append(
            DeliveryDocumentKSeFLink(
                delivery_document_id=dd_id,
                ksef_invoice_id=inv_id,
            )
        )

    DeliveryDocumentKSeFLink.objects.bulk_create(links, ignore_conflicts=True)


def reverse_migrate(apps, schema_editor):
    """
    Reverse: restore ksef_invoice FK from the first ksef_link for each PZ.
    Note: lossy if a PZ had multiple KSeF links — only the first is restored.
    """
    DeliveryDocument = apps.get_model("delivery", "DeliveryDocument")
    DeliveryDocumentKSeFLink = apps.get_model("delivery", "DeliveryDocumentKSeFLink")

    for link in DeliveryDocumentKSeFLink.objects.order_by("linked_at").iterator(chunk_size=500):
        DeliveryDocument.objects.filter(id=link.delivery_document_id).update(
            ksef_invoice_id=link.ksef_invoice_id
        )

    DeliveryDocumentKSeFLink.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0016_add_deliverydocument_ksef_m2m"),
    ]

    operations = [
        migrations.RunPython(migrate_fk_to_m2m, reverse_migrate),
    ]
