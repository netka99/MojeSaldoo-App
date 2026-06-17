from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("delivery", "0010_ksef_invoice_link"),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverydocument",
            name="external_document_number",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Nr dokumentu dostawcy (WZ/list przewozowy) — wypełniany ręcznie przy PZ.",
                max_length=100,
            ),
        ),
    ]
