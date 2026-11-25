from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0007_add_is_stock_production"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productionorder",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Szkic"),
                    ("in_progress", "W toku"),
                    ("completed", "Zakończone"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
    ]
