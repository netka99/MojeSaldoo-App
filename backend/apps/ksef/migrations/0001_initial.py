import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("users", "0007_add_company_workflow_settings"),
    ]

    operations = [
        migrations.CreateModel(
            name="KSeFSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("session_cookies_json", models.TextField(default="{}")),
                ("access_valid_until", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ksef_session",
                        to="users.company",
                    ),
                ),
            ],
            options={
                "verbose_name": "KSeF session",
                "verbose_name_plural": "KSeF sessions",
            },
        ),
    ]
