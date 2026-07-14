"""
Management command: seed_ryczalt_demo

Creates a complete demo environment for a ryczałt (flat-rate) user:
  - Company: "Piekarnia Kowalski" (ryczałt 8.5%, uslugi)
  - User: demo@ryczalt.pl / demo1234
  - Modules: invoicing, reporting, customers, products, orders, fixed_costs
  - 5 customers (local bakery clients)
  - 6 products (bread, pastries, cakes)
  - 6 months of invoices (Jan–Jun 2026, realistic seasonal pattern)
  - Fixed costs (ZUS, salary, rent, accountant)

Usage:
    python manage.py seed_ryczalt_demo
    python manage.py seed_ryczalt_demo --reset   # delete existing demo data first
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

User = get_user_model()


COMPANY_NAME = "Piekarnia Kowalski Demo"
DEMO_EMAIL = "demo@ryczalt.pl"
DEMO_PASSWORD = "demo1234"


class Command(BaseCommand):
    help = "Seed ryczałt demo data (piekarnia scenario)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing demo company and recreate from scratch",
        )

    def handle(self, *args, **options):
        from apps.users.models import Company, CompanyMembership, CompanyModule, CompanyRole
        from apps.customers.models import Customer
        from apps.products.models import Product
        from apps.orders.models import Order, OrderItem
        from apps.invoices.models import Invoice, InvoiceItem
        from apps.fixed_costs.models import FixedCost
        from decimal import ROUND_HALF_UP

        if options["reset"]:
            from apps.invoices.models import Invoice, InvoiceItem
            from apps.orders.models import Order
            from apps.users.models import Company
            companies = Company.objects.filter(name=COMPANY_NAME)
            for company in companies:
                InvoiceItem.objects.filter(invoice__company=company).delete()
                Invoice.objects.filter(company=company).delete()
                Order.objects.filter(company=company).delete()
            companies.delete()
            User.objects.filter(email=DEMO_EMAIL).delete()
            self.stdout.write("[DEL] Deleted existing demo data.")

        with transaction.atomic():
            # ── User ──────────────────────────────────────────────────────
            user, created = User.objects.get_or_create(
                email=DEMO_EMAIL,
                defaults={"username": DEMO_EMAIL, "first_name": "Demo", "last_name": "Ryczałt"},
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
                self.stdout.write(f"[OK] Created user: {DEMO_EMAIL} / {DEMO_PASSWORD}")
            else:
                self.stdout.write(f"  User already exists: {DEMO_EMAIL}")

            # ── Company ───────────────────────────────────────────────────
            company, created = Company.objects.get_or_create(
                name=COMPANY_NAME,
                defaults={
                    "nip": "1234567890",
                    "address": "ul. Piekarska 12",
                    "city": "Kraków",
                    "postal_code": "30-001",
                    "taxation_form": "ryczalt",
                    "ryczalt_category": "uslugi",
                    "company_type": "production",
                    "onboarding_completed": True,
                },
            )
            if created:
                self.stdout.write(f"[OK] Created company: {COMPANY_NAME}")
            else:
                self.stdout.write(f"  Company already exists: {COMPANY_NAME}")

            user.current_company = company
            user.save(update_fields=["current_company"])

            # ── Role & Membership ─────────────────────────────────────────
            admin_role, _ = CompanyRole.objects.get_or_create(
                company=company,
                name="Administrator",
                defaults={"is_admin": True},
            )
            CompanyMembership.objects.get_or_create(
                user=user,
                company=company,
                defaults={"role": "admin", "company_role": admin_role, "is_active": True},
            )

            # ── Modules ───────────────────────────────────────────────────
            for module in [
                "customers", "products", "orders", "invoicing",
                "reporting", "fixed_costs", "ksef",
            ]:
                CompanyModule.objects.get_or_create(
                    company=company,
                    module=module,
                    defaults={"is_enabled": True, "enabled_at": timezone.now()},
                )
            self.stdout.write("[OK] Modules enabled")

            # ── Customers ─────────────────────────────────────────────────
            customers_data = [
                {"name": "Sklep Spożywczy Nowak", "city": "Kraków", "payment_terms": 14},
                {"name": "Kawiarnia Złota Filiżanka", "city": "Kraków", "payment_terms": 7},
                {"name": "Hotel Wawel", "city": "Kraków", "payment_terms": 30},
                {"name": "Restauracja Pod Orłem", "city": "Wieliczka", "payment_terms": 14},
                {"name": "Przedszkole Słoneczko", "city": "Kraków", "payment_terms": 30},
            ]
            customers = []
            for cd in customers_data:
                c, _ = Customer.objects.get_or_create(
                    company=company,
                    name=cd["name"],
                    defaults={"city": cd["city"], "payment_terms": cd["payment_terms"], "country": "PL"},
                )
                customers.append(c)
            self.stdout.write(f"[OK] {len(customers)} customers")

            # ── Products ──────────────────────────────────────────────────
            products_data = [
                {"name": "Chleb żytni 1kg", "unit": "szt", "price_net": Decimal("5.69"), "price_gross": Decimal("6.15"), "vat_rate": Decimal("8.00")},
                {"name": "Chleb pszenny 0,8kg", "unit": "szt", "price_net": Decimal("4.63"), "price_gross": Decimal("5.00"), "vat_rate": Decimal("8.00")},
                {"name": "Rogalik maślany", "unit": "szt", "price_net": Decimal("1.85"), "price_gross": Decimal("2.00"), "vat_rate": Decimal("8.00")},
                {"name": "Drożdżówka z serem", "unit": "szt", "price_net": Decimal("2.78"), "price_gross": Decimal("3.00"), "vat_rate": Decimal("8.00")},
                {"name": "Tort urodzinowy", "unit": "szt", "price_net": Decimal("129.63"), "price_gross": Decimal("140.00"), "vat_rate": Decimal("8.00")},
                {"name": "Ciastka kruche 500g", "unit": "opak", "price_net": Decimal("12.96"), "price_gross": Decimal("14.00"), "vat_rate": Decimal("8.00")},
            ]
            products = []
            for pd in products_data:
                p, _ = Product.objects.get_or_create(
                    company=company,
                    name=pd["name"],
                    defaults={
                        "unit": pd["unit"],
                        "price_net": pd["price_net"],
                        "price_gross": pd["price_gross"],
                        "vat_rate": pd["vat_rate"],
                        "is_service": False,
                        "track_batches": False,
                        "is_active": True,
                    },
                )
                products.append(p)
            self.stdout.write(f"[OK] {len(products)} products")

            # ── Invoices — 6 months ───────────────────────────────────────
            # Monthly revenue targets (realistic seasonal bakery pattern)
            monthly_targets = {
                1: 14_500,   # styczeń — spokojnie po świętach
                2: 13_800,   # luty
                3: 17_200,   # marzec — pre-easter
                4: 19_500,   # kwiecień — Wielkanoc
                5: 16_800,   # maj
                6: 15_200,   # czerwiec
            }

            invoice_counter = Invoice.objects.filter(company=company).count()
            invoices_created = 0

            for month, target in monthly_targets.items():
                issue_date_base = date(2026, month, 1)
                remaining = target

                # 3–5 invoices per month, spread across customers
                num_invoices = random.randint(3, 5)
                for i in range(num_invoices):
                    customer = customers[i % len(customers)]
                    # Last invoice gets the remainder
                    if i == num_invoices - 1:
                        inv_gross = remaining
                    else:
                        inv_gross = random.randint(
                            int(target * 0.10),
                            int(target * 0.35),
                        )
                        remaining -= inv_gross

                    inv_gross = max(inv_gross, 100)
                    inv_gross_dec = Decimal(str(inv_gross))
                    vat_rate = Decimal("8.00")
                    inv_net = (inv_gross_dec / Decimal("1.08")).quantize(Decimal("0.01"))
                    inv_vat = inv_gross_dec - inv_net

                    issue_day = min(random.randint(1, 25), 28)
                    issue_date = date(2026, month, issue_day)
                    due_date = issue_date + timedelta(days=14)

                    # Status: paid for older months, issued/overdue for recent
                    if month <= 5:
                        status = "paid"
                    elif month == 6:
                        status = random.choice(["issued", "paid", "overdue"])
                    else:
                        status = "issued"

                    invoice_counter += 1
                    invoice_number = f"FV/{2026}/{invoice_counter:04d}"

                    # Check for duplicate invoice number
                    if Invoice.objects.filter(company=company, invoice_number=invoice_number).exists():
                        invoice_number = f"FV/{2026}/{invoice_counter:04d}D"

                    # Create a minimal order to satisfy Invoice FK
                    order_day = max(1, issue_day - 1)
                    order = Order.objects.create(
                        company=company,
                        customer=customer,
                        status="invoiced",
                        order_date=date(2026, month, order_day),
                        delivery_date=date(2026, month, issue_day),
                        total_gross=inv_gross_dec,
                        total_net=inv_net,
                    )

                    invoice = Invoice.objects.create(
                        company=company,
                        user=user,
                        order=order,
                        customer=customer,
                        invoice_number=invoice_number,
                        issue_date=issue_date,
                        sale_date=issue_date,
                        due_date=due_date,
                        payment_method="transfer",
                        subtotal_net=inv_net,
                        subtotal_gross=inv_gross_dec,
                        vat_amount=inv_vat,
                        total_gross=inv_gross_dec,
                        status=status,
                        ksef_status="not_sent",
                    )

                    # Pick a product and create one line item (invoice + order)
                    product = products[i % len(products)]
                    qty = Decimal("1.00")
                    InvoiceItem.objects.create(
                        invoice=invoice,
                        product=product,
                        product_name=product.name,
                        product_unit=product.unit,
                        quantity=qty,
                        unit_price_net=inv_net,
                        vat_rate=vat_rate,
                        line_net=inv_net,
                        line_vat=inv_vat,
                        line_gross=inv_gross_dec,
                    )
                    OrderItem.objects.create(
                        order=order,
                        product=product,
                        product_name=product.name,
                        product_unit=product.unit,
                        quantity=qty,
                        unit_price_net=inv_net,
                        unit_price_gross=inv_gross_dec,
                        vat_rate=vat_rate,
                        line_total_net=inv_net,
                        line_total_gross=inv_gross_dec,
                    )

                    invoices_created += 1

            self.stdout.write(f"[OK] {invoices_created} invoices (Jan–Jun 2026)")

            # ── Fixed Costs ───────────────────────────────────────────────
            fixed_costs_data = [
                {
                    "category": "zus_zdrowotne",
                    "description": "Składki ZUS właściciela",
                    "amount_monthly": Decimal("1847.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "wynagrodzenia",
                    "description": "Maria Kowalska — piekarz",
                    "amount_monthly": Decimal("4200.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "wynagrodzenia",
                    "description": "Tomasz Wiśniewski — pomocnik",
                    "amount_monthly": Decimal("3600.00"),
                    "active_from": date(2026, 3, 1),
                },
                {
                    "category": "czynsz",
                    "description": "Lokal piekarni ul. Piekarska 12",
                    "amount_monthly": Decimal("2800.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "ksiegowosc",
                    "description": "Biuro rachunkowe Rachunki.pl",
                    "amount_monthly": Decimal("450.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "ubezpieczenia",
                    "description": "OC i mienie piekarni",
                    "amount_monthly": Decimal("180.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "paliwo",
                    "description": "Dostawa pieczywa do klientów",
                    "amount_monthly": Decimal("620.00"),
                    "active_from": date(2026, 1, 1),
                },
                {
                    "category": "inne",
                    "description": "Opłaty bankowe",
                    "amount_monthly": Decimal("49.00"),
                    "active_from": date(2026, 1, 1),
                },
            ]

            for fcd in fixed_costs_data:
                FixedCost.objects.get_or_create(
                    company=company,
                    category=fcd["category"],
                    description=fcd["description"],
                    defaults={
                        "amount_monthly": fcd["amount_monthly"],
                        "active_from": fcd["active_from"],
                        "is_active": True,
                    },
                )
            total_fc = sum(fcd["amount_monthly"] for fcd in fixed_costs_data)
            self.stdout.write(f"[OK] {len(fixed_costs_data)} fixed costs ({total_fc} PLN/mies.)")

        self.stdout.write(self.style.SUCCESS(
            f"\n[DONE] Demo ready!\n"
            f"   Email:    {DEMO_EMAIL}\n"
            f"   Password: {DEMO_PASSWORD}\n"
            f"   Company:  {COMPANY_NAME}\n"
            f"   Tax form: Ryczalt 8.5% (uslugi)\n"
        ))
