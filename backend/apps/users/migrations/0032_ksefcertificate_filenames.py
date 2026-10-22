from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0031_ksef_certificate_per_environment"),
    ]

    operations = [
        migrations.AddField(
            model_name="ksefcertificate",
            name="certificate_filename",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="ksefcertificate",
            name="key_filename",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
