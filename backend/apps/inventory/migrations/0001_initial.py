import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("products", "0015_avg_cost_source"),
        ("users", "0009_track_supplier_payments"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="InventoryCount",
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
                    "document_number",
                    models.CharField(
                        blank=True,
                        db_index=True,
                        help_text="Auto-assigned, e.g. INW/2026/0001 (unique per company).",
                        max_length=50,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("completed", "Completed"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="draft",
                        max_length=20,
                    ),
                ),
                ("count_date", models.DateField()),
                ("notes", models.TextField(blank=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="inventory_counts",
                        to="users.company",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="inventory_counts_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "warehouse",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="inventory_counts",
                        to="products.warehouse",
                    ),
                ),
            ],
            options={
                "verbose_name": "Inventory count",
                "verbose_name_plural": "Inventory counts",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="InventoryCountItem",
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
                    "product_name",
                    models.CharField(
                        blank=True,
                        help_text="Snapshot of product name at time of count creation.",
                        max_length=255,
                    ),
                ),
                (
                    "product_unit",
                    models.CharField(
                        blank=True,
                        help_text="Snapshot of product unit at time of count creation.",
                        max_length=20,
                    ),
                ),
                (
                    "quantity_system",
                    models.DecimalField(
                        decimal_places=3,
                        help_text="Stock quantity at time of count creation (system value).",
                        max_digits=10,
                    ),
                ),
                (
                    "quantity_actual",
                    models.DecimalField(
                        blank=True,
                        decimal_places=3,
                        help_text="Physically counted quantity (filled by user).",
                        max_digits=10,
                        null=True,
                    ),
                ),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "inventory_count",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="inventory.inventorycount",
                    ),
                ),
                (
                    "product",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="inventory_count_items",
                        to="products.product",
                    ),
                ),
            ],
            options={
                "verbose_name": "Inventory count item",
                "verbose_name_plural": "Inventory count items",
                "ordering": ["product__name"],
            },
        ),
        migrations.AddConstraint(
            model_name="inventorycount",
            constraint=models.UniqueConstraint(
                fields=["company", "document_number"],
                name="inventory_count_company_document_number_uniq",
            ),
        ),
    ]
