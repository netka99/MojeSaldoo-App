# Generated manually — company backfilled in 0003_add_company_fk

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0003_add_company_fk"),
    ]

    operations = [
        migrations.AlterField(
            model_name="customer",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
    ]
