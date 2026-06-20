from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ksef", "0008_ksef_consolidation"),
    ]

    operations = [
        migrations.AddField(
            model_name="ksefsentinvoice",
            name="upo_xml",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="ksefsentinvoice",
            name="upo_hash",
            field=models.CharField(blank=True, max_length=255, default=""),
            preserve_default=False,
        ),
    ]
