from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ksef", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="receivedksefinvoice",
            name="original_ksef_number",
            field=models.CharField(
                blank=True,
                default="",
                max_length=255,
                help_text=(
                    "For KOR/KOR_ZAL/KOR_ROZ invoices — the KSeF number of the "
                    "original invoice being corrected (Fa/DaneFaKorygowanej/NrKSeFFaKorygowanej)."
                ),
            ),
            preserve_default=False,
        ),
    ]
