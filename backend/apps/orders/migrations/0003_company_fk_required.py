# Generated manually — company backfilled in 0002_add_company_fk

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0002_add_company_fk"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
    ]
