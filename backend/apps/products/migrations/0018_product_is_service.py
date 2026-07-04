from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0017_add_price_type_to_customer_product_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="is_service",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "If True, this is a service (not a physical product). "
                    "Services skip warehouse/batch/stock tracking."
                ),
            ),
        ),
    ]
