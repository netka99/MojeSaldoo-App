"""
Add ZW (Zwrot Zewnętrzny) document type and linked_wz self-FK for return document audit trail.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0003_mm_without_order"),
    ]

    operations = [
        # Extend document_type choices to include ZW
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
                ],
            ),
        ),
        # Self-FK: ZW documents know which WZ they were generated from
        migrations.AddField(
            model_name="deliverydocument",
            name="linked_wz",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="return_documents",
                to="delivery.deliverydocument",
                help_text="For ZW documents: the WZ that triggered this return.",
            ),
        ),
    ]
