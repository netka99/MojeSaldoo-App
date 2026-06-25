from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0016_add_warehouse_inventory_permissions"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyrole",
            name="can_manage_accounting",
            field=models.BooleanField(
                default=False,
                help_text="Adnotacje kosztowe — dostęp do opisywania faktur i projektów kosztowych",
            ),
        ),
    ]
