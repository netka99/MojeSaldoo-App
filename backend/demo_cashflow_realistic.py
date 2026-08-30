# -*- coding: utf-8 -*-
"""
Demo: realistyczne dane Cash Flow dla Firma Piekarnia (id=6)
Obejmuje lipiec i sierpien 2026.

Dodaje:
  - DailyB2CRevenue  (sprzedaz detaliczna przy lady)
  - QuickExpense     (wydatki gotowkowe / paragony)
  - B2B faktury dla sierpnia 2026
  - ReceivedKSeFInvoice z opex_category (faktury od dostawcow sierpien)
  - Opex_category na istniejacych fakturach KSeF z lipca
  - CompanyTaxConfig — realistyczne salda kasy i konta

Run:
  cd backend
  python -c "
  import io,sys; sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
  import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
  import django; django.setup()
  exec(open('demo_cashflow_realistic.py',encoding='utf-8').read())
  "
"""

import random
from decimal import Decimal
from datetime import date, timedelta, datetime, time
from django.utils import timezone
import pytz

from apps.users.models import Company
from apps.customers.models import Customer
from apps.products.models import Product
from apps.orders.models import Order, OrderItem
from apps.invoices.models import Invoice, InvoiceItem
from apps.ksef.models import ReceivedKSeFInvoice, ReceivedKSeFInvoiceLine
from apps.cash_flow.models import DailyB2CRevenue, QuickExpense, CompanyTaxConfig

tz = pytz.timezone('Europe/Warsaw')

company = Company.objects.get(id=6)
user = company.memberships.first().user

print(f"Company: {company.name} (id={company.id})")
print(f"User: {user.email}")

# ── Produkty (juz istnieja) ───────────────────────────────────────────────────

chleb_pszenny = Product.objects.get(company=company, name='Chleb pszenny 800g')
chleb_zytni   = Product.objects.get(company=company, name='Chleb zytni 700g')
bulka_pszenna = Product.objects.get(company=company, name='Bulka pszenna 100g')
rogal         = Product.objects.get(company=company, name='Rogal maslany 120g')
makowiec      = Product.objects.get(company=company, name='Makowiec 500g')
chalka        = Product.objects.get(company=company, name='Chalka z rodzynkami 400g')

# ── Klienci (juz istnieja) ────────────────────────────────────────────────────

k_galeria    = Customer.objects.get(company=company, nip='5261111111')
k_osiedlowy  = Customer.objects.get(company=company, nip='5262222222')
k_kawiarnia  = Customer.objects.get(company=company, nip='5263333333')
k_delikatesy = Customer.objects.get(company=company, nip='5264444444')
k_hotel      = Customer.objects.get(company=company, nip='5265555555')

# ── 1. KONFIGURACJA PODATKOWA ─────────────────────────────────────────────────

config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
config.tax_form = 'kpir_linear'
config.tax_rate = Decimal('19.00')
config.vat_payer = True
config.vat_method = 'memoriałowa'
config.vat_due_day = 25
config.zus_due_day = 20
config.zus_status = 'pelny_zus'
config.has_sick_insurance = False
config.cash_balance = Decimal('1250.00')
config.bank_balance = Decimal('22480.00')
config.balance_updated_at = tz.localize(datetime(2026, 8, 28, 9, 15, 0))
config.save()
print("OK Tax config")

# ── 2. FAKTURY LIPIEC — oznacz zalegajace jako overdue ────────────────────────

# Faktury z konca lipca (zaplacone=False, termin 14/30 dni) — teraz sa po terminie
overdue_invoices = Invoice.objects.filter(
    company=company,
    status='sent',
    due_date__lt=date(2026, 8, 30),
)
updated = overdue_invoices.update(status='overdue')
print(f"OK Marked {updated} July invoices as overdue")

# ── 3. FAKTURY SIERPIEN — nowe zamowienia i faktury ──────────────────────────

ord_counter = [Invoice.objects.filter(company=company).count() + 100]
inv_counter = [Invoice.objects.filter(company=company).count() + 100]

def make_aug_invoice(customer, day, items, paid=True, paid_day_offset=5):
    order_date = date(2026, 8, day)
    issue_date = order_date + timedelta(days=1)
    payment_terms = customer.payment_terms or 14
    due_date = issue_date + timedelta(days=payment_terms)

    total_net   = Decimal('0')
    total_gross = Decimal('0')
    item_rows   = []
    for product, qty in items:
        vat = product.vat_rate or 5
        line_net   = product.price_net * Decimal(str(qty))
        line_gross = round(line_net * (1 + Decimal(str(vat)) / 100), 2)
        total_net   += line_net
        total_gross += line_gross
        item_rows.append((product, qty, vat, line_net, line_gross))

    ord_num = f'ZAM/2026/{ord_counter[0]:04d}'
    ord_counter[0] += 1

    order = Order.objects.create(
        company=company, user=user, customer=customer,
        order_number=ord_num, order_date=order_date,
        delivery_date=order_date + timedelta(days=1),
        status='delivered',
        subtotal_net=total_net, subtotal_gross=total_gross,
        total_net=total_net, total_gross=total_gross,
    )
    for product, qty, vat, line_net, line_gross in item_rows:
        OrderItem.objects.create(
            order=order, product=product,
            product_name=product.name, product_unit=product.unit,
            quantity=Decimal(str(qty)),
            unit_price_net=product.price_net,
            unit_price_gross=product.price_gross,
            vat_rate=vat,
            line_total_net=line_net, line_total_gross=line_gross,
        )

    inv_num = f'FV/2026/{inv_counter[0]:04d}'
    inv_counter[0] += 1

    paid_at = None
    inv_status = 'sent'
    if paid:
        paid_dt = datetime.combine(issue_date + timedelta(days=paid_day_offset), time(10, 0, 0))
        paid_at = tz.localize(paid_dt)
        inv_status = 'paid'

    Invoice.objects.create(
        company=company, user=user,
        order=order, customer=customer,
        invoice_number=inv_num,
        issue_date=issue_date, sale_date=issue_date, due_date=due_date,
        payment_method='transfer',
        subtotal_net=total_net, subtotal_gross=total_gross,
        vat_amount=total_gross - total_net,
        total_gross=total_gross,
        status=inv_status,
        paid_at=paid_at,
        ksef_status='sent',
    )

# Tydzien 1 sierpien (4-8)
make_aug_invoice(k_galeria,    4, [(chleb_pszenny,22),(chleb_zytni,10),(bulka_pszenna,90),(rogal,28)], paid=True, paid_day_offset=4)
make_aug_invoice(k_osiedlowy,  5, [(chleb_pszenny,14),(bulka_pszenna,55),(makowiec,4)], paid=True, paid_day_offset=5)
make_aug_invoice(k_kawiarnia,  6, [(bulka_pszenna,38),(rogal,18),(chalka,7)], paid=True, paid_day_offset=6)
make_aug_invoice(k_delikatesy, 6, [(chleb_pszenny,55),(chleb_zytni,22),(bulka_pszenna,220),(rogal,45)], paid=True, paid_day_offset=8)
make_aug_invoice(k_hotel,      7, [(chleb_pszenny,11),(bulka_pszenna,48),(rogal,18),(chalka,6)], paid=True, paid_day_offset=7)

# Tydzien 2 sierpien (11-15)
make_aug_invoice(k_galeria,   11, [(chleb_pszenny,20),(chleb_zytni,10),(bulka_pszenna,80),(chalka,8)], paid=True, paid_day_offset=5)
make_aug_invoice(k_osiedlowy, 12, [(chleb_pszenny,12),(bulka_pszenna,50),(rogal,15)], paid=True, paid_day_offset=5)
make_aug_invoice(k_kawiarnia, 13, [(bulka_pszenna,40),(rogal,20),(makowiec,5)], paid=True, paid_day_offset=4)
make_aug_invoice(k_delikatesy,13, [(chleb_pszenny,60),(chleb_zytni,24),(bulka_pszenna,240),(rogal,48),(makowiec,10)], paid=True, paid_day_offset=8)
make_aug_invoice(k_hotel,     14, [(chleb_pszenny,12),(bulka_pszenna,56),(chalka,7)], paid=True, paid_day_offset=6)

# Tydzien 3 sierpien (18-22)
make_aug_invoice(k_galeria,   18, [(chleb_pszenny,24),(chleb_zytni,11),(bulka_pszenna,95),(rogal,30),(chalka,6)], paid=True, paid_day_offset=5)
make_aug_invoice(k_osiedlowy, 19, [(chleb_pszenny,14),(bulka_pszenna,58)], paid=True, paid_day_offset=5)
make_aug_invoice(k_kawiarnia, 20, [(bulka_pszenna,42),(rogal,19),(chalka,8)], paid=True, paid_day_offset=4)
make_aug_invoice(k_delikatesy,20, [(chleb_pszenny,52),(chleb_zytni,20),(bulka_pszenna,195),(makowiec,8)], paid=False)  # platnosc 30 dni, bedzie wrzesien
make_aug_invoice(k_hotel,     21, [(chleb_pszenny,10),(bulka_pszenna,50),(chalka,6)], paid=False)  # platnosc 30 dni

# Tydzien 4 sierpien (25-29) — swiezo wystawione, jeszcze nie zaplacone
make_aug_invoice(k_galeria,   25, [(chleb_pszenny,22),(chleb_zytni,10),(bulka_pszenna,88),(rogal,25)], paid=False)
make_aug_invoice(k_osiedlowy, 26, [(chleb_pszenny,12),(bulka_pszenna,50),(rogal,14)], paid=False)
make_aug_invoice(k_kawiarnia, 27, [(bulka_pszenna,38),(rogal,18),(chalka,5)], paid=False)
make_aug_invoice(k_delikatesy,27, [(chleb_pszenny,42),(chleb_zytni,18),(bulka_pszenna,160)], paid=False)
make_aug_invoice(k_hotel,     28, [(chleb_pszenny,10),(bulka_pszenna,48),(rogal,18),(chalka,5)], paid=False)

print("OK August B2B invoices")

# ── 4. DAILY B2C REVENUE — sprzedaz przy lady ─────────────────────────────────

# Piekarnia otwarta pn-sob; niedziele zamkniete
# B2C: pieczywo (VAT 5%) — kwoty brutto

b2c_schedule = {
    0: (320, 420),   # poniedzialek
    1: (340, 430),   # wtorek
    2: (310, 400),   # sroda
    3: (320, 415),   # czwartek
    4: (380, 490),   # piatek (przed weekendem)
    5: (650, 820),   # sobota (szczyt)
    6: None,         # niedziela — zamkniete
}

def add_b2c(d, amount_gross, notes=''):
    if DailyB2CRevenue.objects.filter(company=company, date=d).exists():
        return
    DailyB2CRevenue.objects.create(
        company=company, date=d,
        amount=Decimal(str(amount_gross)),
        vat_included=True,
        vat_rate=Decimal('5.00'),
        notes=notes,
        sale_type='manual',
    )

random.seed(42)  # powtarzalne wyniki

# Lipiec 2026 (1-27, bo 27 to ostatni dzien demo danych)
for day in range(1, 28):
    d = date(2026, 7, day)
    wd = d.weekday()
    if b2c_schedule[wd] is None:
        continue
    lo, hi = b2c_schedule[wd]
    amount = random.randint(lo, hi)
    # weekend 4-6 lipca i 11-13 i 18-20 i 25-27 lekko wyzsze
    if day in (4, 5, 11, 12, 18, 19, 25, 26):
        amount = int(amount * 1.12)
    add_b2c(d, amount)

# Sierpien 2026 (1-30)
for day in range(1, 31):
    d = date(2026, 8, day)
    wd = d.weekday()
    if b2c_schedule[wd] is None:
        continue
    lo, hi = b2c_schedule[wd]
    # Sierpien troche wyzszy (wakacje, turysci)
    lo_aug = int(lo * 1.08)
    hi_aug = int(hi * 1.08)
    amount = random.randint(lo_aug, hi_aug)
    # Weekendy 1-2, 8-9, 15-16, 22-23, 29-30
    if d.weekday() == 5:  # sobota
        amount = int(amount * 1.15)
    add_b2c(d, amount)

print(f"OK B2C revenue: {DailyB2CRevenue.objects.filter(company=company).count()} entries")

# ── 5. QUICK EXPENSES ─────────────────────────────────────────────────────────

def add_expense(d, amount, category, vendor, doc_type='paragon', has_vat=False, notes=''):
    QuickExpense.objects.get_or_create(
        company=company,
        date=d,
        vendor=vendor,
        amount=Decimal(str(amount)),
        defaults=dict(
            amount_net=Decimal(str(round(amount / 1.23, 2))) if has_vat else None,
            vat_rate='23' if has_vat else '',
            category=category,
            cost_type='indirect',
            has_vat=has_vat,
            document_type=doc_type,
            notes=notes,
        )
    )

# ── Lipiec 2026 ──

# Paliwo do dostawczaka (co ok. 10 dni)
add_expense(date(2026, 7,  3), 285.00, 'fuel', 'BP Stacja al. Jerozolimskie', 'paragon')
add_expense(date(2026, 7, 14), 292.00, 'fuel', 'BP Stacja al. Jerozolimskie', 'paragon')
add_expense(date(2026, 7, 24), 278.00, 'fuel', 'Orlen ul. Pulawska',          'paragon')

# Opakowania doraźne (paragony)
add_expense(date(2026, 7,  8), 148.00, 'packaging', 'Biuro Plus ul. Marszalkowska', 'paragon')
add_expense(date(2026, 7, 21), 162.00, 'packaging', 'Biuro Plus ul. Marszalkowska', 'paragon')

# Drobne naprawy / serwis
add_expense(date(2026, 7, 15), 320.00, 'repair', 'Serwis Sprzetu Gastronomicznego Jan Kowalski', 'faktura_vat', has_vat=True, notes='Wymiana uszczelki pieca')

# Marketing (ulotki)
add_expense(date(2026, 7,  5), 195.00, 'marketing', 'Drukarnia Ekspres', 'faktura_vat', has_vat=True, notes='Ulotki reklamowe 500 szt.')

# Inne (srodki czyszczace, BHP)
add_expense(date(2026, 7, 10), 87.00,  'other', 'Selgros Cash&Carry', 'paragon', notes='Srodki czystosci BHP')
add_expense(date(2026, 7, 22), 74.00,  'other', 'Castorama',           'paragon', notes='Zarowki LED do sali')

# ── Sierpien 2026 ──

# Paliwo
add_expense(date(2026, 8,  4), 289.00, 'fuel', 'BP Stacja al. Jerozolimskie', 'paragon')
add_expense(date(2026, 8, 14), 295.00, 'fuel', 'BP Stacja al. Jerozolimskie', 'paragon')
add_expense(date(2026, 8, 25), 283.00, 'fuel', 'Orlen ul. Pulawska',          'paragon')

# Opakowania (wiklinowe koszyczki na stoisku, papier)
add_expense(date(2026, 8,  7), 168.00, 'packaging', 'Biuro Plus ul. Marszalkowska', 'paragon')
add_expense(date(2026, 8, 20), 145.00, 'packaging', 'Biuro Plus ul. Marszalkowska', 'paragon')

# Transport — dwa dodatkowe dowozy w sierpniu (wakacje, wieksze zamowienia hotelu)
add_expense(date(2026, 8,  9), 180.00, 'transport', 'Inpost / wlasny transport', 'paragon', notes='Dodatkowy dowoz Hotel Mazowiecki')
add_expense(date(2026, 8, 16), 180.00, 'transport', 'Inpost / wlasny transport', 'paragon', notes='Dodatkowy dowoz Hotel Mazowiecki')

# Naprawa — agregat chlodniczy zepsul sie w sierpniu
add_expense(date(2026, 8, 12), 850.00, 'repair', 'Chlodnictwo Nowak Serwis', 'faktura_vat', has_vat=True, notes='Naprawa agregatu chlodniczego')

# Media — nadplacony rachunek za wode (poza czynsem)
add_expense(date(2026, 8, 19), 210.00, 'utilities', 'MPWiK Warszawa', 'faktura_vat', has_vat=False, notes='Woda i scieki sierpien')

# Inne
add_expense(date(2026, 8,  6), 92.00,  'other', 'Selgros Cash&Carry', 'paragon', notes='Srodki czystosci BHP')
add_expense(date(2026, 8, 27), 115.00, 'other', 'Allegro.pl',         'faktura_pdf', has_vat=True, notes='Pojemniki na pieczywo plastikowe')

print(f"OK Quick expenses: {QuickExpense.objects.filter(company=company).count()} entries")

# ── 6. FAKTURY KSEF — opex_category na istniejacych fakturach z LIPCA ─────────

# Maka (raw_materials)
for ksef_num in [
    '2026070100123456789000000001',
    '2026071000123456789000000002',
    '2026072000123456789000000004',
]:
    ReceivedKSeFInvoice.objects.filter(
        company=company, ksef_number=ksef_num
    ).update(opex_category='raw_materials')

# Dodatki do pieczenia (raw_materials)
for ksef_num in [
    '2026071200123456789000000003',
    '2026072400123456789000000005',
]:
    ReceivedKSeFInvoice.objects.filter(
        company=company, ksef_number=ksef_num
    ).update(opex_category='raw_materials')

# Opakowania
ReceivedKSeFInvoice.objects.filter(
    company=company, ksef_number='2026072500123456789000000006'
).update(opex_category='packaging')

print("OK July KSeF opex_category set")

# ── 7. FAKTURY KSEF SIERPIEN — nowe dostawy surowcow ─────────────────────────

BUYER_NIP  = company.nip or '5265999999'
BUYER_NAME = company.name

def make_ksef(ksef_num, inv_num, seller_nip, seller_name, seller_addr,
              issue_date, lines_data, paid=False, opex_cat='raw_materials'):
    due_date = issue_date + timedelta(days=14)
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
            opex_category=opex_cat,
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
    if not created:
        # Upewnij sie ze opex_category jest ustawiona
        if not inv.opex_category:
            inv.opex_category = opex_cat
            inv.save(update_fields=['opex_category'])
    return inv

# Dostawy sierpien — maka (2 dostawy)
make_ksef(
    '2026080300123456789000000007', 'FV/2026/08/0278',
    '5261234567', 'Mlyny Polskie Sp. z o.o.', 'ul. Mlynarska 12, 01-205 Warszawa',
    date(2026, 8, 3),
    [
        ('Maka pszenna typ 550 25kg', 180, 1.92, 8),
        ('Maka zytnia typ 720 25kg',   90, 2.15, 8),
    ],
    paid=True, opex_cat='raw_materials'
)

make_ksef(
    '2026081800123456789000000008', 'FV/2026/08/0341',
    '5261234567', 'Mlyny Polskie Sp. z o.o.', 'ul. Mlynarska 12, 01-205 Warszawa',
    date(2026, 8, 18),
    [
        ('Maka pszenna typ 550 25kg', 160, 1.92, 8),
        ('Maka zytnia typ 720 25kg',   80, 2.15, 8),
    ],
    paid=True, opex_cat='raw_materials'
)

# Dostawa — dodatki (maslo, jajka, drozdzee, mak)
make_ksef(
    '2026080600123456789000000009', 'PD/FV/2026/0612',
    '5269876543', 'PiekarDodatki Hurtownia', 'ul. Piekarska 45, 90-001 Lodz',
    date(2026, 8, 6),
    [
        ('Drozdzee swieze 1kg',   18, 8.50,  5),
        ('Maslo ekstra 82% 1kg',  38, 24.50, 8),
        ('Jajka L szt.',         550,  0.68, 5),
        ('Mak niebieski 1kg',     22, 14.20, 8),
        ('Rodzynki 1kg',          16, 18.80, 8),
    ],
    paid=True, opex_cat='raw_materials'
)

make_ksef(
    '2026082200123456789000000010', 'PD/FV/2026/0701',
    '5269876543', 'PiekarDodatki Hurtownia', 'ul. Piekarska 45, 90-001 Lodz',
    date(2026, 8, 22),
    [
        ('Drozdzee swieze 1kg',   16, 8.60,  5),
        ('Maslo ekstra 82% 1kg',  35, 24.50, 8),
        ('Jajka L szt.',         500,  0.68, 5),
        ('Mak niebieski 1kg',     18, 14.20, 8),
    ],
    paid=False, opex_cat='raw_materials'
)

# Opakowania sierpien
make_ksef(
    '2026081500123456789000000011', 'OPK/FV/2026/1045',
    '5270000001', 'Opakowania Premium Sp. z o.o.', 'ul. Fabryczna 8, 15-001 Bialystok',
    date(2026, 8, 15),
    [
        ('Torebki papierowe 25cm op.100szt.', 4000, 0.08, 23),
        ('Torby papierowe z uchwytem 30cm',   1000, 0.22, 23),
    ],
    paid=True, opex_cat='packaging'
)

print("OK August KSeF invoices")

# ── PODSUMOWANIE ───────────────────────────────────────────────────────────────

from apps.fixed_costs.models import FixedCost
from apps.ksef.models import ReceivedKSeFInvoice

print()
print('=' * 60)
print('DEMO CASHFLOW — PODSUMOWANIE')
print('=' * 60)
print(f'  B2C wpisy:           {DailyB2CRevenue.objects.filter(company=company).count()}')
print(f'  Quick expenses:      {QuickExpense.objects.filter(company=company).count()}')
print(f'  KSeF faktury razem:  {ReceivedKSeFInvoice.objects.filter(company=company).count()}')
print(f'  KSeF z opex_cat:     {ReceivedKSeFInvoice.objects.filter(company=company, opex_category__isnull=False).exclude(opex_category="").count()}')
print(f'  Faktury B2B razem:   {Invoice.objects.filter(company=company).count()}')
print(f'  Faktury paid:        {Invoice.objects.filter(company=company, status="paid").count()}')
print(f'  Faktury overdue:     {Invoice.objects.filter(company=company, status="overdue").count()}')
print(f'  Faktury sent:        {Invoice.objects.filter(company=company, status="sent").count()}')
print(f'  Koszty stale:        {FixedCost.objects.filter(company=company).count()} = {FixedCost.objects.filter(company=company, is_active=True).aggregate(s=__import__("django.db.models", fromlist=["Sum"]).Sum("amount_monthly"))["s"] or 0} PLN/mies.')
print()
print(f'  Konto bankowe:       {config.bank_balance} PLN')
print(f'  Kasa:                {config.cash_balance} PLN')
print(f'  Forma opodatkowania: {config.get_tax_form_display()}')
print(f'  Status ZUS:          {config.get_zus_status_display()}')
print('=' * 60)
