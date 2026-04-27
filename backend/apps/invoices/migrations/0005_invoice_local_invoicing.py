# Replaces legacy Invoice (bigint PK, OneToOne order) with UUID PK and full local invoicing schema.
# Existing invoice rows are dropped (dev / pre-production).

import uuid
from decimal import Decimal

import django.core.validators
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0004_company_fk_required"),
        ("delivery", "0002_deliveryitem"),
    ]

    operations = [
        migrations.DeleteModel(name="Invoice"),
        migrations.CreateModel(
            name="Invoice",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "invoice_number",
                    models.CharField(
                        blank=True,
                        help_text="Assigned on save, e.g. FV/2026/0001 (unique per company).",
                        max_length=32,
                        null=True,
                    ),
                ),
                ("issue_date", models.DateField()),
                ("sale_date", models.DateField()),
                ("due_date", models.DateField()),
                (
                    "payment_method",
                    models.CharField(
                        choices=[
                            ("transfer", "Przelew"),
                            ("cash", "Gotówka"),
                            ("card", "Karta"),
                        ],
                        default="transfer",
                        max_length=20,
                    ),
                ),
                (
                    "subtotal_net",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0"))
                        ],
                    ),
                ),
                (
                    "subtotal_gross",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0"))
                        ],
                    ),
                ),
                (
                    "vat_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0"))
                        ],
                    ),
                ),
                (
                    "total_gross",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0"))
                        ],
                    ),
                ),
                (
                    "ksef_reference_number",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                (
                    "ksef_number",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                (
                    "ksef_status",
                    models.CharField(
                        choices=[
                            ("not_sent", "Nie wysłana"),
                            ("pending", "Oczekuje"),
                            ("sent", "Wysłana"),
                            ("accepted", "Przyjęta"),
                            ("rejected", "Odrzucona"),
                        ],
                        default="not_sent",
                        max_length=20,
                    ),
                ),
                ("ksef_sent_at", models.DateTimeField(blank=True, null=True)),
                ("ksef_error_message", models.TextField(blank=True, default="")),
                (
                    "invoice_hash",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                ("upo_received", models.BooleanField(default=False)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("issued", "Wystawiona"),
                            ("sent", "Wysłana"),
                            ("paid", "Opłacona"),
                            ("overdue", "Przeterminowana"),
                            ("cancelled", "Anulowana"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="invoices",
                        to="users.company",
                    ),
                ),
                (
                    "customer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="invoices",
                        to="customers.customer",
                    ),
                ),
                (
                    "delivery_document",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="invoices",
                        to="delivery.deliverydocument",
                    ),
                ),
                (
                    "order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="invoices",
                        to="orders.order",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        help_text="User who created or last updated (audit).",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="invoices",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="invoice",
            constraint=models.UniqueConstraint(
                fields=("company", "invoice_number"),
                name="invoices_invoice_company_invoice_number_uniq",
            ),
        ),
    ]
