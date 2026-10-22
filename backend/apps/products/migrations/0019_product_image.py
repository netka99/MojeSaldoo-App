from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0018_product_is_service"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="image",
            field=models.ImageField(
                blank=True,
                help_text="Square JPEG thumbnail. The original upload is not stored.",
                null=True,
                upload_to="product_thumbs/",
            ),
        ),
    ]
