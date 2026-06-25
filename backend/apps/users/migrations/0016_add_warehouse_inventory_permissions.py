from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0015_add_ksef_inbox_stock_moves_permissions"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyrole",
            name="can_manage_warehouses",
            field=models.BooleanField(
                default=False,
                help_text="Magazyny — przeglądanie i zarządzanie magazynami",
            ),
        ),
        migrations.AddField(
            model_name="companyrole",
            name="can_manage_inventory",
            field=models.BooleanField(
                default=False,
                help_text="Inwentaryzacja — tworzenie i zamykanie dokumentów INW",
            ),
        ),
    ]
