"""
Add RW (Rozchód Wewnętrzny) document type for internal write-offs / damage.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0005_add_from_supplier_and_unit_cost"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deliverydocument",
            name="document_type",
            field=models.CharField(
                max_length=2,
                choices=[
                    ("WZ", "Wydanie Zewnętrzne"),
                    ("MM", "Przesunięcie Międzymagazynowe"),
                    ("PZ", "Przyjęcie Zewnętrzne"),
                    ("ZW", "Zwrot Zewnętrzny"),
                    ("RW", "Rozchód Wewnętrzny"),
                ],
            ),
        ),
    ]
