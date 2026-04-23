# Generated manually for Warehouse model

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("products", "0002_alter_product_options_alter_product_unique_together_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="Warehouse",
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
                    "code",
                    models.CharField(
                        help_text="Short code, e.g. MG, MV.",
                        max_length=10,
                        unique=True,
                    ),
                ),
                ("name", models.CharField(max_length=255)),
                (
                    "warehouse_type",
                    models.CharField(
                        choices=[
                            ("main", "Main"),
                            ("mobile", "Mobile"),
                            ("customer", "Customer"),
                            ("external", "External"),
                        ],
                        default="main",
                        max_length=20,
                    ),
                ),
                ("address", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("allow_negative_stock", models.BooleanField(default=False)),
                ("fifo_enabled", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="warehouses",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["code"],
            },
        ),
        migrations.AddIndex(
            model_name="warehouse",
            index=models.Index(fields=["user"], name="idx_warehouses_user"),
        ),
        migrations.AddIndex(
            model_name="warehouse",
            index=models.Index(fields=["code"], name="idx_warehouses_code"),
        ),
        migrations.AddIndex(
            model_name="warehouse",
            index=models.Index(fields=["warehouse_type"], name="idx_warehouses_type"),
        ),
    ]
