from decimal import Decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0004_unit_price_4dp"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="quantity_produced",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text="Total quantity produced via completed production orders (PRD).",
                max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal("0"))],
            ),
        ),
    ]
