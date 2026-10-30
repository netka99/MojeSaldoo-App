from django.db import migrations, models


def forward(apps, schema_editor):
    Product = apps.get_model("products", "Product")
    Product.objects.filter(is_service=True).update(product_type="service")


class Migration(migrations.Migration):
    dependencies = [("products", "0019_product_image")]

    operations = [
        migrations.AddField(
            model_name="product",
            name="product_type",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("material", "Surowiec"),
                    ("finished", "Wyrób gotowy"),
                    ("trade", "Towar handlowy"),
                    ("service", "Usługa"),
                ],
                default="trade",
                help_text="Classification: material | finished | trade | service",
            ),
        ),
        migrations.RunPython(forward, reverse_code=migrations.RunPython.noop),
    ]
