import uuid
from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("delivery", "0015_deliveryitem_batch_number"),
        ("products", "0018_product_is_service"),
        ("suppliers", "0002_initial"),
        ("users", "0023_company_ksef_usage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PurchaseDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("doc_type", models.CharField(
                    choices=[
                        ("FZ", "Faktura zakupowa"),
                        ("PAR", "Paragon fiskalny"),
                        ("PAR_VAT", "Paragon z NIP (faktura uproszczona)"),
                    ],
                    default="FZ",
                    max_length=10,
                )),
                ("status", models.CharField(
                    choices=[
                        ("draft", "Szkic"),
                        ("registered", "Zarejestrowany"),
                        ("matched", "Powiązany z PZ"),
                    ],
                    default="registered",
                    max_length=20,
                )),
                ("supplier_name", models.CharField(blank=True, default="", max_length=255)),
                ("supplier_nip", models.CharField(blank=True, default="", max_length=15)),
                ("document_number", models.CharField(
                    blank=True,
                    default="",
                    help_text="Numer dokumentu od dostawcy (np. FV/2026/001, nr paragonu).",
                    max_length=64,
                )),
                ("issue_date", models.DateField(blank=True, null=True)),
                ("due_date", models.DateField(
                    blank=True,
                    help_text="Termin płatności (opcjonalnie).",
                    null=True,
                )),
                ("payment_method", models.CharField(
                    blank=True,
                    choices=[
                        ("transfer", "Przelew"),
                        ("cash", "Gotówka"),
                        ("card", "Karta"),
                    ],
                    default="transfer",
                    max_length=20,
                )),
                ("total_net", models.DecimalField(
                    decimal_places=2,
                    default=Decimal("0.00"),
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("total_vat", models.DecimalField(
                    decimal_places=2,
                    default=Decimal("0.00"),
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("total_gross", models.DecimalField(
                    decimal_places=2,
                    default=Decimal("0.00"),
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("notes", models.TextField(blank=True, default="")),
                ("ocr_raw_filename", models.CharField(
                    blank=True,
                    default="",
                    help_text="Oryginalna nazwa pliku zeskanowanego dokumentu.",
                    max_length=255,
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("company", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="purchase_documents",
                    to="users.company",
                )),
                ("created_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="purchase_documents",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("delivery_document", models.ForeignKey(
                    blank=True,
                    help_text="PZ powiązane z tym dokumentem zakupowym.",
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="purchase_documents",
                    to="delivery.deliverydocument",
                )),
                ("supplier", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="purchase_documents",
                    to="suppliers.supplier",
                )),
            ],
            options={
                "verbose_name": "Dokument zakupowy",
                "verbose_name_plural": "Dokumenty zakupowe",
                "ordering": ["-issue_date", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="PurchaseDocumentItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("product_name", models.CharField(max_length=255)),
                ("unit", models.CharField(default="szt", max_length=20)),
                ("quantity", models.DecimalField(
                    decimal_places=4,
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0.0001"))],
                )),
                ("unit_price_gross", models.DecimalField(
                    decimal_places=4,
                    default=Decimal("0.00"),
                    help_text="Cena brutto za jednostkę.",
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("vat_rate", models.DecimalField(
                    decimal_places=2,
                    default=Decimal("23.00"),
                    max_digits=5,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("line_gross", models.DecimalField(
                    decimal_places=2,
                    default=Decimal("0.00"),
                    max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal("0"))],
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("document", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="items",
                    to="purchase_documents.purchasedocument",
                )),
                ("product", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="purchase_document_items",
                    to="products.product",
                )),
            ],
            options={
                "verbose_name": "Pozycja dokumentu zakupowego",
                "verbose_name_plural": "Pozycje dokumentów zakupowych",
                "ordering": ["created_at"],
            },
        ),
    ]
