from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0017_add_accounting_permission"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
