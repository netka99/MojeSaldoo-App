from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0013_product_avg_cost"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="is_resalable",
            field=models.BooleanField(
                default=True,
                help_text="If True, the product can be sold to customers (appears in invoice/order pickers).",
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="markup_percent",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Target gross margin %. price_net is auto-suggested as avg_cost × (1 + markup/100).",
                max_digits=6,
                null=True,
            ),
        ),
    ]
