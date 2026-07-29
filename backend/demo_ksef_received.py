# -*- coding: utf-8 -*-
"""
Demo: odebrane faktury KSeF (ReceivedKSeFInvoice) dla Firma Piekarnia (id=6)
3 zaplacone (PZ juz bylo) + 3 nowe bez PZ (do prezentacji flow +PZ)
"""

from decimal import Decimal
from datetime import date, timedelta
from django.utils import timezone

from apps.users.models import Company
from apps.ksef.models import ReceivedKSeFInvoice, ReceivedKSeFInvoiceLine, KSeFProductMapping
from apps.products.models import Product

company = Company.objects.get(id=6)

maka_pszenna = Product.objects.get(company=company, name='Maka pszenna typ 550')
maka_zytnia  = Product.objects.get(company=company, name='Maka zytnia typ 720')
drozdze      = Product.objects.get(company=company, name='Drozdzee swieze')
maslo        = Product.objects.get(company=company, name='Maslo 82%')
jajka        = Product.objects.get(company=company, name='Jajka L')
mak          = Product.objects.get(company=company, name='Mak niebieski')
rodzynki     = Product.objects.get(company=company, name='Rodzynki')
opakowania   = Product.objects.get(company=company, name='Torebki papierowe 25cm')

BUYER_NIP  = '5265999999'
BUYER_NAME = 'Firma Piekarnia'

def make_received(ksef_num, inv_num, seller_nip, seller_name, seller_addr, issue_day, lines_data, paid=False):
    issue_date = date(2026, 7, issue_day)
    due_date   = issue_date + timedelta(days=14)

    total_net   = Decimal('0')
    total_gross = Decimal('0')
    for _, qty, price, vat in lines_data:
        net   = Decimal(str(qty)) * Decimal(str(price))
        gross = round(net * (1 + Decimal(str(vat)) / 100), 2)
        total_net   += net
        total_gross += gross

    vat_amount = total_gross - total_net

    inv, created = ReceivedKSeFInvoice.objects.get_or_create(
        company=company, ksef_number=ksef_num,
        defaults=dict(
            invoice_number=inv_num,
            issue_date=issue_date,
            invoicing_date=issue_date,
            seller_nip=seller_nip,
            seller_name=seller_name,
            seller_address_l1=seller_addr,
            seller_country='PL',
            buyer_nip=BUYER_NIP,
            buyer_name=BUYER_NAME,
            net_amount=total_net,
            gross_amount=total_gross,
            vat_amount=vat_amount,
            currency='PLN',
            invoice_type='VAT',
            due_date=due_date,
            is_paid=paid,
            first_seen_at=timezone.now(),
            last_synced_at=timezone.now(),
        )
    )
    if created:
        for pos, (name, qty, price, vat) in enumerate(lines_data, start=1):
            ReceivedKSeFInvoiceLine.objects.create(
                invoice=inv, position=pos,
                name=name, unit='kg',
                quantity=Decimal(str(qty)),
                unit_net_price=Decimal(str(price)),
                vat_rate=vat,
                line_net=round(Decimal(str(qty)) * Decimal(str(price)), 2),
            )
    return inv, created


# ── Faktury zaplacone (PZ juz bylo) ───────────────────────────────────────────

make_received(
    '2026070100123456789000000001', 'FV/2026/06/0234',
    '5261234567', 'Mlyny Polskie Sp. z o.o.', 'ul. Mlynarska 12, 01-205 Warszawa',
    issue_day=2,
    lines_data=[
        ('Maka pszenna typ 550 25kg', 200, 1.89, 8),
        ('Maka zytnia typ 720 25kg',  100, 2.10, 8),
    ],
    paid=True
)

make_received(
    '2026071000123456789000000002', 'FV/2026/07/0089',
    '5261234567', 'Mlyny Polskie Sp. z o.o.', 'ul. Mlynarska 12, 01-205 Warszawa',
    issue_day=10,
    lines_data=[
        ('Maka pszenna typ 550 25kg', 150, 1.89, 8),
        ('Maka zytnia typ 720 25kg',   80, 2.10, 8),
    ],
    paid=True
)

make_received(
    '2026071200123456789000000003', 'PD/FV/2026/0412',
    '5269876543', 'PiekarDodatki Hurtownia', 'ul. Piekarska 45, 90-001 Lodz',
    issue_day=12,
    lines_data=[
        ('Drozdzee swieze 1kg',  20, 8.50,  5),
        ('Maslo ekstra 82% 1kg', 40, 24.00, 8),
        ('Jajka L szt.',        600,  0.65, 5),
    ],
    paid=True
)

# ── Faktury NOWE — bez PZ, do prezentacji demo ────────────────────────────────

inv4, _ = make_received(
    '2026072000123456789000000004', 'FV/2026/07/0156',
    '5261234567', 'Mlyny Polskie Sp. z o.o.', 'ul. Mlynarska 12, 01-205 Warszawa',
    issue_day=20,
    lines_data=[
        ('Maka pszenna typ 550 25kg', 200, 1.92, 8),
        ('Maka zytnia typ 720 25kg',  100, 2.15, 8),
    ],
    paid=False
)

inv5, _ = make_received(
    '2026072400123456789000000005', 'PD/FV/2026/0534',
    '5269876543', 'PiekarDodatki Hurtownia', 'ul. Piekarska 45, 90-001 Lodz',
    issue_day=24,
    lines_data=[
        ('Drozdzee swieze 1kg',  15, 8.50,  5),
        ('Maslo ekstra 82% 1kg', 30, 24.50, 8),
        ('Jajka L szt.',        400,  0.68, 5),
        ('Mak niebieski 1kg',    20, 14.00, 8),
        ('Rodzynki 1kg',         15, 18.50, 8),
    ],
    paid=False
)

inv6, _ = make_received(
    '2026072500123456789000000006', 'OPK/FV/2026/0892',
    '5270000001', 'Opakowania Premium Sp. z o.o.', 'ul. Fabryczna 8, 15-001 Bialystok',
    issue_day=25,
    lines_data=[
        ('Torebki papierowe 25cm op.100szt.', 5000, 0.08, 23),
    ],
    paid=False
)

# ── KSeFProductMapping — podpowiedzi produktow przy tworzeniu PZ ──────────────

mappings = [
    ('5261234567', 'Maka pszenna typ 550 25kg',          maka_pszenna),
    ('5261234567', 'Maka zytnia typ 720 25kg',           maka_zytnia),
    ('5269876543', 'Drozdzee swieze 1kg',                drozdze),
    ('5269876543', 'Maslo ekstra 82% 1kg',               maslo),
    ('5269876543', 'Jajka L szt.',                       jajka),
    ('5269876543', 'Mak niebieski 1kg',                  mak),
    ('5269876543', 'Rodzynki 1kg',                       rodzynki),
    ('5270000001', 'Torebki papierowe 25cm op.100szt.',  opakowania),
]
for seller_nip, line_name, product in mappings:
    KSeFProductMapping.objects.get_or_create(
        company=company, seller_nip=seller_nip, invoice_line_name=line_name,
        defaults=dict(product=product)
    )

# ── Podsumowanie ───────────────────────────────────────────────────────────────

print()
print('=' * 55)
print('ODEBRANE FAKTURY KSEF')
print('=' * 55)
all_inv = ReceivedKSeFInvoice.objects.filter(company=company)
paid    = all_inv.filter(is_paid=True)
pending = all_inv.filter(is_paid=False)
print(f'  Razem:             {all_inv.count()}')
print(f'  Zaplacone:         {paid.count()}  (historia)')
print(f'  Oczekujace na PZ:  {pending.count()}  <-- demo tutaj')
print()
print('  Do prezentacji +PZ:')
for inv in pending.order_by('issue_date'):
    lines = inv.lines.count()
    print(f'    {inv.invoice_number:<22} | {inv.seller_name:<35} | {inv.gross_amount:>10} PLN | {lines} pozycje')
print('=' * 55)
