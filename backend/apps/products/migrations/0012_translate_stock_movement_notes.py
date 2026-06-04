from django.db import migrations


TRANSLATIONS = {
    "Van loading (MM out)": "Załadunek MM — wydanie z magazynu",
    "Van loading (MM in)": "Załadunek MM — przyjęcie na van",
    "MM-P van → MG": "MM-P — zwrot z vana do magazynu",
    "Van delivery — release main warehouse reservation": "Zwolnienie rezerwacji MG po wydaniu z vana",
    "Van delivery - release main warehouse reservation": "Zwolnienie rezerwacji MG po wydaniu z vana",
    "Van delivery - release main warehouse reservation (retroactive fix)": "Zwolnienie rezerwacji MG po wydaniu z vana",
}


def translate_notes(apps, schema_editor):
    StockMovement = apps.get_model("products", "StockMovement")
    for english, polish in TRANSLATIONS.items():
        StockMovement.objects.filter(notes=english).update(notes=polish)


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0011_add_product_pkwiu"),
    ]

    operations = [
        migrations.RunPython(translate_notes, migrations.RunPython.noop),
    ]
