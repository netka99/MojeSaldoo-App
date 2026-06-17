from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ksef", "0005_ksefproductmapping"),
    ]

    operations = [
        migrations.AddField(
            model_name="receivedksefinvoice",
            name="due_date",
            field=models.DateField(
                blank=True,
                null=True,
                help_text="Payment due date, parsed from XML TerminyPlatnosci or set manually.",
            ),
        ),
        migrations.AddField(
            model_name="receivedksefinvoice",
            name="paid_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="receivedksefinvoice",
            name="is_paid",
            field=models.BooleanField(default=False),
        ),
    ]
