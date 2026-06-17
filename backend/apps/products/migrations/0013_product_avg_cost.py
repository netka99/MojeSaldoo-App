from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0012_translate_stock_movement_notes"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="avg_cost",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Weighted average purchase cost per unit, updated on each PZ receipt.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="last_cost",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Unit cost from the most recent PZ receipt.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="avg_cost_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
