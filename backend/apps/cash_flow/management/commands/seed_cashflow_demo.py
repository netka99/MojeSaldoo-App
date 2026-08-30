"""
Management command: seed_cashflow_demo

Populates realistic August 2026 cash-flow data for an existing company.
Run it while logged in as any user — it targets the first company owned by
the demo user (demo@ryczalt.pl), or pass --company-id to target a specific one.

What it creates:
  - Tax config: VAT payer, KPiR linear 19%, pełny ZUS
  - Saldo: gotówka 3 500 zł, konto 18 200 zł
  - 6 outgoing invoices (July 2026): 4 paid, 2 outstanding (receivables)
  - 5 KSeF received (purchase) invoices with opex_category → VAT to deduct
  - 4 supplier payables (ReceivedKSeFInvoice unpaid, due in Aug)
  - 6 quick expenses (August 2026)
  - 4 daily B2C revenue entries (bakery street sales)

Usage:
    python manage.py seed_cashflow_demo
    python manage.py seed_cashflow_demo --company-id 3
    python manage.py seed_cashflow_demo --reset
"""

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


DEMO_EMAIL = "demo@ryczalt.pl"


class Command(BaseCommand):
    help = "Seed realistic cash-flow demo data (August 2026 scenario)"

    def add_arguments(self, parser):
        parser.add_argument("--company-id", type=int, help="Target company PK")
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete previously seeded cash-flow data before creating new",
        )

    def handle(self, *args, **options):
        from apps.users.models import Company
        from apps.customers.models import Customer
        from apps.invoices.models import Invoice, InvoiceItem
        from apps.orders.models import Order, OrderItem
        from apps.products.models import Product
        from apps.ksef.models import ReceivedKSeFInvoice
        from apps.cash_flow.models import (
            CompanyTaxConfig,
            QuickExpense,
            DailyB2CRevenue,
        )

        # ── Resolve company ───────────────────────────────────────────────────
        if options.get("company_id"):
            company = Company.objects.get(pk=options["company_id"])
        else:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            try:
                user = User.objects.get(email=DEMO_EMAIL)
                company = user.current_company or user.memberships.first().company
            except User.DoesNotExist:
                # Fall back to first company
                company = Company.objects.first()
                if not company:
                    self.stderr.write("No company found. Run seed_ryczalt_demo first.")
                    return

        self.stdout.write(f"  Targeting company: {company.name} (id={company.pk})")

        # ── Optional reset ────────────────────────────────────────────────────
        if options["reset"]:
            QuickExpense.objects.filter(company=company).delete()
            DailyB2CRevenue.objects.filter(company=company).delete()
            # Remove KSeF invoices seeded by this command (identified by prefix)
            ReceivedKSeFInvoice.objects.filter(
                company=company, ksef_number__startswith="DEMO-"
            ).delete()
            # Remove sales invoices seeded by this command (prefix DEMO-FV)
            Invoice.objects.filter(
                company=company, invoice_number__startswith="DEMO-FV"
            ).delete()
            self.stdout.write("[DEL] Cleared previous demo cash-flow data.")

        with transaction.atomic():
            # ── Tax config ────────────────────────────────────────────────────
            config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
            config.tax_form = CompanyTaxConfig.TAX_FORM_KPIR_LINEAR
            config.tax_rate = Decimal("19.00")
            config.vat_payer = True
            config.vat_method = CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA
            config.vat_due_day = 25
            config.zus_due_day = 20
            config.zus_status = CompanyTaxConfig.ZUS_PELNY
            config.has_sick_insurance = False
            # Saldo kont — realne liczby
            config.cash_balance = Decimal("3500.00")
            config.bank_balance = Decimal("18200.00")
            config.balance_updated_at = timezone.now()
            config.save()
            self.stdout.write("[OK] Tax config + saldo set")

            # ── Customers (get-or-create) ─────────────────────────────────────
            customers_data = [
                {"name": "Sklep Spożywczy Nowak", "payment_terms": 14},
                {"name": "Kawiarnia Złota Filiżanka", "payment_terms": 7},
                {"name": "Hotel Wawel", "payment_terms": 30},
                {"name": "Restauracja Pod Orłem", "payment_terms": 14},
            ]
            customers = []
            for cd in customers_data:
                c, _ = Customer.objects.get_or_create(
                    company=company,
                    name=cd["name"],
                    defaults={"payment_terms": cd["payment_terms"], "country": "PL"},
                )
                customers.append(c)

            # ── Products (get-or-create) ──────────────────────────────────────
            products_data = [
                {"name": "Chleb żytni 1kg", "price_net": Decimal("5.69"), "price_gross": Decimal("6.15"), "vat_rate": Decimal("8.00")},
                {"name": "Ciastka kruche 500g", "price_net": Decimal("12.96"), "price_gross": Decimal("14.00"), "vat_rate": Decimal("8.00")},
                {"name": "Tort urodzinowy", "price_net": Decimal("129.63"), "price_gross": Decimal("140.00"), "vat_rate": Decimal("8.00")},
            ]
            products = []
            for pd in products_data:
                p, _ = Product.objects.get_or_create(
                    company=company,
                    name=pd["name"],
                    defaults={
                        "unit": "szt",
                        "price_net": pd["price_net"],
                        "price_gross": pd["price_gross"],
                        "vat_rate": pd["vat_rate"],
                        "is_service": False,
                        "track_batches": False,
                        "is_active": True,
                    },
                )
                products.append(p)

            # ── Sales invoices — July 2026 ────────────────────────────────────
            # 4 paid (revenue visible in Month tab), 2 outstanding (receivables)
            sales_invoices = [
                # (customer_idx, gross, issue_day, status)
                (0, Decimal("4920.00"), 3,  "paid"),
                (1, Decimal("1836.00"), 7,  "paid"),
                (2, Decimal("8640.00"), 10, "paid"),
                (3, Decimal("2754.00"), 15, "paid"),
                (0, Decimal("3312.00"), 20, "issued"),   # receivable — 14d term → due Aug 3
                (2, Decimal("5184.00"), 22, "issued"),   # receivable — 30d term → due Aug 21
            ]

            try:
                user_obj = company.members.first().user
            except Exception:
                from django.contrib.auth import get_user_model
                user_obj = get_user_model().objects.filter(is_staff=True).first()

            for i, (cust_idx, gross, issue_day, status) in enumerate(sales_invoices, start=1):
                inv_num = f"DEMO-FV/2026/{i:04d}"
                if Invoice.objects.filter(company=company, invoice_number=inv_num).exists():
                    continue
                customer = customers[cust_idx]
                vat_rate = Decimal("8.00")
                net = (gross / Decimal("1.08")).quantize(Decimal("0.01"))
                vat = gross - net
                issue_date = date(2026, 7, issue_day)
                due_date = issue_date + timedelta(days=customer.payment_terms or 14)

                order = Order.objects.create(
                    company=company,
                    customer=customer,
                    status="invoiced",
                    order_date=issue_date,
                    delivery_date=issue_date,
                    total_gross=gross,
                    total_net=net,
                )
                invoice = Invoice.objects.create(
                    company=company,
                    user=user_obj,
                    order=order,
                    customer=customer,
                    invoice_number=inv_num,
                    issue_date=issue_date,
                    sale_date=issue_date,
                    due_date=due_date,
                    payment_method="transfer",
                    subtotal_net=net,
                    subtotal_gross=gross,
                    vat_amount=vat,
                    total_gross=gross,
                    status=status,
                    ksef_status="not_sent",
                )
                if status == "paid":
                    invoice.paid_at = timezone.make_aware(
                        timezone.datetime(2026, 7, min(issue_day + 5, 31), 12, 0)
                    )
                    invoice.save(update_fields=["paid_at"])

                prod = products[i % len(products)]
                InvoiceItem.objects.create(
                    invoice=invoice, product=prod,
                    product_name=prod.name, product_unit="szt",
                    quantity=Decimal("1"), unit_price_net=net,
                    vat_rate=vat_rate, line_net=net, line_vat=vat, line_gross=gross,
                )
                OrderItem.objects.create(
                    order=order, product=prod,
                    product_name=prod.name, product_unit="szt",
                    quantity=Decimal("1"), unit_price_net=net,
                    unit_price_gross=gross, vat_rate=vat_rate,
                    line_total_net=net, line_total_gross=gross,
                )

            self.stdout.write("[OK] 6 sales invoices (4 paid, 2 outstanding)")

            # ── KSeF received invoices — zakupy July 2026 ─────────────────────
            # These generate VAT input (odliczenie) and appear as payables
            ksef_purchases = [
                # (ksef_num, seller, net, vat_amount, gross, opex_cat, due_day, is_paid)
                ("DEMO-K001", "Młyn Lubelski Sp. z o.o.", Decimal("4200.00"), Decimal("966.00"), Decimal("5166.00"), "raw_materials", date(2026, 8, 5), False),
                ("DEMO-K002", "Polskie Opakowania SA",    Decimal("980.00"),  Decimal("225.40"), Decimal("1205.40"), "packaging",    date(2026, 8, 10), False),
                ("DEMO-K003", "Shell Polska",             Decimal("620.00"),  Decimal("142.60"), Decimal("762.60"),  "fuel",         date(2026, 7, 31), True),   # paid
                ("DEMO-K004", "Orange Polska SA",         Decimal("200.00"),  Decimal("46.00"),  Decimal("246.00"),  "utilities",    date(2026, 8, 15), False),
                ("DEMO-K005", "Serwis Piekarniczy Nowak", Decimal("1800.00"), Decimal("414.00"), Decimal("2214.00"), "repair",       date(2026, 8, 20), False),
            ]

            for ksef_num, seller, net, vat_amt, gross, opex_cat, due_dt, is_paid in ksef_purchases:
                obj, created = ReceivedKSeFInvoice.objects.get_or_create(
                    company=company,
                    ksef_number=ksef_num,
                    defaults={
                        "invoice_number": ksef_num.replace("DEMO-", "FZ/2026/"),
                        "issue_date": date(2026, 7, 5),
                        "seller_nip": "0000000000",
                        "seller_name": seller,
                        "net_amount": net,
                        "gross_amount": gross,
                        "vat_amount": vat_amt,
                        "currency": "PLN",
                        "opex_category": opex_cat,
                        "opex_tagged_at": timezone.now(),
                        "due_date": due_dt,
                        "is_paid": is_paid,
                        "paid_at": timezone.now() if is_paid else None,
                    },
                )
                if created:
                    pass

            self.stdout.write("[OK] 5 KSeF purchase invoices (4 unpaid payables, 1 paid)")

            # ── Quick expenses — August 2026 ──────────────────────────────────
            quick_expenses = [
                # (date, amount, category, vendor, doc_type)
                (date(2026, 8, 1), Decimal("350.00"), "fuel",         "Shell Wrocław",        "paragon"),
                (date(2026, 8, 2), Decimal("89.50"),  "packaging",    "Eurocash",             "paragon"),
                (date(2026, 8, 4), Decimal("215.00"), "raw_materials","Targ Hurtowy Kraków",  "paragon"),
                (date(2026, 8, 5), Decimal("420.00"), "utilities",    "Tauron",               "faktura_vat"),
                (date(2026, 8, 6), Decimal("65.00"),  "other",        "Poczta Polska",        "inne"),
                (date(2026, 8, 7), Decimal("180.00"), "repair",       "Serwis AGD Marek",     "faktura_vat"),
            ]

            for exp_date, amount, category, vendor, doc_type in quick_expenses:
                QuickExpense.objects.get_or_create(
                    company=company,
                    date=exp_date,
                    amount=amount,
                    category=category,
                    vendor=vendor,
                    defaults={
                        "document_type": doc_type,
                        "cost_type": "indirect",
                        "has_vat": doc_type == "faktura_vat",
                    },
                )

            self.stdout.write("[OK] 6 quick expenses (August)")

            # ── Daily B2C revenue — street sales, first week August ───────────
            b2c_entries = [
                (date(2026, 8, 1), Decimal("840.00")),
                (date(2026, 8, 2), Decimal("920.00")),
                (date(2026, 8, 4), Decimal("755.00")),
                (date(2026, 8, 5), Decimal("1080.00")),
                (date(2026, 8, 6), Decimal("670.00")),
                (date(2026, 8, 7), Decimal("890.00")),
            ]
            for b2c_date, b2c_amount in b2c_entries:
                DailyB2CRevenue.objects.get_or_create(
                    company=company,
                    date=b2c_date,
                    defaults={
                        "amount": b2c_amount,
                        "vat_included": True,
                        "vat_rate": Decimal("8.00"),
                    },
                )

            self.stdout.write("[OK] 6 B2C revenue entries (Aug 1–7)")

        self.stdout.write("[DONE] Cash-flow demo data ready!")
