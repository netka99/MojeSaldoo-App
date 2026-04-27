# Generated manually for MM / van loading without a sales order.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0002_deliveryitem"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deliverydocument",
            name="order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="delivery_documents",
                to="orders.order",
            ),
        ),
        migrations.AlterField(
            model_name="deliveryitem",
            name="order_item",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="delivery_items",
                to="orders.orderitem",
            ),
        ),
    ]
