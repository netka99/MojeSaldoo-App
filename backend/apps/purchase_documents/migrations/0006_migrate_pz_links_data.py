"""
Data migration: copy existing PurchaseDocument.delivery_document (legacy 1:1 FK)
into the new PurchaseDocumentPzLink M:M table.

Safe to re-run: uses get_or_create so duplicates are skipped.
"""
from django.db import migrations


def migrate_fk_to_m2m(apps, schema_editor):
    PurchaseDocument = apps.get_model("purchase_documents", "PurchaseDocument")
    PurchaseDocumentPzLink = apps.get_model("purchase_documents", "PurchaseDocumentPzLink")

    qs = PurchaseDocument.objects.filter(
        delivery_document__isnull=False
    ).values_list("id", "delivery_document_id")

    links = []
    for pd_id, dd_id in qs.iterator(chunk_size=500):
        links.append(
            PurchaseDocumentPzLink(
                purchase_document_id=pd_id,
                delivery_document_id=dd_id,
            )
        )

    # bulk_create with ignore_conflicts skips existing unique pairs safely
    PurchaseDocumentPzLink.objects.bulk_create(links, ignore_conflicts=True)


def reverse_migrate(apps, schema_editor):
    """
    Reverse: restore delivery_document FK from the first pz_link for each document.
    Note: this is lossy if a document had multiple PZ links — only the first is restored.
    """
    PurchaseDocument = apps.get_model("purchase_documents", "PurchaseDocument")
    PurchaseDocumentPzLink = apps.get_model("purchase_documents", "PurchaseDocumentPzLink")

    for link in PurchaseDocumentPzLink.objects.order_by("linked_at").iterator(chunk_size=500):
        PurchaseDocument.objects.filter(id=link.purchase_document_id).update(
            delivery_document_id=link.delivery_document_id
        )

    PurchaseDocumentPzLink.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("purchase_documents", "0005_add_purchasedocumentpzlink_m2m"),
    ]

    operations = [
        migrations.RunPython(migrate_fk_to_m2m, reverse_migrate),
    ]
