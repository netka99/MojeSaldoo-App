from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("purchase_documents", "0003_add_accounting_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchasedocument",
            name="line_categories",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
