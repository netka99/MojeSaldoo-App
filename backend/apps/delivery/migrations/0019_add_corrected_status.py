from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0018_add_source_supplier_order_to_pz"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deliverydocument",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("saved", "Saved"),
                    ("in_transit", "In Transit"),
                    ("delivered", "Delivered"),
                    ("cancelled", "Cancelled"),
                    ("corrected", "Corrected"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
    ]
