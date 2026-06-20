from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("ksef", "0007_opex_category"),
        ("users", "0009_track_supplier_payments"),
    ]

    operations = [
        # Add token fields to KSeFSession
        migrations.AddField(
            model_name="ksefsession",
            name="access_token_body",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="ksefsession",
            name="refresh_token_body",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="ksefsession",
            name="refresh_valid_until",
            field=models.DateTimeField(blank=True, null=True),
        ),
        # New model: KSeFSentInvoice
        migrations.CreateModel(
            name="KSeFSentInvoice",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("reference_number", models.CharField(max_length=255, unique=True)),
                ("session_reference_number", models.CharField(max_length=255)),
                ("invoice_hash", models.CharField(blank=True, max_length=255)),
                ("issue_date", models.CharField(blank=True, max_length=20)),
                ("shop", models.CharField(blank=True, max_length=255)),
                ("total_gross_cents", models.IntegerField(blank=True, null=True)),
                ("ksef_number", models.CharField(blank=True, max_length=255)),
                ("invoice_number", models.CharField(blank=True, max_length=255)),
                ("status_code", models.IntegerField(blank=True, null=True)),
                ("status_description", models.CharField(blank=True, max_length=512)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ksef_sent_invoices",
                        to="users.company",
                    ),
                ),
            ],
            options={
                "verbose_name": "KSeF sent invoice",
                "verbose_name_plural": "KSeF sent invoices",
                "ordering": ["-created_at"],
            },
        ),
    ]
