from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('delivery', '0014_add_fv_kor_wz_kor_corrections'),
    ]

    operations = [
        migrations.AddField(
            model_name='deliveryitem',
            name='batch_number',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Numer partii dostawcy — jeśli podany, zastępuje auto-generowany numer przy przyjęciu PZ.',
                max_length=100,
            ),
        ),
    ]
