from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0014_make_email_optional"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyrole",
            name="can_access_ksef_inbox",
            field=models.BooleanField(default=False, help_text="Odebrane faktury KSeF (przychodzące od dostawców)"),
        ),
        migrations.AddField(
            model_name="companyrole",
            name="can_manage_stock_moves",
            field=models.BooleanField(default=False, help_text="Przesunięcia magazynowe (MM)"),
        ),
    ]
