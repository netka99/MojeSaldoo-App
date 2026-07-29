# -*- coding: utf-8 -*-
"""
Demo data — Firma Piekarnia (id=6), daty z lipca 2026
Run:
  python -c "
  import io,sys; sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
  import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
  import django; django.setup()
  exec(open('demo_data_piekarnia.py',encoding='utf-8').read())
  "
"""

from decimal import Decimal
from datetime import date, timedelta
from django.utils import timezone
import pytz

from apps.users.models import User, Company
from apps.products.models import Product, Warehouse, ProductStock, StockBatch
from apps.customers.models import Customer
from apps.suppliers.models import Supplier
from apps.orders.models import Order, OrderItem
from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice, InvoiceItem
from apps.production.models import Recipe, RecipeItem, ProductionOrder
from apps.fixed_costs.models import FixedCost

# ── Setup ──────────────────────────────────────────────────────────────────────

company = Company.objects.get(id=6)
user = company.memberships.first().user
tz = pytz.timezone('Europe/Warsaw')
today = date(2026, 7, 27)  # dzisiaj

print(f"Company: {company.name} (id={company.id})")
print(f"User: {user.email}")

# ── Istniejace magazyny ────────────────────────────────────────────────────────
mg   = Warehouse.objects.get(company=company, code='MG')   # Magazyn Główny
van1 = Warehouse.objects.get(company=company, code='MV1')  # Van 1
van2 = Warehouse.objects.get(company=company, code='MV2')  # Van 2
print("OK Warehouses (istniejace)")

# ── 1. SUPPLIERS ───────────────────────────────────────────────────────────────

sup_maka, _ = Supplier.objects.get_or_create(
    company=company, name='Mlyny Polskie Sp. z o.o.',
    defaults=dict(
        nip='5261234567', email='zamowienia@mlynypolskie.pl',
        phone='22 123 45 67', city='Warszawa',
        street='ul. Mlynarska 12', postal_code='01-205',
        country='PL', payment_terms=14, is_active=True,
    )
)
sup_dodatki, _ = Supplier.objects.get_or_create(
    company=company, name='PiekarDodatki Hurtownia',
    defaults=dict(
        nip='5269876543', email='hurt@piekardodatki.pl',
        phone='22 987 65 43', city='Lodz',
        street='ul. Piekarska 45', postal_code='90-001',
        country='PL', payment_terms=14, is_active=True,
    )
)
print("OK Suppliers")

# ── 2. PRODUCTS — surowce i wyroby ────────────────────────────────────────────

def goc_product(name, unit, price_net, vat_rate, pkwiu='', track_batches=False, avg_cost=None):
    p, _ = Product.objects.get_or_create(
        company=company, name=name,
        defaults=dict(
            user=user, unit=unit,
            price_net=Decimal(str(price_net)),
            price_gross=round(Decimal(str(price_net)) * (1 + Decimal(str(vat_rate)) / 100), 2),
            vat_rate=vat_rate,
            pkwiu=pkwiu,
            track_batches=track_batches,
            avg_cost=Decimal(str(avg_cost)) if avg_cost else None,
            last_cost=Decimal(str(avg_cost)) if avg_cost else None,
            is_active=True,
        )
    )
    return p

# Surowce
maka_pszenna = goc_product('Maka pszenna typ 550',  'kg',   1.89, 8,  '10.61.21', True, 1.89)
maka_zytnia  = goc_product('Maka zytnia typ 720',   'kg',   2.10, 8,  '10.61.21', True, 2.10)
drozdze      = goc_product('Drozdzee swieze',        'kg',   8.50, 5,  '21.20.14', True, 8.50)
sol          = goc_product('Sol kuchenna',           'kg',   0.80, 23, '08.93.10', False, 0.80)
cukier       = goc_product('Cukier bialy',           'kg',   3.20, 8,  '10.81.11', False, 3.20)
maslo        = goc_product('Maslo 82%',              'kg',  24.00, 8,  '10.51.11', True, 24.00)
jajka        = goc_product('Jajka L',                'szt.', 0.65, 5,  '01.47.21', True, 0.65)
mak          = goc_product('Mak niebieski',          'kg',  14.00, 8,  '10.61.29', False, 14.00)
rodzynki     = goc_product('Rodzynki',               'kg',  18.00, 8,  '01.27.90', False, 18.00)
opakowania   = goc_product('Torebki papierowe 25cm', 'szt.', 0.08, 23, '17.22.19', False, 0.08)

# Wyroby gotowe
chleb_pszenny = goc_product('Chleb pszenny 800g',       'szt.', 4.50, 5, '10.71.11')
chleb_zytni   = goc_product('Chleb zytni 700g',         'szt.', 4.80, 5, '10.71.11')
bulka_pszenna = goc_product('Bulka pszenna 100g',        'szt.', 0.65, 5, '10.71.11')
rogal         = goc_product('Rogal maslany 120g',        'szt.', 2.20, 5, '10.71.19')
makowiec      = goc_product('Makowiec 500g',             'szt.', 9.50, 5, '10.71.19')
chalka        = goc_product('Chalka z rodzynkami 400g',  'szt.', 6.80, 5, '10.71.19')

print("OK Products")

# ── 3. STOCK — stany magazynowe ───────────────────────────────────────────────

def add_stock(product, warehouse, qty, unit_cost, expiry_days=None, batch_suffix='A'):
    batch_num = f'B{today.strftime("%Y%m")}{product.id:03d}{batch_suffix}'
    expiry = today + timedelta(days=expiry_days) if expiry_days else None
    ps, _ = ProductStock.objects.get_or_create(
        company=company, product=product, warehouse=warehouse,
        defaults=dict(quantity_available=0, quantity_reserved=0, quantity_total=0)
    )
    ps.quantity_available = Decimal(str(qty))
    ps.quantity_total = Decimal(str(qty))
    ps.save()
    StockBatch.objects.get_or_create(
        company=company, product=product, warehouse=warehouse,
        batch_number=batch_num,
        defaults=dict(
            received_date=today - timedelta(days=3),
            expiry_date=expiry,
            quantity_initial=Decimal(str(qty)),
            quantity_remaining=Decimal(str(qty)),
            unit_cost=Decimal(str(unit_cost)),
        )
    )

# Surowce w magazynie glownym
add_stock(maka_pszenna, mg, 320, 1.89, expiry_days=180)
add_stock(maka_zytnia,  mg, 160, 2.10, expiry_days=180)
add_stock(drozdze,      mg,  20, 8.50, expiry_days=18)
add_stock(sol,          mg,  55, 0.80)
add_stock(cukier,       mg,  90, 3.20, expiry_days=365)
add_stock(maslo,        mg,  45, 24.0, expiry_days=28)
add_stock(jajka,        mg, 580, 0.65, expiry_days=20)
add_stock(mak,          mg,  28, 14.0, expiry_days=120)
add_stock(rodzynki,     mg,  22, 18.0, expiry_days=180)
add_stock(opakowania,   mg, 4800, 0.08)

# Wyroby gotowe (dzisiejsza produkcja)
add_stock(chleb_pszenny, mg, 28, 1.85, expiry_days=3,  batch_suffix='W')
add_stock(chleb_zytni,   mg, 14, 2.10, expiry_days=4,  batch_suffix='W')
add_stock(bulka_pszenna, mg, 65, 0.26, expiry_days=2,  batch_suffix='W')
add_stock(rogal,         mg, 22, 0.92, expiry_days=2,  batch_suffix='W')
add_stock(makowiec,      mg,  8, 3.80, expiry_days=5,  batch_suffix='W')
add_stock(chalka,        mg,  7, 2.90, expiry_days=3,  batch_suffix='W')

print("OK Stock")

# ── 4. CUSTOMERS ───────────────────────────────────────────────────────────────

def goc_customer(name, company_name, nip, city, street, postal, phone, payment_terms, credit_limit):
    c, _ = Customer.objects.get_or_create(
        company=company, nip=nip,
        defaults=dict(
            user=user, name=name, company_name=company_name,
            phone=phone, city=city, street=street,
            postal_code=postal, country='PL',
            payment_terms=payment_terms,
            credit_limit=Decimal(str(credit_limit)),
            is_active=True,
        )
    )
    return c

k_galeria    = goc_customer('Galeria Smaku Sp. z o.o.', 'Galeria Smaku',
                            '5261111111', 'Warszawa', 'ul. Pulawska 200', '02-670', '501 111 222', 14, 5000)
k_osiedlowy  = goc_customer('Sklep Osiedlowy u Nowaka', 'FHU Nowak Jan',
                            '5262222222', 'Warszawa', 'ul. Botaniczna 12', '02-791', '501 333 444', 7, 2000)
k_kawiarnia  = goc_customer('Kawiarnia Pod Kasztanem', 'Kawiarnia Pod Kasztanem Sp.j.',
                            '5263333333', 'Warszawa', 'ul. Nowy Swiat 45', '00-042', '501 555 666', 14, 3000)
k_delikatesy = goc_customer('Delikatesy Centrum - Mokotow', 'DC Market Sp. z o.o.',
                            '5264444444', 'Warszawa', 'ul. Rajska 7', '02-146', '501 777 888', 30, 10000)
k_hotel      = goc_customer('Hotel Mazowiecki', 'Hotel Mazowiecki S.A.',
                            '5265555555', 'Warszawa', 'ul. Zurawia 22', '00-515', '22 444 55 66', 30, 8000)

print("OK Customers")

# ── 5. RECEPTURY ──────────────────────────────────────────────────────────────

def goc_recipe(product, name, yield_qty, items):
    r, created = Recipe.objects.get_or_create(
        company=company, product=product,
        defaults=dict(name=name, yield_quantity=Decimal(str(yield_qty)), is_active=True)
    )
    if created:
        for ingredient, qty in items:
            RecipeItem.objects.create(
                recipe=r, ingredient=ingredient,
                quantity=Decimal(str(qty)), unit=ingredient.unit,
            )
    return r

recipe_chleb_psz = goc_recipe(chleb_pszenny, 'Chleb pszenny 800g x10', 10, [
    (maka_pszenna, 8.0), (drozdze, 0.25), (sol, 0.16), (cukier, 0.10),
])
recipe_chleb_zyt = goc_recipe(chleb_zytni, 'Chleb zytni 700g x10', 10, [
    (maka_zytnia, 7.0), (maka_pszenna, 1.0), (drozdze, 0.20), (sol, 0.14),
])
recipe_bulki = goc_recipe(bulka_pszenna, 'Bulka pszenna 100g x50', 50, [
    (maka_pszenna, 5.0), (drozdze, 0.15), (sol, 0.10), (cukier, 0.05), (maslo, 0.20),
])
recipe_rogal = goc_recipe(rogal, 'Rogal maslany 120g x20', 20, [
    (maka_pszenna, 2.4), (maslo, 0.60), (jajka, 4), (cukier, 0.20), (drozdze, 0.06), (sol, 0.04),
])
recipe_makowiec = goc_recipe(makowiec, 'Makowiec 500g x5', 5, [
    (maka_pszenna, 1.5), (maslo, 0.25), (jajka, 5), (cukier, 0.30),
    (drozdze, 0.05), (mak, 1.0), (rodzynki, 0.25),
])
recipe_chalka = goc_recipe(chalka, 'Chalka z rodzynkami 400g x8', 8, [
    (maka_pszenna, 3.2), (maslo, 0.40), (jajka, 8), (cukier, 0.40),
    (drozdze, 0.08), (rodzynki, 0.60), (sol, 0.06),
])

print("OK Recipes")

# ── 6. ZLECENIA PRODUKCJI (caly lipiec) ───────────────────────────────────────

prod_counter = [ProductionOrder.objects.filter(company=company).count() + 1]

def make_prod(recipe, qty, day):
    num = f'PRD/2026/{prod_counter[0]:04d}'
    prod_counter[0] += 1
    ProductionOrder.objects.get_or_create(
        company=company, order_number=num,
        defaults=dict(
            recipe=recipe, date=date(2026, 7, day),
            mode='simple', status='completed',
            quantity_produced=Decimal(str(qty)),
            created_by=user,
        )
    )

# Tydz 1 (1-7 lipca)
make_prod(recipe_chleb_psz, 80, 1); make_prod(recipe_chleb_zyt, 40, 1)
make_prod(recipe_bulki, 200, 1);    make_prod(recipe_rogal, 40, 2)
make_prod(recipe_chalka, 16, 3);    make_prod(recipe_chleb_psz, 70, 4)
make_prod(recipe_chleb_zyt, 30, 4); make_prod(recipe_bulki, 150, 5)
make_prod(recipe_makowiec, 15, 5);  make_prod(recipe_rogal, 40, 7)

# Tydz 2 (8-14 lipca)
make_prod(recipe_chleb_psz, 90, 8);  make_prod(recipe_chleb_zyt, 40, 8)
make_prod(recipe_bulki, 200, 8);     make_prod(recipe_chalka, 24, 9)
make_prod(recipe_rogal, 60, 10);     make_prod(recipe_chleb_psz, 80, 11)
make_prod(recipe_bulki, 180, 12);    make_prod(recipe_makowiec, 20, 12)
make_prod(recipe_chleb_zyt, 40, 14); make_prod(recipe_rogal, 40, 14)

# Tydz 3 (15-21 lipca)
make_prod(recipe_chleb_psz, 100, 15); make_prod(recipe_chleb_zyt, 50, 15)
make_prod(recipe_bulki, 250, 15);     make_prod(recipe_chalka, 24, 16)
make_prod(recipe_rogal, 60, 17);      make_prod(recipe_chleb_psz, 90, 18)
make_prod(recipe_bulki, 200, 19);     make_prod(recipe_makowiec, 20, 19)
make_prod(recipe_chleb_zyt, 40, 21);  make_prod(recipe_rogal, 40, 21)

# Tydz 4 (22-27 lipca)
make_prod(recipe_chleb_psz, 90, 22);  make_prod(recipe_chleb_zyt, 40, 22)
make_prod(recipe_bulki, 200, 22);     make_prod(recipe_chalka, 16, 23)
make_prod(recipe_rogal, 60, 24);      make_prod(recipe_chleb_psz, 80, 25)
make_prod(recipe_bulki, 180, 26);     make_prod(recipe_makowiec, 15, 26)
make_prod(recipe_chleb_psz, 70, 27);  make_prod(recipe_bulki, 150, 27)

print("OK Production orders")

# ── 7. ZAMOWIENIA i FAKTURY ───────────────────────────────────────────────────

ord_counter = [Order.objects.filter(company=company).count() + 1]
inv_counter = [Invoice.objects.filter(company=company).count() + 1]

def make_order_invoice(customer, day, items, paid=True, status='delivered'):
    order_date = date(2026, 7, day)
    delivery_date = order_date + timedelta(days=1)
    ord_num = f'ZAM/2026/{ord_counter[0]:04d}'
    ord_counter[0] += 1

    total_net = Decimal('0')
    total_gross = Decimal('0')
    item_rows = []
    for product, qty in items:
        vat = product.vat_rate or 5
        line_net = product.price_net * Decimal(str(qty))
        line_gross = round(line_net * (1 + Decimal(str(vat)) / 100), 2)
        total_net += line_net
        total_gross += line_gross
        item_rows.append((product, qty, vat, line_net, line_gross))

    order = Order.objects.create(
        company=company, user=user, customer=customer,
        order_number=ord_num, order_date=order_date,
        delivery_date=delivery_date, status=status,
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

    if status in ('delivered', 'confirmed'):
        inv_num = f'FV/2026/{inv_counter[0]:04d}'
        inv_counter[0] += 1
        issue_date = order_date + timedelta(days=1)
        payment_days = customer.payment_terms or 14
        due_date = issue_date + timedelta(days=payment_days)

        paid_at = None
        inv_status = 'sent'
        if paid:
            paid_at = tz.localize(
                __import__('datetime').datetime.combine(
                    issue_date + timedelta(days=payment_days - 2),
                    __import__('datetime').time()
                )
            )
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

    return order

# Tydz 1 (1-7 lipca) — wszystkie zaplacone
make_order_invoice(k_galeria,    2, [(chleb_pszenny,20),(chleb_zytni,10),(bulka_pszenna,100),(rogal,30)], paid=True)
make_order_invoice(k_osiedlowy,  3, [(chleb_pszenny,15),(bulka_pszenna,60),(makowiec,5)], paid=True)
make_order_invoice(k_kawiarnia,  4, [(bulka_pszenna,40),(rogal,20),(chalka,8)], paid=True)
make_order_invoice(k_delikatesy, 4, [(chleb_pszenny,50),(chleb_zytni,20),(bulka_pszenna,200),(rogal,40)], paid=True)
make_order_invoice(k_hotel,      5, [(chleb_pszenny,10),(bulka_pszenna,50),(rogal,20),(chalka,6)], paid=True)

# Tydz 2 (8-14 lipca) — zaplacone
make_order_invoice(k_galeria,    9, [(chleb_pszenny,20),(chleb_zytni,10),(bulka_pszenna,80),(chalka,8)], paid=True)
make_order_invoice(k_osiedlowy, 10, [(chleb_pszenny,12),(bulka_pszenna,50),(rogal,15)], paid=True)
make_order_invoice(k_kawiarnia, 11, [(bulka_pszenna,40),(rogal,20),(makowiec,5)], paid=True)
make_order_invoice(k_delikatesy,11, [(chleb_pszenny,60),(chleb_zytni,25),(bulka_pszenna,250),(rogal,50),(makowiec,10)], paid=True)
make_order_invoice(k_hotel,     12, [(chleb_pszenny,12),(bulka_pszenna,60),(chalka,8)], paid=True)

# Tydz 3 (15-21 lipca) — czesc zaplacona, czesc czeka
make_order_invoice(k_galeria,   16, [(chleb_pszenny,25),(chleb_zytni,12),(bulka_pszenna,100),(rogal,30),(chalka,6)], paid=True)
make_order_invoice(k_osiedlowy, 17, [(chleb_pszenny,15),(bulka_pszenna,60)], paid=True)
make_order_invoice(k_kawiarnia, 18, [(bulka_pszenna,40),(rogal,20),(chalka,8)], paid=True)
make_order_invoice(k_delikatesy,18, [(chleb_pszenny,50),(chleb_zytni,20),(bulka_pszenna,200),(makowiec,8)], paid=False)  # zalega 30 dni
make_order_invoice(k_hotel,     19, [(chleb_pszenny,10),(bulka_pszenna,50),(chalka,6)], paid=False)  # zalega 30 dni

# Tydz 4 (22-27 lipca) — swiezo, nieoplacone bo termin nie minal
make_order_invoice(k_galeria,   23, [(chleb_pszenny,20),(chleb_zytni,10),(bulka_pszenna,100),(rogal,25)], paid=False)
make_order_invoice(k_osiedlowy, 24, [(chleb_pszenny,12),(bulka_pszenna,50),(rogal,15)], paid=False)
make_order_invoice(k_kawiarnia, 25, [(bulka_pszenna,40),(rogal,20),(chalka,6)], paid=False)
make_order_invoice(k_delikatesy,25, [(chleb_pszenny,40),(chleb_zytni,20),(bulka_pszenna,150)], paid=False)
make_order_invoice(k_hotel,     26, [(chleb_pszenny,10),(bulka_pszenna,50),(rogal,20),(chalka,5)], paid=False)

# Zamowienia otwarte (jeszcze bez faktury)
make_order_invoice(k_galeria,   27, [(chleb_pszenny,20),(bulka_pszenna,80),(chalka,5)], paid=False, status='confirmed')
make_order_invoice(k_delikatesy,27, [(chleb_pszenny,30),(chleb_zytni,15),(bulka_pszenna,120)], paid=False, status='new')

print("OK Orders and invoices")

# ── 8. KOSZTY STALE ───────────────────────────────────────────────────────────

for category, description, amount in [
    ('wynajem',    'Wynajem lokalu piekarni',           4200),
    ('energia',    'Energia elektryczna - piece',        1800),
    ('gaz',        'Gaz ziemny',                          950),
    ('leasing',    'Leasing pieca konwekcyjnego',        1100),
    ('pracownicy', 'Wynagrodzenia - 2 piekarzy',         9000),
    ('ksiegowosc', 'Biuro rachunkowe',                    350),
    ('ubezp',      'Ubezpieczenie lokalu i sprzetu',      280),
    ('internet',   'Telefon i internet',                  120),
]:
    FixedCost.objects.get_or_create(
        company=company, category=category,
        defaults=dict(
            description=description,
            amount_monthly=Decimal(str(amount)),
            active_from=date(2026, 1, 1),
            is_active=True,
        )
    )

print("OK Fixed costs")

# ── PODSUMOWANIE ───────────────────────────────────────────────────────────────

from apps.products.models import Warehouse
print()
print("=" * 55)
print("DEMO DATA — PODSUMOWANIE")
print("=" * 55)
print(f"  Firma:              {company.name}")
print(f"  Login:              {user.email}")
print(f"  Dostawcy:           {Supplier.objects.filter(company=company).count()}")
print(f"  Produkty:           {Product.objects.filter(company=company).count()}")
print(f"  Klienci:            {Customer.objects.filter(company=company).count()}")
print(f"  Receptury:          {Recipe.objects.filter(company=company).count()}")
print(f"  Zlecenia produkcji: {ProductionOrder.objects.filter(company=company).count()}")
print(f"  Zamowienia:         {Order.objects.filter(company=company).count()}")
print(f"  Faktury:            {Invoice.objects.filter(company=company).count()}")
print(f"  Koszty stale:       {FixedCost.objects.filter(company=company).count()}")
print("=" * 55)
