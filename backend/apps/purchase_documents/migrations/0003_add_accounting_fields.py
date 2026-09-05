from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("purchase_documents", "0002_add_is_paid_opex_category"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchasedocument",
            name="accounting_status",
            field=models.CharField(
                choices=[
                    ("pending", "Oczekuje"),
                    ("annotated", "Opisana"),
                    ("booked", "Zaksięgowana"),
                ],
                default="pending",
                help_text="Status księgowy dokumentu.",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="purchasedocument",
            name="accounting_notes",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Notatki dla księgowości (opis kosztów, MPK, itp.).",
            ),
        ),
    ]
