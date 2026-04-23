# Generated manually — company backfilled in 0007_add_company_fk

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0007_add_company_fk"),
    ]

    operations = [
        migrations.AlterField(
            model_name="product",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
        migrations.AlterField(
            model_name="productstock",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
        migrations.AlterField(
            model_name="stockbatch",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
        migrations.AlterField(
            model_name="stockmovement",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
        migrations.AlterField(
            model_name="warehouse",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                to="users.company",
            ),
        ),
    ]
