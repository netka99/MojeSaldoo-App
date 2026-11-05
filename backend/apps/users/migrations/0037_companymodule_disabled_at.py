from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0036_add_production_complete_immediately"),
    ]

    operations = [
        migrations.AddField(
            model_name="companymodule",
            name="disabled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
