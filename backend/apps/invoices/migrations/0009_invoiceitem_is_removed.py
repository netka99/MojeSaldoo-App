from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0008_add_fv_kor_wz_kor_corrections"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoiceitem",
            name="is_removed",
            field=models.BooleanField(
                default=False,
                help_text="True for correction lines that remove the original line entirely.",
            ),
        ),
    ]
