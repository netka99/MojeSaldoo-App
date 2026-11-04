# Hand-written migration: replace implicit M2M through table with explicit
# ProductionOrderSource model that carries a `quantity` field.
#
# SQLite cannot ALTER a M2M field in-place, so we:
#   1. Create the new ProductionOrderSource table.
#   2. Copy existing rows from the old implicit through-table.
#   3. Drop the old implicit through-table.
#   4. Point the M2M field at the new through model (state-only).

from django.db import migrations, models
import django.db.models.deletion
import uuid


def copy_source_orders(apps, schema_editor):
    """Migrate existing M2M rows into ProductionOrderSource with quantity=0 (unknown)."""
    db = schema_editor.connection.alias
    # The old implicit through table is named production_productionorder_source_orders
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT productionorder_id, order_id "
            "FROM production_productionorder_source_orders"
        )
        rows = cursor.fetchall()

    ProductionOrderSource = apps.get_model("production", "ProductionOrderSource")
    for prod_id, order_id in rows:
        ProductionOrderSource.objects.using(db).get_or_create(
            production_order_id=prod_id,
            order_id=order_id,
            defaults={"quantity": 0},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0003_initial"),
        ("production", "0005_replace_source_order_fk_with_m2m"),
    ]

    operations = [
        # 1. Create new through table
        migrations.CreateModel(
            name="ProductionOrderSource",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("quantity", models.DecimalField(
                    decimal_places=2,
                    max_digits=10,
                    help_text="How many units of the finished product this production covers for this order.",
                )),
                ("order", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="production_source_links",
                    to="orders.order",
                )),
                ("production_order", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="source_links",
                    to="production.productionorder",
                )),
            ],
            options={
                "ordering": ["order__order_number"],
                "unique_together": {("production_order", "order")},
            },
        ),

        # 2. Copy existing rows from old implicit through-table
        migrations.RunPython(copy_source_orders, migrations.RunPython.noop),

        # 3. Drop old implicit through-table
        migrations.RunSQL(
            "DROP TABLE IF EXISTS production_productionorder_source_orders;",
            reverse_sql=migrations.RunSQL.noop,
        ),

        # 4. Update Django state only: M2M now uses the explicit through model
        # (no DB operation — old implicit table was dropped above, new one already created)
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name="productionorder",
                    name="source_orders",
                    field=models.ManyToManyField(
                        blank=True,
                        help_text="Optional: customer orders this production run fulfils (MTO).",
                        related_name="production_orders",
                        through="production.ProductionOrderSource",
                        to="orders.order",
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
