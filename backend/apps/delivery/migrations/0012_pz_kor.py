import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0011_external_document_number"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deliverydocument",
            name="document_type",
            field=models.CharField(
                choices=[
                    ("WZ", "Wydanie Zewnętrzne"),
                    ("MM", "Przesunięcie Międzymagazynowe"),
                    ("PZ", "Przyjęcie Zewnętrzne"),
                    ("ZW", "Zwrot Zewnętrzny"),
                    ("RW", "Rozchód Wewnętrzny"),
                    ("PZ-KOR", "Korekta Przyjęcia Zewnętrznego"),
                ],
                max_length=6,
            ),
        ),
        migrations.AddField(
            model_name="deliverydocument",
            name="corrects_pz",
            field=models.ForeignKey(
                blank=True,
                help_text="For PZ-KOR: the original PZ this document corrects.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="corrections",
                to="delivery.deliverydocument",
            ),
        ),
    ]
