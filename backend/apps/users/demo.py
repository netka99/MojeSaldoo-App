"""
Demo company factory.

Creates a fully-populated "MojeSaldoo Demo" company for a given user,
modelled as a realistic Polish bakery (piekarnia).
Called automatically on registration and available as a management command.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.utils import timezone


def create_demo_company_for_user(user) -> None:
    """
    Create a demo company with sample data for *user*.
    All errors are propagated to the caller — wrap in try/except when calling
    from registration so a failure doesn't block account creation.
    """
    from apps.cash_flow.models import DailyB2CRevenue, QuickExpense
    from apps.sales_reports.models import DailySalesReport, DailySalesReportItem, SalesReportTemplate
    from apps.customers.models import Customer
    from apps.delivery.models import DeliveryDocument, DeliveryItem
    from apps.fixed_costs.models import FixedCost
    from apps.invoices.models import Invoice, InvoiceItem
    from apps.invoices.services import recalculate_invoice_totals
    from apps.orders.models import Order, OrderItem
    from apps.production.models import ProductionOrder, Recipe, RecipeItem
    from apps.products.models import Product, ProductStock, StockMovement, Warehouse
    from apps.purchase_orders.models import SupplierOrder, SupplierOrderItem
    from apps.suppliers.models import Supplier
    from apps.users.models import Company, CompanyMembership, CompanyModule, CompanyRole
    from apps.van_routes.models import VanRoute

    # ------------------------------------------------------------------
    # 1. Company
    # ------------------------------------------------------------------
    company = Company.objects.create(
        name="Piekarnia Złoty Kłos",
        is_demo=True,
        onboarding_completed=True,
        taxation_form=Company.TAXATION_KPIR,
        company_type=Company.COMPANY_TYPE_MIXED,
        is_vat_payer=True,
        invoice_number_prefix="FV",
        city="Kraków",
        address="ul. Piekarska 7",
        postal_code="30-001",
    )

    # Dates relative to company creation — never to Python's date.today()
    today = company.created_at.date()
    m1 = (today.replace(day=1) - timedelta(days=1)).replace(day=1)   # first day of prev month
    m2 = today.replace(day=1)                                          # first day of current month

    admin_role = CompanyRole.objects.create(
        company=company,
        name="Administrator",
        is_admin=True,
    )
    CompanyMembership.objects.create(
        user=user,
        company=company,
        role="admin",
        company_role=admin_role,
        is_active=True,
    )

    # Copy enabled modules from user's real company (if any), otherwise enable all
    now = timezone.now()
    real_company = (
        Company.objects.filter(
            memberships__user=user,
            memberships__is_active=True,
            is_demo=False,
            deleted_at__isnull=True,
        )
        .exclude(pk=company.pk)
        .first()
    )
    if real_company:
        enabled_modules = set(
            CompanyModule.objects.filter(company=real_company, is_enabled=True)
            .values_list("module", flat=True)
        )
    else:
        enabled_modules = {key for key, _label in CompanyModule.MODULE_CHOICES}

    for key, _label in CompanyModule.MODULE_CHOICES:
        is_enabled = key in enabled_modules
        CompanyModule.objects.get_or_create(
            company=company,
            module=key,
            defaults={"is_enabled": is_enabled, "enabled_at": now if is_enabled else None},
        )

    # ------------------------------------------------------------------
    # 2. Warehouses
    # ------------------------------------------------------------------
    wh_main = Warehouse.objects.create(
        company=company,
        user=user,
        name="Magazyn Główny",
        code="MG",
    )
    wh_van = Warehouse.objects.create(
        company=company,
        user=user,
        name="Van",
        code="MV",
    )

    # ------------------------------------------------------------------
    # 3. Products — 3 surowce + 5 wyrobów gotowych
    # ------------------------------------------------------------------
    maka = Product.objects.create(
        company=company, user=user,
        name="Mąka pszenna typ 650", unit="kg",
        product_type=Product.PRODUCT_TYPE_MATERIAL,
        price_net=Decimal("2.10"), price_gross=Decimal("2.27"), vat_rate=Decimal("8.00"),
    )
    cukier = Product.objects.create(
        company=company, user=user,
        name="Cukier biały", unit="kg",
        product_type=Product.PRODUCT_TYPE_MATERIAL,
        price_net=Decimal("3.60"), price_gross=Decimal("3.89"), vat_rate=Decimal("8.00"),
    )
    maslo = Product.objects.create(
        company=company, user=user,
        name="Masło extra 82%", unit="kg",
        product_type=Product.PRODUCT_TYPE_MATERIAL,
        price_net=Decimal("20.00"), price_gross=Decimal("21.60"), vat_rate=Decimal("8.00"),
    )
    chleb = Product.objects.create(
        company=company, user=user,
        name="Chleb wiejski 500g", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("4.50"), price_gross=Decimal("4.86"), vat_rate=Decimal("8.00"),
    )
    bulka = Product.objects.create(
        company=company, user=user,
        name="Bułka pszenna", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("0.80"), price_gross=Decimal("0.86"), vat_rate=Decimal("8.00"),
    )
    rogal = Product.objects.create(
        company=company, user=user,
        name="Rogal maślany", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("1.20"), price_gross=Decimal("1.30"), vat_rate=Decimal("8.00"),
    )
    drozdzowka = Product.objects.create(
        company=company, user=user,
        name="Drożdżówka z serem", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("2.00"), price_gross=Decimal("2.16"), vat_rate=Decimal("8.00"),
    )
    tort = Product.objects.create(
        company=company, user=user,
        name="Tort urodzinowy", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("85.00"), price_gross=Decimal("91.80"), vat_rate=Decimal("8.00"),
    )
    torba = Product.objects.create(
        company=company, user=user,
        name="Torba papierowa z logo", unit="szt",
        product_type=Product.PRODUCT_TYPE_TRADE,
        price_net=Decimal("0.50"), price_gross=Decimal("0.62"), vat_rate=Decimal("23.00"),
    )
    pudelko = Product.objects.create(
        company=company, user=user,
        name="Pudełko na tort", unit="szt",
        product_type=Product.PRODUCT_TYPE_TRADE,
        price_net=Decimal("3.50"), price_gross=Decimal("4.31"), vat_rate=Decimal("23.00"),
    )

    # Stock levels in main warehouse
    for product, qty in [
        (maka, "300.00"), (cukier, "100.00"), (maslo, "50.00"),
        (chleb, "180.00"), (bulka, "500.00"), (rogal, "250.00"),
        (drozdzowka, "120.00"), (tort, "8.00"),
        (torba, "200.00"), (pudelko, "30.00"),
    ]:
        ProductStock.objects.create(
            company=company,
            product=product,
            warehouse=wh_main,
            quantity_available=Decimal(qty),
            quantity_reserved=Decimal("0.00"),
        )

    # ------------------------------------------------------------------
    # 4. Customers
    # ------------------------------------------------------------------
    sklep = Customer.objects.create(
        company=company, name="Sklep Spożywczy Nowak",
        nip="1234567890", city="Kraków", street="ul. Długa 5",
        email="sklep@nowak.pl", phone="501000001",
    )
    bar = Customer.objects.create(
        company=company, name="Bar Centrum",
        city="Kraków", street="ul. Krótka 2",
        phone="501000002",
    )
    kawiarnia = Customer.objects.create(
        company=company, name="Kawiarnia Różana",
        city="Kraków", street="ul. Różana 10",
        email="kawiarnia@rozana.pl",
    )
    hotel = Customer.objects.create(
        company=company, name="Hotel Złoty",
        nip="9876543210", city="Kraków", street="ul. Złota 1",
        email="zamowienia@hotelzloty.pl",
    )
    przedszkole = Customer.objects.create(
        company=company, name="Przedszkole Słoneczko",
        city="Kraków", street="ul. Słoneczna 3",
        phone="501000005",
    )
    bistro = Customer.objects.create(
        company=company, name="Bistro Pod Lipą",
        city="Kraków", street="ul. Lipowa 8",
        phone="501000006",
    )
    restauracja = Customer.objects.create(
        company=company, name="Restauracja Staromiejska",
        nip="6782345678", city="Kraków", street="ul. Grodzka 15",
        email="zamowienia@staromiejska.pl",
    )

    # ------------------------------------------------------------------
    # 5. Supplier
    # ------------------------------------------------------------------
    supplier = Supplier.objects.create(
        company=company,
        name="Mąkpol Sp. z o.o.",
        nip="5551234567",
        city="Łódź",
        street="ul. Przemysłowa 44",
        email="zamowienia@makpol.pl",
    )

    # ------------------------------------------------------------------
    # 6. PZ — przyjęcie towaru od dostawcy (zrealizowane)
    # ------------------------------------------------------------------
    pz1 = DeliveryDocument.objects.create(
        company=company,
        user=user,
        document_type=DeliveryDocument.DOC_TYPE_PZ,
        status=DeliveryDocument.STATUS_DELIVERED,
        issue_date=m1 + timedelta(days=3),
        to_warehouse=wh_main,
        notes=f"Przyjęcie od {supplier.name}",
    )
    DeliveryItem.objects.create(
        delivery_document=pz1, product=maka,
        quantity_planned=Decimal("150.00"), unit_cost=Decimal("2.00"),
    )
    DeliveryItem.objects.create(
        delivery_document=pz1, product=cukier,
        quantity_planned=Decimal("50.00"), unit_cost=Decimal("3.40"),
    )
    DeliveryItem.objects.create(
        delivery_document=pz1, product=maslo,
        quantity_planned=Decimal("30.00"), unit_cost=Decimal("19.00"),
    )

    pz2 = DeliveryDocument.objects.create(
        company=company,
        user=user,
        document_type=DeliveryDocument.DOC_TYPE_PZ,
        status=DeliveryDocument.STATUS_DELIVERED,
        issue_date=m2 + timedelta(days=4),
        to_warehouse=wh_main,
        notes=f"Przyjęcie od {supplier.name} — uzupełnienie",
    )
    DeliveryItem.objects.create(
        delivery_document=pz2, product=maka,
        quantity_planned=Decimal("100.00"), unit_cost=Decimal("2.05"),
    )
    DeliveryItem.objects.create(
        delivery_document=pz2, product=maslo,
        quantity_planned=Decimal("20.00"), unit_cost=Decimal("19.50"),
    )

    # ------------------------------------------------------------------
    # 7. Orders — 4 zrealizowane + 1 draft
    # ------------------------------------------------------------------
    def _make_order(customer, order_date, delivery_date, status, items):
        order = Order.objects.create(
            company=company, user=user,
            customer=customer,
            order_date=order_date,
            delivery_date=delivery_date,
            status=status,
        )
        for product, qty, price_net in items:
            OrderItem.objects.create(
                order=order,
                product=product,
                product_name=product.name,
                product_unit=product.unit,
                quantity=Decimal(str(qty)),
                unit_price_net=Decimal(str(price_net)),
                unit_price_gross=product.price_gross,
                vat_rate=product.vat_rate,
            )
        # OrderItem.save() calls order.calculate_total() automatically
        return order

    order1 = _make_order(
        sklep, m1 + timedelta(days=2), m1 + timedelta(days=3),
        Order.STATUS_INVOICED,
        [(chleb, 80, "4.50"), (bulka, 150, "0.80"), (rogal, 100, "1.20")],
    )
    order2 = _make_order(
        kawiarnia, m1 + timedelta(days=12), m1 + timedelta(days=13),
        Order.STATUS_INVOICED,
        [(drozdzowka, 60, "2.00"), (tort, 3, "85.00"), (rogal, 50, "1.20")],
    )
    order3 = _make_order(
        hotel, m1 + timedelta(days=18), m1 + timedelta(days=20),
        Order.STATUS_INVOICED,
        [(tort, 5, "85.00"), (chleb, 40, "4.50"), (drozdzowka, 30, "2.00")],
    )
    order4 = _make_order(
        przedszkole, m2 + timedelta(days=2), m2 + timedelta(days=3),
        Order.STATUS_INVOICED,
        [(chleb, 50, "4.50"), (bulka, 120, "0.80"), (rogal, 60, "1.20")],
    )
    order_draft = _make_order(
        bar, today - timedelta(days=1), today + timedelta(days=1),
        Order.STATUS_CONFIRMED,
        [(chleb, 30, "4.50"), (bulka, 80, "0.80"), (rogal, 40, "1.20")],
    )
    # WZ bez FV — dostarczone ale jeszcze nie zafakturowane (pokazuje potencjał przepływu)
    order_wz_no_fv = _make_order(
        bistro, m2 + timedelta(days=7), m2 + timedelta(days=8),
        Order.STATUS_DELIVERED,
        [(drozdzowka, 100, "2.00"), (rogal, 80, "1.20")],
    )
    order_wz_no_fv2 = _make_order(
        restauracja, m2 + timedelta(days=9), m2 + timedelta(days=10),
        Order.STATUS_DELIVERED,
        [(chleb, 150, "4.50"), (bulka, 200, "0.80")],
    )

    # ------------------------------------------------------------------
    # 8. WZ — wydania magazynowe
    # ------------------------------------------------------------------
    def _make_wz(order, issue_date, status, items):
        wz = DeliveryDocument.objects.create(
            company=company, user=user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status=status,
            issue_date=issue_date,
            order=order,
            from_warehouse=wh_main,
        )
        for product, qty in items:
            DeliveryItem.objects.create(
                delivery_document=wz, product=product,
                quantity_planned=Decimal(str(qty)),
            )
        return wz

    _make_wz(
        order1, m1 + timedelta(days=3), DeliveryDocument.STATUS_DELIVERED,
        [(chleb, 80), (bulka, 150), (rogal, 100)],
    )
    _make_wz(
        order2, m1 + timedelta(days=13), DeliveryDocument.STATUS_DELIVERED,
        [(drozdzowka, 60), (tort, 3), (rogal, 50)],
    )
    _make_wz(
        order3, m1 + timedelta(days=20), DeliveryDocument.STATUS_DELIVERED,
        [(tort, 5), (chleb, 40), (drozdzowka, 30)],
    )
    _make_wz(
        order4, m2 + timedelta(days=3), DeliveryDocument.STATUS_DELIVERED,
        [(chleb, 50), (bulka, 120), (rogal, 60)],
    )
    _make_wz(
        order_draft, today, DeliveryDocument.STATUS_DRAFT,
        [(chleb, 30), (bulka, 80), (rogal, 40)],
    )
    # WZ dostarczone bez faktury — widoczne w przepływie rozliczeniowym jako "WZ bez FV"
    _make_wz(
        order_wz_no_fv, m2 + timedelta(days=8), DeliveryDocument.STATUS_DELIVERED,
        [(drozdzowka, 100), (rogal, 80)],
    )
    _make_wz(
        order_wz_no_fv2, m2 + timedelta(days=10), DeliveryDocument.STATUS_DELIVERED,
        [(chleb, 150), (bulka, 200)],
    )

    # ------------------------------------------------------------------
    # 9. Invoices — 8 historycznych (łączny przychód ~20–25 tys. PLN)
    # ------------------------------------------------------------------
    inv_seq = [0]  # mutable counter

    def _make_invoice(customer, order, issue_date, status, items, ksef_status=None, due_days=14):
        inv_seq[0] += 1
        # Generate a unique invoice number matching the company's FV/{year}/{seq:04d} format
        invoice_number = f"FV/{issue_date.year}/{inv_seq[0]:04d}"
        # Default ksef_status: all historical invoices are accepted in KSeF
        # (KSeF responses are near-instant — "sent" as a final state would be misleading)
        if ksef_status is None:
            ksef_status = "accepted" if status in (Invoice.STATUS_PAID, Invoice.STATUS_ISSUED) else "not_sent"
        # paid_at must be set for STATUS_PAID — the cash flow view filters by paid_at, not issue_date
        paid_at = (
            timezone.make_aware(datetime.combine(issue_date + timedelta(days=3), time()))
            if status == Invoice.STATUS_PAID else None
        )
        inv = Invoice.objects.create(
            company=company, user=user,
            customer=customer,
            order=order,
            invoice_number=invoice_number,
            issue_date=issue_date,
            sale_date=issue_date,
            due_date=issue_date + timedelta(days=due_days),
            status=status,
            ksef_status=ksef_status,
            paid_at=paid_at,
        )
        for product, qty, price_net in items:
            InvoiceItem.objects.create(
                invoice=inv,
                product=product,
                product_name=product.name,
                product_unit=product.unit,
                quantity=Decimal(str(qty)),
                unit_price_net=Decimal(str(price_net)),
                vat_rate=product.vat_rate,
            )
        recalculate_invoice_totals(inv)
        inv.save(update_fields=["subtotal_net", "subtotal_gross", "vat_amount", "total_gross"])
        return inv

    # m1 invoices — razem ~14 500 zł gross
    _make_invoice(
        sklep, order1, m1 + timedelta(days=4), Invoice.STATUS_PAID,
        [(chleb, 400, "4.50"), (bulka, 800, "0.80"), (rogal, 500, "1.20")],
        # net: 1800+640+600 = 3040, gross ~3283.20
    )
    _make_invoice(
        kawiarnia, order2, m1 + timedelta(days=14), Invoice.STATUS_PAID,
        [(drozdzowka, 200, "2.00"), (tort, 8, "85.00"), (rogal, 150, "1.20")],
        # net: 400+680+180 = 1260, gross ~1360.80
    )
    _make_invoice(
        hotel, order3, m1 + timedelta(days=21), Invoice.STATUS_PAID,
        [(tort, 15, "85.00"), (chleb, 200, "4.50"), (drozdzowka, 100, "2.00")],
        # net: 1275+900+200 = 2375, gross ~2565
    )
    _make_invoice(
        bar, None, m1 + timedelta(days=8), Invoice.STATUS_PAID,
        [(bulka, 600, "0.80"), (rogal, 400, "1.20"), (chleb, 200, "4.50")],
        # net: 480+480+900 = 1860, gross ~2008.80
    )
    _make_invoice(
        przedszkole, None, m1 + timedelta(days=16), Invoice.STATUS_PAID,
        [(chleb, 300, "4.50"), (bulka, 500, "0.80"), (rogal, 200, "1.20")],
        # net: 1350+400+240 = 1990, gross ~2149.20
    )
    # m2 invoices — wszystkie zapłacone żeby wpłynęło było widoczne w bieżącym miesiącu
    _make_invoice(
        przedszkole, order4, m2 + timedelta(days=4), Invoice.STATUS_PAID,
        [(chleb, 300, "4.50"), (bulka, 500, "0.80"), (rogal, 200, "1.20")],
        # net: 1350+400+240 = 1990, gross ~2149.20
    )
    _make_invoice(
        hotel, None, m2 + timedelta(days=6), Invoice.STATUS_PAID,
        [(tort, 12, "85.00"), (chleb, 150, "4.50"), (drozdzowka, 120, "2.00")],
        # net: 1020+675+240 = 1935, gross ~2089.80
    )
    _make_invoice(
        sklep, None, m2 + timedelta(days=10), Invoice.STATUS_PAID,
        [(chleb, 350, "4.50"), (bulka, 700, "0.80"), (rogal, 450, "1.20")],
        # net: 1575+560+540 = 2675, gross ~2889
    )
    _make_invoice(
        bar, None, m2 + timedelta(days=13), Invoice.STATUS_PAID,
        [(bulka, 500, "0.80"), (rogal, 300, "1.20"), (chleb, 150, "4.50")],
        # net: 400+360+675 = 1435, gross ~1549.80
    )
    _make_invoice(
        kawiarnia, None, today - timedelta(days=3), Invoice.STATUS_ISSUED,
        [(drozdzowka, 180, "2.00"), (tort, 6, "85.00"), (rogal, 200, "1.20")],
        # net: 360+510+240 = 1110, gross ~1198.80
    )
    # Zaległe faktury — wystawione dawno, termin minął, widoczne w "Zaległe FV"
    inv_overdue1 = _make_invoice(
        bistro, None, m1 + timedelta(days=5), Invoice.STATUS_ISSUED,
        [(drozdzowka, 80, "2.00"), (rogal, 60, "1.20")],
        # net: 160+72 = 232, gross ~250.56 — zaległa ponad miesiąc
        due_days=7,
    )
    inv_overdue1.status = Invoice.STATUS_OVERDUE
    inv_overdue1.save(update_fields=["status", "updated_at"])

    inv_overdue2 = _make_invoice(
        restauracja, None, m2 + timedelta(days=1), Invoice.STATUS_ISSUED,
        [(chleb, 80, "4.50"), (bulka, 150, "0.80")],
        # net: 360+120 = 480, gross ~518.40 — zaległa kilkanaście dni
        due_days=5,
    )
    inv_overdue2.status = Invoice.STATUS_OVERDUE
    inv_overdue2.save(update_fields=["status", "updated_at"])

    # ------------------------------------------------------------------
    # 10. Fixed costs
    # ------------------------------------------------------------------
    active_from = m2  # first day of current month
    FixedCost.objects.create(
        company=company, category=FixedCost.CAT_ZUS_ZDROWOTNE,
        description="ZUS przedsiębiorcy", amount_monthly=Decimal("1050.00"),
        due_day=10, active_from=active_from,
    )
    FixedCost.objects.create(
        company=company, category=FixedCost.CAT_CZYNSZ,
        description="Czynsz za lokal piekarni", amount_monthly=Decimal("2200.00"),
        due_day=5, active_from=active_from,
    )
    FixedCost.objects.create(
        company=company, category=FixedCost.CAT_PALIWO,
        description="Paliwo — dostawa", amount_monthly=Decimal("350.00"),
        active_from=active_from,
    )
    FixedCost.objects.create(
        company=company, category=FixedCost.CAT_UBEZPIECZENIA,
        description="Ubezpieczenie firmy i lokalu", amount_monthly=Decimal("280.00"),
        due_day=15, active_from=active_from,
    )

    # ------------------------------------------------------------------
    # 11. Quick expenses (koszty bieżące)
    # ------------------------------------------------------------------
    QuickExpense.objects.create(
        company=company, date=m1 + timedelta(days=2),
        amount=Decimal("1296.00"), amount_net=Decimal("1200.00"),
        vat_rate="8", category="raw_materials",
        has_vat=True, vendor="Mąkpol Sp. z o.o.",
        document_type="faktura_vat", document_number="FV/2026/0045",
        notes="Mąka pszenna 400 kg + cukier 100 kg",
    )
    QuickExpense.objects.create(
        company=company, date=m1 + timedelta(days=2),
        amount=Decimal("648.00"), amount_net=Decimal("600.00"),
        vat_rate="8", category="raw_materials",
        has_vat=True, vendor="Mąkpol Sp. z o.o.",
        document_type="faktura_vat", document_number="FV/2026/0046",
        notes="Masło extra 30 kg + drożdże 20 kg",
    )
    QuickExpense.objects.create(
        company=company, date=m1 + timedelta(days=10),
        amount=Decimal("680.00"), category="utilities",
        vendor="Tauron Polska Energia",
        document_type="faktura_vat", document_number="TAURON/2026/10/001",
        notes="Prąd za miesiąc — piece + chłodnia",
    )
    QuickExpense.objects.create(
        company=company, date=m1 + timedelta(days=15),
        amount=Decimal("320.00"), category="packaging",
        vendor="PakMat Sp. z o.o.", document_type="faktura_vat",
        notes="Torby papierowe i worki do pieczywa",
    )
    QuickExpense.objects.create(
        company=company, date=m2 + timedelta(days=3),
        amount=Decimal("1134.00"), amount_net=Decimal("1050.00"),
        vat_rate="8", category="raw_materials",
        has_vat=True, vendor="Mąkpol Sp. z o.o.",
        document_type="faktura_vat", document_number="FV/2026/0112",
        notes="Mąka pszenna 300 kg + masło 20 kg",
    )
    QuickExpense.objects.create(
        company=company, date=m2 + timedelta(days=8),
        amount=Decimal("240.00"), category="repair",
        vendor="SerwisPro Jan Kowalski", document_type="faktura_vat",
        notes="Przegląd pieca piekarniczego",
    )
    QuickExpense.objects.create(
        company=company, date=m2 + timedelta(days=12),
        amount=Decimal("290.00"), category="packaging",
        vendor="PakMat Sp. z o.o.", document_type="faktura_vat",
        notes="Opakowania — uzupełnienie",
    )

    # ------------------------------------------------------------------
    # 12. Daily B2C revenue (sprzedaż gotówkowa przy kasie)
    # ------------------------------------------------------------------
    b2c_data = [
        (m1 + timedelta(days=1),  Decimal("1240.00")),
        (m1 + timedelta(days=4),  Decimal("1380.00")),
        (m1 + timedelta(days=7),  Decimal("1190.00")),
        (m1 + timedelta(days=10), Decimal("1450.00")),
        (m1 + timedelta(days=14), Decimal("1320.00")),
        (m1 + timedelta(days=17), Decimal("1280.00")),
        (m1 + timedelta(days=21), Decimal("1410.00")),
        (m1 + timedelta(days=24), Decimal("1350.00")),
        (m2 + timedelta(days=1),  Decimal("1260.00")),
        (m2 + timedelta(days=4),  Decimal("1420.00")),
        (m2 + timedelta(days=7),  Decimal("1180.00")),
        (m2 + timedelta(days=10), Decimal("1390.00")),
    ]
    for b2c_date, b2c_amount in b2c_data:
        DailyB2CRevenue.objects.create(
            company=company,
            date=b2c_date,
            amount=b2c_amount,
            vat_included=True,
            vat_rate=Decimal("8.00"),
            notes="Sprzedaż detaliczna przy kasie",
        )

    # Kilka wpisów z rozbiciem na produkty — pokazują tryb "Lista produktów"
    b2c_products_data = [
        (m1 + timedelta(days=2),  "Sobota — targ miejski", [
            (chleb,      80,  Decimal("4.86")),
            (bulka,     200,  Decimal("0.86")),
            (rogal,      60,  Decimal("1.30")),
            (drozdzowka, 40,  Decimal("2.16")),
        ]),
        (m1 + timedelta(days=9),  "Sobota — targ miejski", [
            (chleb,      75,  Decimal("4.86")),
            (bulka,     180,  Decimal("0.86")),
            (rogal,      55,  Decimal("1.30")),
            (drozdzowka, 35,  Decimal("2.16")),
            (tort,        2,  Decimal("91.80")),
        ]),
        (m2 + timedelta(days=2),  "Sobota — targ miejski", [
            (chleb,      90,  Decimal("4.86")),
            (bulka,     220,  Decimal("0.86")),
            (rogal,      70,  Decimal("1.30")),
            (drozdzowka, 50,  Decimal("2.16")),
        ]),
    ]
    for b2c_date, b2c_notes, product_lines in b2c_products_data:
        lines = []
        total_revenue = Decimal("0")
        for product, qty, unit_price in product_lines:
            line_revenue = unit_price * qty
            total_revenue += line_revenue
            lines.append({
                "product_id": str(product.id),
                "name": product.name,
                "qty": qty,
                "unit_price": float(unit_price),
                "unit_cost": 0,
                "line_revenue": float(line_revenue),
                "line_cost": 0,
            })
        DailyB2CRevenue.objects.create(
            company=company,
            date=b2c_date,
            amount=total_revenue,
            vat_included=True,
            vat_rate=Decimal("8.00"),
            notes=b2c_notes,
            sale_type="products",
            lines=lines,
        )

    # ------------------------------------------------------------------
    # 13. Raporty kasowe (RK) — DailySalesReport
    # ------------------------------------------------------------------
    rk_days = [
        (m1 + timedelta(days=1),  "Sklep przy piekarni", [
            (chleb,      Decimal("45"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("120"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("40"), Decimal("1.30"), Decimal("8.00")),
            (drozdzowka, Decimal("25"), Decimal("2.16"), Decimal("8.00")),
        ]),
        (m1 + timedelta(days=4),  "Sklep przy piekarni", [
            (chleb,      Decimal("50"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("130"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("45"), Decimal("1.30"), Decimal("8.00")),
            (drozdzowka, Decimal("30"), Decimal("2.16"), Decimal("8.00")),
            (tort,       Decimal("1"),  Decimal("91.80"), Decimal("8.00")),
        ]),
        (m1 + timedelta(days=8),  "Targ Stary Kleparz", [
            (chleb,      Decimal("80"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("200"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("60"), Decimal("1.30"), Decimal("8.00")),
            (drozdzowka, Decimal("40"), Decimal("2.16"), Decimal("8.00")),
        ]),
        (m1 + timedelta(days=11), "Sklep przy piekarni", [
            (chleb,      Decimal("42"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("110"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("38"), Decimal("1.30"), Decimal("8.00")),
        ]),
        (m2 + timedelta(days=1),  "Sklep przy piekarni", [
            (chleb,      Decimal("48"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("125"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("42"), Decimal("1.30"), Decimal("8.00")),
            (drozdzowka, Decimal("28"), Decimal("2.16"), Decimal("8.00")),
        ]),
        (m2 + timedelta(days=5),  "Targ Stary Kleparz", [
            (chleb,      Decimal("90"), Decimal("4.86"), Decimal("8.00")),
            (bulka,      Decimal("220"), Decimal("0.86"), Decimal("8.00")),
            (rogal,      Decimal("70"), Decimal("1.30"), Decimal("8.00")),
            (drozdzowka, Decimal("50"), Decimal("2.16"), Decimal("8.00")),
            (tort,       Decimal("2"),  Decimal("91.80"), Decimal("8.00")),
        ]),
    ]
    for rk_date, rk_notes, rk_lines in rk_days:
        rk = DailySalesReport.objects.create(
            company=company,
            date=rk_date,
            status=DailySalesReport.STATUS_SAVED,
            notes=rk_notes,
            vat_rate=Decimal("8.00"),
            vat_included=True,
        )
        for product, qty, unit_price, vat_rate in rk_lines:
            DailySalesReportItem.objects.create(
                report=rk,
                product=product,
                product_name=product.name,
                unit=product.unit,
                qty=qty,
                vat_rate=vat_rate,
                unit_price=unit_price,
            )
        rk.recalculate_totals()

    # Szablon domyślny — sklep przy piekarni
    SalesReportTemplate.objects.create(
        company=company,
        name="Sklep przy piekarni",
        is_default=True,
        lines=[
            {"product_id": str(chleb.id), "product_name": chleb.name, "unit": chleb.unit, "qty": 45, "unit_price": float(chleb.price_gross), "unit_cost": 0},
            {"product_id": str(bulka.id), "product_name": bulka.name, "unit": bulka.unit, "qty": 120, "unit_price": float(bulka.price_gross), "unit_cost": 0},
            {"product_id": str(rogal.id), "product_name": rogal.name, "unit": rogal.unit, "qty": 40, "unit_price": float(rogal.price_gross), "unit_cost": 0},
            {"product_id": str(drozdzowka.id), "product_name": drozdzowka.name, "unit": drozdzowka.unit, "qty": 25, "unit_price": float(drozdzowka.price_gross), "unit_cost": 0},
        ],
    )
    SalesReportTemplate.objects.create(
        company=company,
        name="Targ Stary Kleparz",
        is_default=False,
        lines=[
            {"product_id": str(chleb.id), "product_name": chleb.name, "unit": chleb.unit, "qty": 80, "unit_price": float(chleb.price_gross), "unit_cost": 0},
            {"product_id": str(bulka.id), "product_name": bulka.name, "unit": bulka.unit, "qty": 200, "unit_price": float(bulka.price_gross), "unit_cost": 0},
            {"product_id": str(rogal.id), "product_name": rogal.name, "unit": rogal.unit, "qty": 60, "unit_price": float(rogal.price_gross), "unit_cost": 0},
            {"product_id": str(drozdzowka.id), "product_name": drozdzowka.name, "unit": drozdzowka.unit, "qty": 40, "unit_price": float(drozdzowka.price_gross), "unit_cost": 0},
        ],
    )

    # ------------------------------------------------------------------
    # 14. Van routes (trasy vana)
    # ------------------------------------------------------------------
    route1 = VanRoute.objects.create(
        company=company,
        user=user,
        date=m1 + timedelta(days=3),
        driver_name="Marek Wiśniewski",
        van_name="WY 12345",
        van_warehouse=wh_van,
        main_warehouse=wh_main,
        status=VanRoute.STATUS_CLOSED,
    )
    route1.orders.set([order1])

    route2 = VanRoute.objects.create(
        company=company,
        user=user,
        date=m2 + timedelta(days=3),
        driver_name="Marek Wiśniewski",
        van_name="WY 12345",
        van_warehouse=wh_van,
        main_warehouse=wh_main,
        status=VanRoute.STATUS_CLOSED,
    )
    route2.orders.set([order4])

    # ------------------------------------------------------------------
    # 14. Supplier orders / ZD (zamówienia do dostawców)
    # ------------------------------------------------------------------
    zd1 = SupplierOrder.objects.create(
        company=company,
        created_by=user,
        supplier=supplier,
        issue_date=m1 + timedelta(days=1),
        expected_delivery_date=m1 + timedelta(days=3),
        status=SupplierOrder.STATUS_FULFILLED,
        notes="Regularne zamówienie na początku miesiąca",
    )
    SupplierOrderItem.objects.create(
        supplier_order=zd1,
        product=maka,
        quantity_ordered=Decimal("150.00"),
        quantity_received=Decimal("150.00"),
        unit_price_net=Decimal("2.00"),
        vat_rate=Decimal("8.00"),
    )
    SupplierOrderItem.objects.create(
        supplier_order=zd1,
        product=cukier,
        quantity_ordered=Decimal("50.00"),
        quantity_received=Decimal("50.00"),
        unit_price_net=Decimal("3.40"),
        vat_rate=Decimal("8.00"),
    )
    SupplierOrderItem.objects.create(
        supplier_order=zd1,
        product=maslo,
        quantity_ordered=Decimal("30.00"),
        quantity_received=Decimal("30.00"),
        unit_price_net=Decimal("19.00"),
        vat_rate=Decimal("8.00"),
    )

    zd2 = SupplierOrder.objects.create(
        company=company,
        created_by=user,
        supplier=supplier,
        issue_date=m2 + timedelta(days=2),
        expected_delivery_date=m2 + timedelta(days=4),
        status=SupplierOrder.STATUS_FULFILLED,
        notes="Uzupełnienie surowców na nowy miesiąc",
    )
    SupplierOrderItem.objects.create(
        supplier_order=zd2,
        product=maka,
        quantity_ordered=Decimal("100.00"),
        quantity_received=Decimal("100.00"),
        unit_price_net=Decimal("2.05"),
        vat_rate=Decimal("8.00"),
    )
    SupplierOrderItem.objects.create(
        supplier_order=zd2,
        product=maslo,
        quantity_ordered=Decimal("20.00"),
        quantity_received=Decimal("20.00"),
        unit_price_net=Decimal("19.50"),
        vat_rate=Decimal("8.00"),
    )

    # ------------------------------------------------------------------
    # 15. Recipes (receptury produkcji)
    # ------------------------------------------------------------------
    recipe_chleb = Recipe.objects.create(
        company=company,
        product=chleb,
        name="Chleb wiejski 500g",
        yield_quantity=Decimal("10"),  # one batch = 10 loaves
        notes="Tradycyjny chleb na zakwasie, pieczony w piecu opalanym drewnem.",
    )
    RecipeItem.objects.create(
        recipe=recipe_chleb,
        ingredient=maka,
        quantity=Decimal("6.00"),   # 6 kg mąki na 10 chlebów
        unit="kg",
    )
    RecipeItem.objects.create(
        recipe=recipe_chleb,
        ingredient=cukier,
        quantity=Decimal("0.20"),   # 0.2 kg cukru
        unit="kg",
    )

    recipe_rogal = Recipe.objects.create(
        company=company,
        product=rogal,
        name="Rogal maślany",
        yield_quantity=Decimal("20"),  # one batch = 20 rogali
        notes="Delikatny rogal z masłem, posypany cukrem pudrem.",
    )
    RecipeItem.objects.create(
        recipe=recipe_rogal,
        ingredient=maka,
        quantity=Decimal("2.00"),   # 2 kg mąki na 20 rogali
        unit="kg",
    )
    RecipeItem.objects.create(
        recipe=recipe_rogal,
        ingredient=maslo,
        quantity=Decimal("0.60"),   # 0.6 kg masła
        unit="kg",
    )
    RecipeItem.objects.create(
        recipe=recipe_rogal,
        ingredient=cukier,
        quantity=Decimal("0.30"),   # 0.3 kg cukru
        unit="kg",
    )

    # ------------------------------------------------------------------
    # 16. Production orders (zlecenia produkcji)
    # ------------------------------------------------------------------
    prod_chleb_m1 = ProductionOrder.objects.create(
        company=company,
        created_by=user,
        recipe=recipe_chleb,
        date=m1 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE,
        status=ProductionOrder.STATUS_COMPLETED,
        quantity_produced=Decimal("100"),   # 10 batches × 10 chlebów
        notes="Produkcja poranna — chleby wiejskie",
    )

    prod_rogal_m2 = ProductionOrder.objects.create(
        company=company,
        created_by=user,
        recipe=recipe_rogal,
        date=m2 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE,
        status=ProductionOrder.STATUS_COMPLETED,
        quantity_produced=Decimal("200"),   # 10 batches × 20 rogali
        notes="Produkcja poranna — rogale maślane",
    )

    # Open (draft) production orders — visible in "Zlecenia produkcji" as aktywne
    ProductionOrder.objects.create(
        company=company,
        created_by=user,
        recipe=recipe_chleb,
        date=today,
        mode=ProductionOrder.MODE_SIMPLE,
        status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("0"),
        notes="Produkcja dzienna — chleby wiejskie",
    )
    ProductionOrder.objects.create(
        company=company,
        created_by=user,
        recipe=recipe_rogal,
        date=today,
        mode=ProductionOrder.MODE_SIMPLE,
        status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("0"),
        notes="Produkcja dzienna — rogale maślane",
    )
    ProductionOrder.objects.create(
        company=company,
        created_by=user,
        recipe=recipe_chleb,
        date=today + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE,
        status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("0"),
        notes="Zlecenie jutrzejsze — chleby wiejskie",
    )

    # ------------------------------------------------------------------
    # 17. Stock movements for materials (must come after pz1, pz2, prod_chleb_m1, prod_rogal_m2)
    # Timeline: m1+1 consume, m1+3 pz1, m2+1 consume, m2+4 pz2 → current stock
    # maka:   130 → -60 → 70 → +150 → 220 → -20 → 200 → +100 → 300 ✓
    # cukier:  55 →  -2 → 53 →  +50 → 103 →  -3 → 100 ✓
    # maslo:   26 →       26 →  +30 →  56 →  -6 →  50 → +20  →  70... but current=50
    #          actual maslo current=50, pz2 added 20, so before pz2: 30, before consume: 36, before pz1: 6
    #          6 → +30 → 36 → -6 → 30 → +20 → 50 ✓
    # ------------------------------------------------------------------
    def _mov(product, qty_str, mov_type, qty_before_str, dt, ref_type=None, ref_id=None):
        qty = Decimal(qty_str)
        qty_before = Decimal(qty_before_str)
        StockMovement.objects.create(
            company=company,
            product=product,
            warehouse=wh_main,
            user=user,
            movement_type=mov_type,
            quantity=qty,
            quantity_before=qty_before,
            quantity_after=qty_before + qty,
            reference_type=ref_type,
            reference_id=ref_id,
            created_at=timezone.make_aware(datetime.combine(dt, time())),
        )

    PURCHASE = StockMovement.MovementType.PURCHASE
    ADJUST = StockMovement.MovementType.ADJUSTMENT

    # m1+1: zużycie do produkcji chlebów
    _mov(maka,   "-60.00", ADJUST,  "130.00", m1 + timedelta(days=1), "production_order", prod_chleb_m1.uuid)
    _mov(cukier,  "-2.00", ADJUST,   "55.00", m1 + timedelta(days=1), "production_order", prod_chleb_m1.uuid)
    # m1+3: przyjęcie PZ1
    _mov(maka,  "150.00", PURCHASE,  "70.00", m1 + timedelta(days=3), "delivery_document", pz1.uuid)
    _mov(cukier,  "50.00", PURCHASE, "53.00", m1 + timedelta(days=3), "delivery_document", pz1.uuid)
    _mov(maslo,   "30.00", PURCHASE,  "6.00", m1 + timedelta(days=3), "delivery_document", pz1.uuid)
    # m2+1: zużycie do produkcji rogali
    _mov(maka,   "-20.00", ADJUST,  "220.00", m2 + timedelta(days=1), "production_order", prod_rogal_m2.uuid)
    _mov(cukier,  "-3.00", ADJUST,  "103.00", m2 + timedelta(days=1), "production_order", prod_rogal_m2.uuid)
    _mov(maslo,   "-6.00", ADJUST,   "36.00", m2 + timedelta(days=1), "production_order", prod_rogal_m2.uuid)
    # m2+4: przyjęcie PZ2
    _mov(maka,  "100.00", PURCHASE, "200.00", m2 + timedelta(days=4), "delivery_document", pz2.uuid)
    _mov(maslo,   "20.00", PURCHASE, "30.00", m2 + timedelta(days=4), "delivery_document", pz2.uuid)
