import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("ksef", "0005_ksefproductmapping"),
        ("users", "0007_add_company_workflow_settings"),
    ]

    operations = [
        migrations.CreateModel(
            name="CostProject",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255)),
                ("code", models.CharField(blank=True, max_length=20)),
                ("color", models.CharField(blank=True, max_length=7)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cost_projects",
                        to="users.company",
                    ),
                ),
            ],
            options={
                "verbose_name": "Cost project",
                "verbose_name_plural": "Cost projects",
                "ordering": ["name"],
            },
        ),
        migrations.AddConstraint(
            model_name="costproject",
            constraint=models.UniqueConstraint(
                fields=("company", "name"), name="unique_cost_project_per_company"
            ),
        ),
        migrations.CreateModel(
            name="InvoiceAnnotation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "accounting_status",
                    models.CharField(
                        choices=[
                            ("pending", "Do opisania"),
                            ("annotated", "Opisana"),
                            ("exported", "Wyeksportowana"),
                            ("booked", "Zaksięgowana"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("accounting_notes", models.TextField(blank=True)),
                ("exported_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "invoice",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="annotation",
                        to="ksef.receivedksefinvoice",
                    ),
                ),
            ],
            options={
                "verbose_name": "Invoice annotation",
                "verbose_name_plural": "Invoice annotations",
            },
        ),
        migrations.CreateModel(
            name="InvoiceLineAnnotation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("is_private", models.BooleanField(default=False)),
                ("note", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "line",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="annotation",
                        to="ksef.receivedksefinvoiceline",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="line_annotations",
                        to="cost_allocation.costproject",
                    ),
                ),
            ],
            options={
                "verbose_name": "Invoice line annotation",
                "verbose_name_plural": "Invoice line annotations",
            },
        ),
    ]
