import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django; django.setup()

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.products.models import Product, Warehouse
from apps.users.models import Company
from datetime import date

company = Company.objects.get(id=6)
warehouse = Warehouse.objects.filter(company=company, code='MG').first()

# Delete old test PZ/2026/0002 if exists
DeliveryDocument.objects.filter(company=company, document_number='PZ/2026/0002').delete()

# Get or create products matching the invoice item names
p1, _ = Product.objects.get_or_create(
    company=company,
    name='SkroZiemPlonNat1kg',
    defaults={'unit': 'szt', 'vat_rate': '0.05'},
)
p2, _ = Product.objects.get_or_create(
    company=company,
    name='Olej Wyborny 1l',
    defaults={'unit': 'szt', 'vat_rate': '0.05'},
)

# Create PZ with matching products (partial — only some qty)
pz = DeliveryDocument.objects.create(
    company=company,
    document_type='PZ',
    status='draft',
    issue_date=date(2026, 8, 18),
    to_warehouse=warehouse,
    external_document_number='WZ/Biedronka/002',
    notes='Testowy PZ - dostawa czesciowa',
)

DeliveryItem.objects.create(
    delivery_document=pz,
    product=p1,
    quantity_planned=5,   # invoice has 9 — partial
    unit_cost='3.50',
)
DeliveryItem.objects.create(
    delivery_document=pz,
    product=p2,
    quantity_planned=4,   # invoice has 4 — pelna ilosc
    unit_cost='8.90',
)

sys.stdout.buffer.write(f"Created: {pz.document_number} (id={pz.id})\n".encode('utf-8'))
sys.stdout.buffer.write(f"  SkroZiemPlonNat1kg x5 (faktura ma 9 - czesc)\n".encode('utf-8'))
sys.stdout.buffer.write(f"  Olej Wyborny 1l x4 (faktura ma 4 - pelna ilosc)\n".encode('utf-8'))
sys.stdout.buffer.write(b"Done!\n")
