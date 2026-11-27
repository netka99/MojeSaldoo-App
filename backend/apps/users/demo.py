"""
Demo company factory.

Creates a fully-populated "MojeSaldoo Demo" company for a given user,
modelled as a realistic Polish bakery (piekarnia).
Called automatically on registration and available as a management command.
"""
from __future__ import annotations

import datetime as _dt
from datetime import datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.utils import timezone


def create_demo_company_for_user(user) -> None:
    """
    Create a demo company with sample data for *user*.
    All errors are propagated to the caller — wrap in try/except when calling
    from registration so a failure doesn't block account creation.
    """
    # Disconnect audit signals so demo seeding doesn't pollute the audit log.
    # Use real model classes (not strings) so disconnect/connect works reliably.
    from apps.activity import audit as _audit_module
    from django.apps import apps as django_apps
    from django.db.models.signals import post_delete, post_save, pre_save

    def _get(label):
        return django_apps.get_model(label)

    _audit_signals = [
        (pre_save,   _audit_module._invoice_pre_save,              _get('invoices.Invoice')),
        (post_save,  _audit_module._invoice_post_save,             _get('invoices.Invoice')),
        (post_delete,_audit_module._invoice_post_delete,           _get('invoices.Invoice')),
        (pre_save,   _audit_module._product_pre_save,              _get('products.Product')),
        (post_save,  _audit_module._product_post_save,             _get('products.Product')),
        (post_save,  _audit_module._stock_movement_post_save,      _get('products.StockMovement')),
        (pre_save,   _audit_module._delivery_pre_save,             _get('delivery.DeliveryDocument')),
        (post_save,  _audit_module._delivery_post_save,            _get('delivery.DeliveryDocument')),
        (post_delete,_audit_module._delivery_post_delete,          _get('delivery.DeliveryDocument')),
        (pre_save,   _audit_module._order_pre_save,                _get('orders.Order')),
        (post_save,  _audit_module._order_post_save,               _get('orders.Order')),
        (pre_save,   _audit_module._customer_pre_save,             _get('customers.Customer')),
        (post_save,  _audit_module._customer_post_save,            _get('customers.Customer')),
        (pre_save,   _audit_module._company_pre_save,              _get('users.Company')),
        (post_save,  _audit_module._company_post_save,             _get('users.Company')),
        (pre_save,   _audit_module._production_order_pre_save,     _get('production.ProductionOrder')),
        (post_save,  _audit_module._production_order_post_save,    _get('production.ProductionOrder')),
    ]
    for signal, handler, sender in _audit_signals:
        signal.disconnect(handler, sender=sender)

    try:
        return _create_demo_company_for_user_inner(user)
    finally:
        for signal, handler, sender in _audit_signals:
            signal.connect(handler, sender=sender)


def _create_demo_company_for_user_inner(user) -> None:
    from apps.cash_flow.models import DailyB2CRevenue, QuickExpense
    from apps.sales_reports.models import DailySalesReport, DailySalesReportItem, SalesReportTemplate
    from apps.customers.models import Customer
    from apps.delivery.models import DeliveryDocument, DeliveryItem
    from apps.fixed_costs.models import FixedCost
    from apps.invoices.models import Invoice, InvoiceItem
    from apps.invoices.services import recalculate_invoice_totals
    from apps.orders.models import Order, OrderItem
    from apps.production.models import ProductionOrder, ProductionOrderSource, Recipe, RecipeItem
    from apps.products.models import Product, ProductStock, StockBatch, StockMovement, Warehouse
    from apps.purchase_orders.models import SupplierOrder, SupplierOrderItem
    from apps.suppliers.models import Supplier
    from apps.users.models import Company, CompanyMembership, CompanyModule, CompanyRole, get_workflow_settings
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

    # Last completed Mon-Fri work week before today.
    # monday_this_week = today minus today.weekday() (0=Mon)
    # We go one full week back so the whole week is in the past.
    _days_since_monday = today.weekday()  # 0=Mon … 6=Sun
    # Last Monday: if today is Mon (0) → 7 days back; otherwise this week's Monday - 7
    _last_monday = today - timedelta(days=_days_since_monday + 7)
    wk_mon = _last_monday          # Monday  (last week  = week 2)
    wk_tue = _last_monday + timedelta(days=1)
    wk_wed = _last_monday + timedelta(days=2)
    wk_thu = _last_monday + timedelta(days=3)
    wk_fri = _last_monday + timedelta(days=4)
    # Week 1 = the week before week 2 (fully completed)
    wk1_mon = wk_mon - timedelta(days=7)
    wk1_tue = wk1_mon + timedelta(days=1)
    wk1_wed = wk1_mon + timedelta(days=2)
    wk1_thu = wk1_mon + timedelta(days=3)
    wk1_fri = wk1_mon + timedelta(days=4)

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
    # 1b. Workflow settings — enable planning dates for demo
    # ------------------------------------------------------------------
    wf = get_workflow_settings(company)
    wf.order_dates_enabled = True
    wf.production_complete_immediately = True
    wf.save()

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
        # avg_cost from PZ history: 150kg@2.00 + 100kg@2.05 = weighted avg 2.02
        avg_cost=Decimal("2.0200"), last_cost=Decimal("2.05"),
        avg_cost_source=Product.COST_SOURCE_PZ,
    )
    cukier = Product.objects.create(
        company=company, user=user,
        name="Cukier biały", unit="kg",
        product_type=Product.PRODUCT_TYPE_MATERIAL,
        price_net=Decimal("3.60"), price_gross=Decimal("3.89"), vat_rate=Decimal("8.00"),
        # avg_cost from PZ history: 50kg@3.40
        avg_cost=Decimal("3.4000"), last_cost=Decimal("3.40"),
        avg_cost_source=Product.COST_SOURCE_PZ,
    )
    maslo = Product.objects.create(
        company=company, user=user,
        name="Masło extra 82%", unit="kg",
        product_type=Product.PRODUCT_TYPE_MATERIAL,
        price_net=Decimal("20.00"), price_gross=Decimal("21.60"), vat_rate=Decimal("8.00"),
        # avg_cost from PZ history: 30kg@19.00 + 20kg@19.50 = weighted avg 19.20
        avg_cost=Decimal("19.2000"), last_cost=Decimal("19.50"),
        avg_cost_source=Product.COST_SOURCE_PZ,
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
    chleb_zytni = Product.objects.create(
        company=company, user=user,
        name="Chleb żytni 500g", unit="szt",
        product_type=Product.PRODUCT_TYPE_FINISHED,
        price_net=Decimal("5.00"), price_gross=Decimal("5.40"), vat_rate=Decimal("8.00"),
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

    # Opening stock for raw materials only.
    # Sized to cover all production runs AND leave realistic end-of-week balances:
    #   maka:   740 kg opening + pz1(150) + pz2(100) → ~250 kg remaining (target 250–320 kg)
    #   cukier:  70 kg opening + pz1(50)              → ~79 kg remaining  (target 80–110 kg)
    #   maslo:   25 kg opening + pz1(30) + pz2(20)    → ~43 kg remaining  (target 40–55 kg)
    # Finished goods (chleb, bulka, rogal, drozdzowka, tort) are NOT seeded here —
    # they will be created automatically via complete_production_order() PW receipts.
    for product, qty in [
        (maka,   "740.00"),
        (cukier,  "70.00"),
        (maslo,   "25.00"),
        (torba, "200.00"),
        (pudelko, "30.00"),
    ]:
        ProductStock.objects.create(
            company=company,
            product=product,
            warehouse=wh_main,
            quantity_available=Decimal(qty),
            quantity_reserved=Decimal("0.00"),
        )

    # Opening StockBatches for FIFO — one batch per raw material at avg_cost from first PZ.
    # These represent stock on hand before the first purchase delivery (pz1 at m1+3).
    _opening_date = m1 - timedelta(days=1)
    for product, qty, unit_cost in [
        (maka,   Decimal("740.00"), Decimal("2.00")),
        (cukier,  Decimal("70.00"), Decimal("3.40")),
        (maslo,   Decimal("25.00"), Decimal("19.00")),
    ]:
        StockBatch.objects.create(
            company=company,
            product=product,
            warehouse=wh_main,
            batch_number=f"OTWARCIE-{product.name[:6].upper()}",
            received_date=_opening_date,
            quantity_initial=qty,
            quantity_remaining=qty,
            unit_cost=unit_cost,
        )

    # Opening StockMovement ADJUSTMENT for each raw material (opening balance record).
    for product, qty_str in [
        (maka,   "740.00"),
        (cukier,  "70.00"),
        (maslo,   "25.00"),
    ]:
        StockMovement.objects.create(
            company=company,
            product=product,
            warehouse=wh_main,
            user=user,
            movement_type=StockMovement.MovementType.ADJUSTMENT,
            quantity=Decimal(qty_str),
            quantity_before=Decimal("0"),
            quantity_after=Decimal(qty_str),
            notes="Stan otwarcia — saldo początkowe",
            created_by=user,
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

    # Apply PZ receipts through the proper service so StockBatch (FIFO) records
    # and StockMovement(PURCHASE) are created consistently.
    from apps.delivery.services import apply_pz_receipt
    apply_pz_receipt(pz1, user)
    apply_pz_receipt(pz2, user)

    # ------------------------------------------------------------------
    # 7. Orders
    # ------------------------------------------------------------------
    # Scenario: realistic bakery work week (last full Mon-Fri week before today).
    # Orders arrive the evening before for next-morning delivery.
    # Mon-Wed: fully completed (PRD → WZ delivered → FV paid).
    # Thu: delivered (WZ), invoice issued but not yet paid.
    # Fri: confirmed, production planned (PRD draft), delivery pending — no WZ/FV.
    # Next week (Mon): one open order without any PRD — shows "unscheduled" in report.
    # Previous month: two completed invoiced orders for historical context.
    # ------------------------------------------------------------------

    def _make_order(customer, order_date, delivery_date, status, items,
                    production_date=None, shipment_date=None):
        order = Order.objects.create(
            company=company, user=user,
            customer=customer,
            order_date=order_date,
            delivery_date=delivery_date,
            production_date=production_date,
            shipment_date=shipment_date,
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
        return order

    # ── Previous month — historical, fully invoiced ──────────────────
    # m1: two orders, both invoiced and paid
    order_m1a = _make_order(
        sklep, m1 + timedelta(days=2), m1 + timedelta(days=3),
        Order.STATUS_INVOICED,
        [(chleb, 100, "4.50"), (bulka, 200, "0.80"), (rogal, 150, "1.20")],
        production_date=m1 + timedelta(days=1), shipment_date=m1 + timedelta(days=2),
    )
    order_m1b = _make_order(
        hotel, m1 + timedelta(days=11), m1 + timedelta(days=12),
        Order.STATUS_INVOICED,
        [(chleb, 60, "4.50"), (drozdzowka, 80, "2.00"), (tort, 4, "85.00")],
        production_date=m1 + timedelta(days=10), shipment_date=m1 + timedelta(days=11),
    )

    # ── Current month before the work week — invoiced ────────────────
    order_m2a = _make_order(
        kawiarnia, m2 + timedelta(days=1), m2 + timedelta(days=2),
        Order.STATUS_INVOICED,
        [(drozdzowka, 60, "2.00"), (rogal, 80, "1.20"), (tort, 2, "85.00")],
        production_date=m2, shipment_date=m2 + timedelta(days=1),
    )
    order_m2b = _make_order(
        przedszkole, m2 + timedelta(days=4), m2 + timedelta(days=5),
        Order.STATUS_INVOICED,
        [(chleb, 80, "4.50"), (bulka, 150, "0.80"), (rogal, 60, "1.20")],
        production_date=m2 + timedelta(days=3), shipment_date=m2 + timedelta(days=4),
    )

    # ── Week 1 (fully completed, 2 weeks ago) ───────────────────────
    wk1_mon = wk_mon - timedelta(days=7)
    wk1_tue = wk1_mon + timedelta(days=1)
    wk1_wed = wk1_mon + timedelta(days=2)
    wk1_thu = wk1_mon + timedelta(days=3)
    wk1_fri = wk1_mon + timedelta(days=4)

    # wk1_mon deliveries: Sklep + Przedszkole
    order_wk1_mon_sklep = _make_order(
        sklep, wk1_mon - timedelta(days=2), wk1_mon,
        Order.STATUS_INVOICED,
        [(chleb, 80, "4.50"), (bulka, 150, "0.80")],
        production_date=wk1_mon - timedelta(days=2), shipment_date=wk1_mon - timedelta(days=1),
    )
    order_wk1_mon_przed = _make_order(
        przedszkole, wk1_mon - timedelta(days=2), wk1_mon,
        Order.STATUS_INVOICED,
        [(chleb, 50, "4.50"), (bulka, 100, "0.80")],
        production_date=wk1_mon - timedelta(days=2), shipment_date=wk1_mon - timedelta(days=1),
    )
    # wk1_wed deliveries: Bar + Kawiarnia
    order_wk1_wed_bar = _make_order(
        bar, wk1_wed - timedelta(days=2), wk1_wed,
        Order.STATUS_INVOICED,
        [(chleb, 60, "4.50"), (bulka, 80, "0.80"), (rogal, 60, "1.20")],
        production_date=wk1_wed - timedelta(days=2), shipment_date=wk1_wed - timedelta(days=1),
    )
    order_wk1_wed_kaw = _make_order(
        kawiarnia, wk1_wed - timedelta(days=2), wk1_wed,
        Order.STATUS_INVOICED,
        [(rogal, 80, "1.20"), (drozdzowka, 48, "2.00")],
        production_date=wk1_wed - timedelta(days=2), shipment_date=wk1_wed - timedelta(days=1),
    )
    # wk1_fri deliveries: Sklep + Bistro
    order_wk1_fri_sklep = _make_order(
        sklep, wk1_fri - timedelta(days=2), wk1_fri,
        Order.STATUS_INVOICED,
        [(chleb, 100, "4.50"), (bulka, 120, "0.80"), (rogal, 80, "1.20")],
        production_date=wk1_fri - timedelta(days=2), shipment_date=wk1_fri - timedelta(days=1),
    )
    order_wk1_fri_bistro = _make_order(
        bistro, wk1_fri - timedelta(days=2), wk1_fri,
        Order.STATUS_INVOICED,
        [(rogal, 60, "1.20"), (drozdzowka, 36, "2.00")],
        production_date=wk1_fri - timedelta(days=2), shipment_date=wk1_fri - timedelta(days=1),
    )

    # ── Week 2 (last full work week, in progress) ────────────────────
    order_mon_sklep = _make_order(
        sklep, wk_mon - timedelta(days=2), wk_mon,
        Order.STATUS_INVOICED,
        [(chleb, 100, "4.50"), (bulka, 200, "0.80")],
        production_date=wk_mon - timedelta(days=2), shipment_date=wk_mon - timedelta(days=1),
    )
    order_mon_hotel = _make_order(
        hotel, wk_mon - timedelta(days=2), wk_mon,
        Order.STATUS_INVOICED,
        [(chleb, 80, "4.50"), (rogal, 60, "1.20")],
        production_date=wk_mon - timedelta(days=2), shipment_date=wk_mon - timedelta(days=1),
    )
    # Tuesday: Bar — delivered, no invoice yet
    order_tue = _make_order(
        bar, wk_mon - timedelta(days=1), wk_tue,
        Order.STATUS_DELIVERED,
        [(chleb, 60, "4.50"), (bulka, 100, "0.80")],
        production_date=wk_mon - timedelta(days=1), shipment_date=wk_tue - timedelta(days=1),
    )
    # Wednesday: Kawiarnia + Przedszkole — delivered, no invoice yet
    order_wed_kaw = _make_order(
        kawiarnia, wk_tue - timedelta(days=1), wk_wed,
        Order.STATUS_DELIVERED,
        [(rogal, 80, "1.20"), (drozdzowka, 60, "2.00")],
        production_date=wk_tue, shipment_date=wk_wed,
    )
    order_wed_przed = _make_order(
        przedszkole, wk_tue - timedelta(days=1), wk_wed,
        Order.STATUS_DELIVERED,
        [(chleb, 60, "4.50"), (bulka, 80, "0.80")],
        production_date=wk_tue, shipment_date=wk_wed,
    )
    # Thursday: Restauracja — STATUS_DELIVERED
    order_thu = _make_order(
        restauracja, wk_wed - timedelta(days=1), wk_thu,
        Order.STATUS_DELIVERED,
        [(chleb, 50, "4.50"), (rogal, 40, "1.20")],
        production_date=wk_wed, shipment_date=wk_thu,
    )
    # Friday: Hotel — STATUS_DELIVERED
    order_fri = _make_order(
        hotel, wk_thu - timedelta(days=1), wk_fri,
        Order.STATUS_DELIVERED,
        [(drozdzowka, 48, "2.00"), (tort, 2, "85.00")],
        production_date=wk_thu, shipment_date=wk_fri,
    )
    # Next Monday (relative to today): Bistro + Sklep
    _next_mon = today + timedelta(days=(7 - today.weekday()))
    _next_tue = _next_mon + timedelta(days=1)
    order_next_mon = _make_order(
        bistro, today, _next_mon,
        Order.STATUS_CONFIRMED,
        [(rogal, 100, "1.20"), (bulka, 120, "0.80")],
        production_date=_next_mon - timedelta(days=1),
        shipment_date=_next_mon,
    )
    # Next Monday: Sklep
    order_next_mon_sklep = _make_order(
        sklep, today, _next_mon,
        Order.STATUS_CONFIRMED,
        [(chleb, 50, "4.50"), (bulka, 80, "0.80")],
        production_date=_next_mon - timedelta(days=1),
        shipment_date=_next_mon,
    )
    # Next Tuesday: Kawiarnia
    order_next_tue_kaw = _make_order(
        kawiarnia, today, _next_tue,
        Order.STATUS_CONFIRMED,
        [(rogal, 40, "1.20"), (drozdzowka, 24, "2.00")],
        production_date=_next_tue - timedelta(days=1),
        shipment_date=_next_tue,
    )
    # Next Tuesday: Przedszkole
    order_next_tue_przed = _make_order(
        przedszkole, today, _next_tue,
        Order.STATUS_CONFIRMED,
        [(chleb, 40, "4.50"), (bulka, 60, "0.80")],
        production_date=_next_tue - timedelta(days=1),
        shipment_date=_next_tue,
    )
    # TODAY delivery: Bar Centrum — ordered 2 days ago, production today morning
    order_today_bar = _make_order(
        bar, today - timedelta(days=2), today,
        Order.STATUS_CONFIRMED,
        [(rogal, 30, "1.20"), (drozdzowka, 12, "2.00")],
        production_date=today, shipment_date=today,
    )
    # TODAY delivery: Hotel Złoty — ordered 2 days ago, production today morning
    order_today_hotel = _make_order(
        hotel, today - timedelta(days=2), today,
        Order.STATUS_CONFIRMED,
        [(chleb, 20, "4.50"), (rogal, 40, "1.20")],
        production_date=today, shipment_date=today,
    )
    # TODAY delivery: Kawiarnia Różana — ordered yesterday, production today
    order_today_kaw = _make_order(
        kawiarnia, today - timedelta(days=1), today,
        Order.STATUS_CONFIRMED,
        [(drozdzowka, 36, "2.00"), (rogal, 24, "1.20")],
        production_date=today, shipment_date=today,
    )
    # TODAY delivery: Sklep Spożywczy — ordered 2 days ago, production today
    order_today_sklep = _make_order(
        sklep, today - timedelta(days=2), today,
        Order.STATUS_CONFIRMED,
        [(chleb, 60, "4.50"), (bulka, 120, "0.80"), (chleb_zytni, 30, "5.00")],
        production_date=today, shipment_date=today,
    )
    # TOMORROW delivery: Bistro Pod Lipą — ordered today, production today
    order_tomorrow_bistro = _make_order(
        bistro, today, today + timedelta(days=1),
        Order.STATUS_CONFIRMED,
        [(rogal, 100, "1.20"), (bulka, 80, "0.80")],
        production_date=today, shipment_date=today + timedelta(days=1),
    )
    # TOMORROW delivery: Restauracja Smaczna — ordered today, production today
    order_tomorrow_rest = _make_order(
        restauracja, today, today + timedelta(days=1),
        Order.STATUS_CONFIRMED,
        [(chleb, 40, "4.50"), (rogal, 60, "1.20")],
        production_date=today, shipment_date=today + timedelta(days=1),
    )
    # TOMORROW delivery: Przedszkole Słoneczko — ordered today, production today
    order_tomorrow_przed = _make_order(
        przedszkole, today, today + timedelta(days=1),
        Order.STATUS_CONFIRMED,
        [(chleb, 50, "4.50"), (bulka, 80, "0.80"), (chleb_zytni, 20, "5.00")],
        production_date=today, shipment_date=today + timedelta(days=1),
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

    # _apply_wz_deduction is called AFTER all production orders are completed (section 16),
    # because ProductStock records for finished goods are created by complete_production_order.
    # We collect (wz_doc, items) here and apply them all at the end of section 16.
    _pending_wz_deductions = []

    def _apply_wz_deduction(wz_doc, items_with_qty):
        """
        Deduct finished goods from ProductStock after WZ delivery.
        Also updates quantity_delivered on linked OrderItems so planning
        correctly excludes already-delivered quantities.
        items_with_qty: list of (product, qty) tuples matching the WZ items.
        Must be called AFTER all production orders are completed so ProductStock
        records for finished goods already exist.
        """
        from apps.products.models import ProductStock, StockMovement
        from apps.orders.models import OrderItem
        for product, qty in items_with_qty:
            qty_dec = Decimal(str(qty))
            stock = ProductStock.objects.filter(
                company=company, product=product, warehouse=wh_main
            ).first()
            if stock:
                qty_before = stock.quantity_available
                stock.quantity_available -= qty_dec
                stock.save(update_fields=["quantity_available"])
                StockMovement.objects.create(
                    company=company, product=product, warehouse=wh_main, user=user,
                    movement_type=StockMovement.MovementType.SALE,
                    quantity=-qty_dec,
                    quantity_before=qty_before,
                    quantity_after=stock.quantity_available,
                    reference_type="delivery_document",
                    reference_id=wz_doc.uuid,
                    notes=f"WZ {wz_doc.document_number or ''}",
                    created_by=user,
                )
            # Update quantity_delivered on linked OrderItem so planning excludes delivered qty
            if wz_doc.order_id:
                oi = OrderItem.objects.filter(order_id=wz_doc.order_id, product=product).first()
                if oi:
                    oi.quantity_delivered = (oi.quantity_delivered or Decimal("0")) + qty_dec
                    oi.save(update_fields=["quantity_delivered"])

    # Historical WZs
    wz = _make_wz(order_m1a, m1 + timedelta(days=3), DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 100), (bulka, 200), (rogal, 150)])
    _pending_wz_deductions.append((wz, [(chleb, 100), (bulka, 200), (rogal, 150)]))

    wz = _make_wz(order_m1b, m1 + timedelta(days=12), DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 60), (drozdzowka, 80), (tort, 4)])
    _pending_wz_deductions.append((wz, [(chleb, 60), (drozdzowka, 80), (tort, 4)]))

    wz = _make_wz(order_m2a, m2 + timedelta(days=2), DeliveryDocument.STATUS_DELIVERED,
                  [(drozdzowka, 60), (rogal, 80), (tort, 2)])
    _pending_wz_deductions.append((wz, [(drozdzowka, 60), (rogal, 80), (tort, 2)]))

    wz = _make_wz(order_m2b, m2 + timedelta(days=5), DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 80), (bulka, 150), (rogal, 60)])
    _pending_wz_deductions.append((wz, [(chleb, 80), (bulka, 150), (rogal, 60)]))

    # Week 1 WZs — all STATUS_DELIVERED
    wz = _make_wz(order_wk1_mon_sklep, wk1_mon, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 80), (bulka, 150)])
    _pending_wz_deductions.append((wz, [(chleb, 80), (bulka, 150)]))

    wz = _make_wz(order_wk1_mon_przed, wk1_mon, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 50), (bulka, 100)])
    _pending_wz_deductions.append((wz, [(chleb, 50), (bulka, 100)]))

    wz = _make_wz(order_wk1_wed_bar, wk1_wed, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 60), (bulka, 80), (rogal, 60)])
    _pending_wz_deductions.append((wz, [(chleb, 60), (bulka, 80), (rogal, 60)]))

    wz = _make_wz(order_wk1_wed_kaw, wk1_wed, DeliveryDocument.STATUS_DELIVERED,
                  [(rogal, 80), (drozdzowka, 48)])
    _pending_wz_deductions.append((wz, [(rogal, 80), (drozdzowka, 48)]))

    wz = _make_wz(order_wk1_fri_sklep, wk1_fri, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 100), (bulka, 120), (rogal, 80)])
    _pending_wz_deductions.append((wz, [(chleb, 100), (bulka, 120), (rogal, 80)]))

    wz = _make_wz(order_wk1_fri_bistro, wk1_fri, DeliveryDocument.STATUS_DELIVERED,
                  [(rogal, 60), (drozdzowka, 36)])
    _pending_wz_deductions.append((wz, [(rogal, 60), (drozdzowka, 36)]))

    # Week 2 WZs
    wz = _make_wz(order_mon_sklep, wk_mon, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 100), (bulka, 200)])
    _pending_wz_deductions.append((wz, [(chleb, 100), (bulka, 200)]))

    wz = _make_wz(order_mon_hotel, wk_mon, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 80), (rogal, 60)])
    _pending_wz_deductions.append((wz, [(chleb, 80), (rogal, 60)]))

    wz = _make_wz(order_tue, wk_tue, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 60), (bulka, 100)])
    _pending_wz_deductions.append((wz, [(chleb, 60), (bulka, 100)]))

    wz = _make_wz(order_wed_kaw, wk_wed, DeliveryDocument.STATUS_DELIVERED,
                  [(rogal, 80), (drozdzowka, 60)])
    _pending_wz_deductions.append((wz, [(rogal, 80), (drozdzowka, 60)]))

    wz = _make_wz(order_wed_przed, wk_wed, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 60), (bulka, 80)])
    _pending_wz_deductions.append((wz, [(chleb, 60), (bulka, 80)]))

    # Thursday: delivered, invoice issued not paid
    wz = _make_wz(order_thu, wk_thu, DeliveryDocument.STATUS_DELIVERED,
                  [(chleb, 50), (rogal, 40)])
    _pending_wz_deductions.append((wz, [(chleb, 50), (rogal, 40)]))

    # Friday: draft WZ (not yet delivered — no deduction)
    _make_wz(order_fri, wk_fri, DeliveryDocument.STATUS_DRAFT,
             [(drozdzowka, 48), (tort, 2)])

    # ------------------------------------------------------------------
    # 9. Invoices
    # ------------------------------------------------------------------
    inv_seq = [0]  # mutable counter

    def _make_invoice(customer, order, issue_date, status, items, ksef_status=None, due_days=14):
        inv_seq[0] += 1
        invoice_number = f"FV/{issue_date.year}/{inv_seq[0]:04d}"
        if ksef_status is None:
            ksef_status = "accepted" if status in (Invoice.STATUS_PAID, Invoice.STATUS_ISSUED) else "not_sent"
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
        if order is not None:
            from apps.orders.models import Order as OrderModel
            OrderModel.objects.filter(pk=order.pk).update(status=OrderModel.STATUS_INVOICED)
        return inv

    # Historical invoices — m1
    _make_invoice(sklep, order_m1a, m1 + timedelta(days=4), Invoice.STATUS_PAID,
                  [(chleb, 100, "4.50"), (bulka, 200, "0.80"), (rogal, 150, "1.20")])
    _make_invoice(hotel, order_m1b, m1 + timedelta(days=13), Invoice.STATUS_PAID,
                  [(chleb, 60, "4.50"), (drozdzowka, 80, "2.00"), (tort, 4, "85.00")])
    # Extra m1 sales — bar and przedszkole (no linked order, weekly settlement)
    _make_invoice(bar, None, m1 + timedelta(days=7), Invoice.STATUS_PAID,
                  [(bulka, 500, "0.80"), (rogal, 300, "1.20"), (chleb, 150, "4.50")])
    _make_invoice(przedszkole, None, m1 + timedelta(days=16), Invoice.STATUS_PAID,
                  [(chleb, 200, "4.50"), (bulka, 400, "0.80"), (rogal, 100, "1.20")])

    # Current month — m2 before work week
    _make_invoice(kawiarnia, order_m2a, m2 + timedelta(days=3), Invoice.STATUS_PAID,
                  [(drozdzowka, 60, "2.00"), (rogal, 80, "1.20"), (tort, 2, "85.00")])
    _make_invoice(przedszkole, order_m2b, m2 + timedelta(days=6), Invoice.STATUS_PAID,
                  [(chleb, 80, "4.50"), (bulka, 150, "0.80"), (rogal, 60, "1.20")])
    # Extra m2 weekly settlements
    _make_invoice(sklep, None, m2 + timedelta(days=8), Invoice.STATUS_PAID,
                  [(chleb, 300, "4.50"), (bulka, 600, "0.80"), (rogal, 400, "1.20")])
    _make_invoice(hotel, None, m2 + timedelta(days=10), Invoice.STATUS_PAID,
                  [(tort, 8, "85.00"), (chleb, 100, "4.50"), (drozdzowka, 100, "2.00")])

    # Week 1 invoices — all STATUS_PAID (issued 1-2 days after WZ)
    _make_invoice(sklep, order_wk1_mon_sklep, wk1_mon + timedelta(days=1), Invoice.STATUS_PAID,
                  [(chleb, 80, "4.50"), (bulka, 150, "0.80")])
    _make_invoice(przedszkole, order_wk1_mon_przed, wk1_mon + timedelta(days=1), Invoice.STATUS_PAID,
                  [(chleb, 50, "4.50"), (bulka, 100, "0.80")])
    _make_invoice(bar, order_wk1_wed_bar, wk1_wed + timedelta(days=1), Invoice.STATUS_PAID,
                  [(chleb, 60, "4.50"), (bulka, 80, "0.80"), (rogal, 60, "1.20")])
    _make_invoice(kawiarnia, order_wk1_wed_kaw, wk1_wed + timedelta(days=1), Invoice.STATUS_PAID,
                  [(rogal, 80, "1.20"), (drozdzowka, 48, "2.00")])
    _make_invoice(sklep, order_wk1_fri_sklep, wk1_fri + timedelta(days=1), Invoice.STATUS_PAID,
                  [(chleb, 100, "4.50"), (bulka, 120, "0.80"), (rogal, 80, "1.20")])
    _make_invoice(bistro, order_wk1_fri_bistro, wk1_fri + timedelta(days=1), Invoice.STATUS_PAID,
                  [(rogal, 60, "1.20"), (drozdzowka, 36, "2.00")])

    # Week 2 Mon — issued, not yet paid (14-day term)
    _make_invoice(sklep, order_mon_sklep, wk_mon + timedelta(days=1), Invoice.STATUS_ISSUED,
                  [(chleb, 100, "4.50"), (bulka, 200, "0.80")])
    _make_invoice(hotel, order_mon_hotel, wk_mon + timedelta(days=1), Invoice.STATUS_ISSUED,
                  [(chleb, 80, "4.50"), (rogal, 60, "1.20")])
    # Week 2 Tue (Bar) — WZ delivered, no invoice yet → STATUS_DELIVERED stays
    # Week 2 Wed (Kawiarnia, Przedszkole) — WZ delivered, no invoice yet → STATUS_DELIVERED stays

    # Thursday: invoice issued (not paid yet — standard 14-day term)
    _make_invoice(restauracja, order_thu, wk_thu, Invoice.STATUS_ISSUED,
                  [(chleb, 50, "4.50"), (rogal, 40, "1.20")])

    # Overdue invoice: Bistro (older, term expired)
    inv_overdue = _make_invoice(
        bistro, None, m1 + timedelta(days=5), Invoice.STATUS_ISSUED,
        [(drozdzowka, 80, "2.00"), (rogal, 60, "1.20")],
        due_days=7,
    )
    inv_overdue.status = Invoice.STATUS_OVERDUE
    inv_overdue.save(update_fields=["status", "updated_at"])

    # Another overdue: Restauracja
    inv_overdue2 = _make_invoice(
        restauracja, None, m2 + timedelta(days=1), Invoice.STATUS_ISSUED,
        [(chleb, 80, "4.50"), (bulka, 150, "0.80")],
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
            _unit_costs = {
            str(chleb.id):      Decimal("1.42"),
            str(bulka.id):      Decimal("0.22"),
            str(rogal.id):      Decimal("0.55"),
            str(drozdzowka.id): Decimal("0.70"),
            str(tort.id):       Decimal("32.00"),
        }
        unit_cost = float(_unit_costs.get(str(product.id), Decimal("0")))
        line_cost = unit_cost * qty
        lines.append({
                "product_id": str(product.id),
                "name": product.name,
                "qty": qty,
                "unit_price": float(unit_price),
                "unit_cost": unit_cost,
                "line_revenue": float(line_revenue),
                "line_cost": line_cost,
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
            {"product_id": str(chleb.id), "product_name": chleb.name, "unit": chleb.unit, "qty": 45, "unit_price": float(chleb.price_gross), "unit_cost": 1.42},
            {"product_id": str(bulka.id), "product_name": bulka.name, "unit": bulka.unit, "qty": 120, "unit_price": float(bulka.price_gross), "unit_cost": 0.22},
            {"product_id": str(rogal.id), "product_name": rogal.name, "unit": rogal.unit, "qty": 40, "unit_price": float(rogal.price_gross), "unit_cost": 0.55},
            {"product_id": str(drozdzowka.id), "product_name": drozdzowka.name, "unit": drozdzowka.unit, "qty": 25, "unit_price": float(drozdzowka.price_gross), "unit_cost": 0.70},
        ],
    )
    SalesReportTemplate.objects.create(
        company=company,
        name="Targ Stary Kleparz",
        is_default=False,
        lines=[
            {"product_id": str(chleb.id), "product_name": chleb.name, "unit": chleb.unit, "qty": 80, "unit_price": float(chleb.price_gross), "unit_cost": 1.42},
            {"product_id": str(bulka.id), "product_name": bulka.name, "unit": bulka.unit, "qty": 200, "unit_price": float(bulka.price_gross), "unit_cost": 0.22},
            {"product_id": str(rogal.id), "product_name": rogal.name, "unit": rogal.unit, "qty": 60, "unit_price": float(rogal.price_gross), "unit_cost": 0.55},
            {"product_id": str(drozdzowka.id), "product_name": drozdzowka.name, "unit": drozdzowka.unit, "qty": 40, "unit_price": float(drozdzowka.price_gross), "unit_cost": 0.70},
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
    route1.orders.set([order_m1a])

    route2 = VanRoute.objects.create(
        company=company,
        user=user,
        date=m2 + timedelta(days=5),
        driver_name="Marek Wiśniewski",
        van_name="WY 12345",
        van_warehouse=wh_van,
        main_warehouse=wh_main,
        status=VanRoute.STATUS_CLOSED,
    )
    route2.orders.set([order_m2b])

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
    RecipeItem.objects.create(recipe=recipe_chleb, ingredient=maka,
                               quantity=Decimal("6.00"), unit="kg")   # 6 kg mąki na 10 chlebów
    RecipeItem.objects.create(recipe=recipe_chleb, ingredient=cukier,
                               quantity=Decimal("0.20"), unit="kg")   # 0.2 kg cukru

    recipe_chleb_zytni = Recipe.objects.create(
        company=company,
        product=chleb_zytni,
        name="Chleb żytni 500g",
        yield_quantity=Decimal("10"),  # one batch = 10 bochenków
        notes="Chleb żytni na zakwasie żytnim.",
    )
    RecipeItem.objects.create(recipe=recipe_chleb_zytni, ingredient=maka,
                               quantity=Decimal("7.00"), unit="kg")   # 7 kg mąki na 10 chlebów
    RecipeItem.objects.create(recipe=recipe_chleb_zytni, ingredient=cukier,
                               quantity=Decimal("0.10"), unit="kg")

    recipe_bulka = Recipe.objects.create(
        company=company,
        product=bulka,
        name="Bułka pszenna",
        yield_quantity=Decimal("20"),  # one batch = 20 bułek
        notes="Pszenna bułka kajzerka.",
    )
    RecipeItem.objects.create(recipe=recipe_bulka, ingredient=maka,
                               quantity=Decimal("1.00"), unit="kg")   # 1 kg mąki na 20 bułek

    recipe_rogal = Recipe.objects.create(
        company=company,
        product=rogal,
        name="Rogal maślany",
        yield_quantity=Decimal("20"),  # one batch = 20 rogali
        notes="Delikatny rogal z masłem, posypany cukrem pudrem.",
    )
    RecipeItem.objects.create(recipe=recipe_rogal, ingredient=maka,
                               quantity=Decimal("2.00"), unit="kg")   # 2 kg mąki na 20 rogali
    RecipeItem.objects.create(recipe=recipe_rogal, ingredient=maslo,
                               quantity=Decimal("0.60"), unit="kg")   # 0.6 kg masła
    RecipeItem.objects.create(recipe=recipe_rogal, ingredient=cukier,
                               quantity=Decimal("0.30"), unit="kg")   # 0.3 kg cukru

    recipe_drozdzowka = Recipe.objects.create(
        company=company,
        product=drozdzowka,
        name="Drożdżówka z serem",
        yield_quantity=Decimal("12"),  # one batch = 12 drożdżówek
        notes="Drożdżówki z nadzieniem serowym, posypane cukrem pudrem.",
    )
    RecipeItem.objects.create(recipe=recipe_drozdzowka, ingredient=maka,
                               quantity=Decimal("1.50"), unit="kg")
    RecipeItem.objects.create(recipe=recipe_drozdzowka, ingredient=maslo,
                               quantity=Decimal("0.20"), unit="kg")
    RecipeItem.objects.create(recipe=recipe_drozdzowka, ingredient=cukier,
                               quantity=Decimal("0.25"), unit="kg")

    recipe_tort = Recipe.objects.create(
        company=company,
        product=tort,
        name="Tort urodzinowy",
        yield_quantity=Decimal("1"),  # one batch = 1 tort
        notes="Tort biszkoptowy z masą maślaną.",
    )
    RecipeItem.objects.create(recipe=recipe_tort, ingredient=maka,
                               quantity=Decimal("0.30"), unit="kg")
    RecipeItem.objects.create(recipe=recipe_tort, ingredient=maslo,
                               quantity=Decimal("0.25"), unit="kg")
    RecipeItem.objects.create(recipe=recipe_tort, ingredient=cukier,
                               quantity=Decimal("0.40"), unit="kg")

    # ------------------------------------------------------------------
    # 16. Production orders (zlecenia produkcji)
    # ------------------------------------------------------------------
    # Helper: complete a production order with a historical date.
    # Patches timezone.now() / timezone.localdate() so the service uses
    # the given target_date as the RW/PW issue_date instead of today.
    def _complete_prd_on_date(order, target_date):
        fake_dt = _dt.datetime.combine(target_date, _dt.time(6, 0))
        fake_now = timezone.make_aware(fake_dt)
        with patch("apps.production.services.timezone") as mock_tz:
            mock_tz.now.return_value = fake_now
            mock_tz.localdate.return_value = target_date
            mock_tz.make_aware.side_effect = timezone.make_aware
            from apps.production.services import complete_production_order
            return complete_production_order(order, user)

    # ── Historical production — m1 ───────────────────────────────────
    # m1 day 1: 100 chleb, 200 bułek, 150 rogali — for order_m1a
    prod_chleb_m1 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=m1 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("100"),
        notes="Produkcja poranna — chleby wiejskie",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_m1, order=order_m1a, quantity=Decimal("100"),
    )
    _complete_prd_on_date(prod_chleb_m1, m1 + timedelta(days=1))

    prod_bulka_m1 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=m1 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("200"),
        notes="Produkcja poranna — bułki pszenne",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_m1, order=order_m1a, quantity=Decimal("200"),
    )
    _complete_prd_on_date(prod_bulka_m1, m1 + timedelta(days=1))

    prod_rogal_m1 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=m1 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("150"),
        notes="Produkcja poranna — rogale maślane",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_m1, order=order_m1a, quantity=Decimal("150"),
    )
    _complete_prd_on_date(prod_rogal_m1, m1 + timedelta(days=1))

    # m1 day 11: for order_m1b — chleb, drożdżówki, tort
    prod_chleb_m1b = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=m1 + timedelta(days=11),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja — chleb dla Hotelu Złoty",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_m1b, order=order_m1b, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_chleb_m1b, m1 + timedelta(days=11))

    prod_drozdzowka_m1 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=m1 + timedelta(days=11),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja — drożdżówki dla Hotelu Złoty",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_m1, order=order_m1b, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_drozdzowka_m1, m1 + timedelta(days=11))

    prod_tort_m1 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_tort, date=m1 + timedelta(days=11),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("4"),
        notes="Produkcja — torty dla Hotelu Złoty",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_tort_m1, order=order_m1b, quantity=Decimal("4"),
    )
    _complete_prd_on_date(prod_tort_m1, m1 + timedelta(days=11))

    # ── Current month before work week — m2 ─────────────────────────
    # m2 day 1: for order_m2a — drożdżówki, rogale, tort
    prod_drozdzowka_m2 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=m2 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna — drożdżówki dla Kawiarni",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_m2, order=order_m2a, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_drozdzowka_m2, m2 + timedelta(days=1))

    # Shared PRD for two orders — shows "wspólne" badge in report
    prod_rogal_m2 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=m2 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("140"),  # 80 (kawiarnia) + 60 (przedszkole)
        notes="Produkcja poranna — rogale (Kawiarnia Różana + Przedszkole Słoneczko)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_m2, order=order_m2a, quantity=Decimal("80"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_m2, order=order_m2b, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_rogal_m2, m2 + timedelta(days=1))

    prod_tort_m2 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_tort, date=m2 + timedelta(days=1),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("2"),
        notes="Produkcja — tort urodzinowy dla Kawiarni Różanej",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_tort_m2, order=order_m2a, quantity=Decimal("2"),
    )
    _complete_prd_on_date(prod_tort_m2, m2 + timedelta(days=1))

    # m2 day 4: for order_m2b — chleb, bułki
    prod_chleb_m2 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=m2 + timedelta(days=4),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja — chleby dla Przedszkola Słoneczko",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_m2, order=order_m2b, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_chleb_m2, m2 + timedelta(days=4))

    prod_bulka_m2 = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=m2 + timedelta(days=4),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("150"),
        notes="Produkcja — bułki dla Przedszkola Słoneczko",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_m2, order=order_m2b, quantity=Decimal("150"),
    )
    _complete_prd_on_date(prod_bulka_m2, m2 + timedelta(days=4))

    # ── Week 1 production (fully completed, 2 weeks ago) ────────────
    # wk1_mon: PRD chleba 130 szt (Sklep 80 + Przedszkole 50) — WSPÓLNE
    prod_chleb_wk1_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk1_mon,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("130"),
        notes="Produkcja poranna poniedziałek tyg1 — chleby (Sklep + Przedszkole)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_wk1_mon, order=order_wk1_mon_sklep, quantity=Decimal("80"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_wk1_mon, order=order_wk1_mon_przed, quantity=Decimal("50"),
    )
    _complete_prd_on_date(prod_chleb_wk1_mon, wk1_mon)

    # wk1_mon: PRD bułek 250 szt (Sklep 150 + Przedszkole 100) — WSPÓLNE
    prod_bulka_wk1_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk1_mon,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("250"),
        notes="Produkcja poranna poniedziałek tyg1 — bułki (Sklep + Przedszkole)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_wk1_mon, order=order_wk1_mon_sklep, quantity=Decimal("150"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_wk1_mon, order=order_wk1_mon_przed, quantity=Decimal("100"),
    )
    _complete_prd_on_date(prod_bulka_wk1_mon, wk1_mon)

    # wk1_wed: PRD chleba 60 szt (Bar)
    prod_chleb_wk1_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk1_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna środa tyg1 — chleby (Bar)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_wk1_wed, order=order_wk1_wed_bar, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_chleb_wk1_wed, wk1_wed)

    # wk1_wed: PRD bułek 80 szt (Bar)
    prod_bulka_wk1_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk1_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja poranna środa tyg1 — bułki (Bar)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_wk1_wed, order=order_wk1_wed_bar, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_bulka_wk1_wed, wk1_wed)

    # wk1_wed: PRD rogali 140 szt (Bar 60 + Kawiarnia 80) — WSPÓLNE
    prod_rogal_wk1_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk1_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("140"),
        notes="Produkcja poranna środa tyg1 — rogale (Bar + Kawiarnia)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_wk1_wed, order=order_wk1_wed_bar, quantity=Decimal("60"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_wk1_wed, order=order_wk1_wed_kaw, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_rogal_wk1_wed, wk1_wed)

    # wk1_wed: PRD drożdżówek 48 szt (Kawiarnia)
    prod_drozdzowka_wk1_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=wk1_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("48"),
        notes="Produkcja poranna środa tyg1 — drożdżówki (Kawiarnia)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_wk1_wed, order=order_wk1_wed_kaw, quantity=Decimal("48"),
    )
    _complete_prd_on_date(prod_drozdzowka_wk1_wed, wk1_wed)

    # wk1_fri: PRD chleba 100 szt (Sklep)
    prod_chleb_wk1_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk1_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("100"),
        notes="Produkcja poranna piątek tyg1 — chleby (Sklep)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_wk1_fri, order=order_wk1_fri_sklep, quantity=Decimal("100"),
    )
    _complete_prd_on_date(prod_chleb_wk1_fri, wk1_fri)

    # wk1_fri: PRD bułek 120 szt (Sklep)
    prod_bulka_wk1_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk1_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("120"),
        notes="Produkcja poranna piątek tyg1 — bułki (Sklep)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_wk1_fri, order=order_wk1_fri_sklep, quantity=Decimal("120"),
    )
    _complete_prd_on_date(prod_bulka_wk1_fri, wk1_fri)

    # wk1_fri: PRD rogali 140 szt (Sklep 80 + Bistro 60) — WSPÓLNE
    prod_rogal_wk1_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk1_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("140"),
        notes="Produkcja poranna piątek tyg1 — rogale (Sklep + Bistro)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_wk1_fri, order=order_wk1_fri_sklep, quantity=Decimal("80"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_wk1_fri, order=order_wk1_fri_bistro, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_rogal_wk1_fri, wk1_fri)

    # wk1_fri: PRD drożdżówek 36 szt (Bistro)
    prod_drozdzowka_wk1_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=wk1_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("36"),
        notes="Produkcja poranna piątek tyg1 — drożdżówki (Bistro)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_wk1_fri, order=order_wk1_fri_bistro, quantity=Decimal("36"),
    )
    _complete_prd_on_date(prod_drozdzowka_wk1_fri, wk1_fri)

    # ── Week 2 production (last full work week) ──────────────────────
    # wk_mon: PRD chleba 180 szt (Sklep 100 + Hotel 80) — WSPÓLNE
    prod_chleb_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk_mon,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("180"),
        notes="Produkcja poranna poniedziałek — chleby wiejskie (Sklep + Hotel)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_mon, order=order_mon_sklep, quantity=Decimal("100"),
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_mon, order=order_mon_hotel, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_chleb_mon, wk_mon)

    # wk_mon: PRD bułek 200 szt (Sklep)
    prod_bulka_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk_mon,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("200"),
        notes="Produkcja poranna poniedziałek — bułki pszenne (Sklep)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_mon, order=order_mon_sklep, quantity=Decimal("200"),
    )
    _complete_prd_on_date(prod_bulka_mon, wk_mon)

    # wk_mon: PRD rogali 60 szt (Hotel)
    prod_rogal_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk_mon,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna poniedziałek — rogale maślane (Hotel)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_mon, order=order_mon_hotel, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_rogal_mon, wk_mon)

    # wk_tue: PRD chleba 60 szt (Bar)
    prod_chleb_tue = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk_tue,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna wtorek — chleby wiejskie (Bar)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_tue, order=order_tue, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_chleb_tue, wk_tue)

    # wk_tue: PRD bułek 100 szt (Bar)
    prod_bulka_tue = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk_tue,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("100"),
        notes="Produkcja poranna wtorek — bułki pszenne (Bar)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_tue, order=order_tue, quantity=Decimal("100"),
    )
    _complete_prd_on_date(prod_bulka_tue, wk_tue)

    # wk_wed: PRD rogali 80 szt (Kawiarnia)
    prod_rogal_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja poranna środa — rogale maślane (Kawiarnia)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_wed, order=order_wed_kaw, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_rogal_wed, wk_wed)

    # wk_wed: PRD drożdżówek 60 szt (Kawiarnia)
    prod_drozdzowka_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=wk_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna środa — drożdżówki (Kawiarnia)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_wed, order=order_wed_kaw, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_drozdzowka_wed, wk_wed)

    # wk_wed: PRD chleba 60 szt (Przedszkole)
    prod_chleb_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna środa — chleby wiejskie (Przedszkole)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_wed, order=order_wed_przed, quantity=Decimal("60"),
    )
    _complete_prd_on_date(prod_chleb_wed, wk_wed)

    # wk_wed: PRD bułek 80 szt (Przedszkole)
    prod_bulka_wed = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk_wed,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja poranna środa — bułki pszenne (Przedszkole)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_wed, order=order_wed_przed, quantity=Decimal("80"),
    )
    _complete_prd_on_date(prod_bulka_wed, wk_wed)

    # wk_thu: PRD chleba 50 szt (Restauracja)
    prod_chleb_thu = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk_thu,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("50"),
        notes="Produkcja poranna czwartek — chleby wiejskie (Restauracja)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_chleb_thu, order=order_thu, quantity=Decimal("50"),
    )
    _complete_prd_on_date(prod_chleb_thu, wk_thu)

    # wk_thu: PRD rogali 40 szt (Restauracja)
    prod_rogal_thu = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk_thu,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("40"),
        notes="Produkcja poranna czwartek — rogale maślane (Restauracja)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_rogal_thu, order=order_thu, quantity=Decimal("40"),
    )
    _complete_prd_on_date(prod_rogal_thu, wk_thu)

    # wk_fri: PRD chleba 40 szt — poranna partia dla sklepu przy piekarni (sprzedaż detaliczna)
    prod_chleb_fri_retail = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_chleb, date=wk_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("40"),
        notes="Produkcja poranna piątek — chleby wiejskie (sklep detaliczny)",
    )
    _complete_prd_on_date(prod_chleb_fri_retail, wk_fri)

    # wk_fri: PRD bułek 80 szt — poranna partia dla sklepu przy piekarni (sprzedaż detaliczna)
    prod_bulka_fri_retail = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("80"),
        notes="Produkcja poranna piątek — bułki pszenne (sklep detaliczny)",
    )
    _complete_prd_on_date(prod_bulka_fri_retail, wk_fri)

    # wk_fri: PRD rogali 60 szt — poranna partia dla sklepu przy piekarni (sprzedaż detaliczna)
    prod_rogal_fri_retail = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_rogal, date=wk_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("60"),
        notes="Produkcja poranna piątek — rogale maślane (sklep detaliczny)",
    )
    _complete_prd_on_date(prod_rogal_fri_retail, wk_fri)

    # wk_fri: PRD drożdżówek 48 szt (Hotel) — wyprodukowane, czekają na odbiór (WZ w drafcie)
    prod_drozdzowka_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_drozdzowka, date=wk_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("48"),
        notes="Produkcja piątek — drożdżówki (Hotel Złoty)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_drozdzowka_fri, order=order_fri, quantity=Decimal("48"),
    )
    _complete_prd_on_date(prod_drozdzowka_fri, wk_fri)  # drożdżówki gotowe, czekają na odbiór

    # wk_fri: PRD tortu 2 szt (Hotel) — STATUS_DRAFT (w piecu)
    prod_tort_fri = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_tort, date=wk_fri,
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("2"),
        notes="Produkcja piątek — tort urodzinowy (Hotel Złoty)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_tort_fri, order=order_fri, quantity=Decimal("2"),
    )
    # STATUS_DRAFT — still in production

    # wk_fri + 3: PRD bułek dla Bistro — STATUS_DRAFT (zaplanowane na poniedziałek)
    prod_bulka_next_mon = ProductionOrder.objects.create(
        company=company, created_by=user,
        recipe=recipe_bulka, date=wk_fri + timedelta(days=3),
        mode=ProductionOrder.MODE_SIMPLE, status=ProductionOrder.STATUS_DRAFT,
        quantity_produced=Decimal("40"),
        notes="Produkcja poniedziałek — bułki (Bistro Pod Lipą)",
    )
    ProductionOrderSource.objects.create(
        production_order=prod_bulka_next_mon, order=order_next_mon, quantity=Decimal("40"),
    )
    # STATUS_DRAFT — scheduled for Monday

    # ------------------------------------------------------------------
    # 17. Apply WZ deductions — must run AFTER all production orders are
    #     completed so ProductStock records for finished goods already exist.
    # ------------------------------------------------------------------
    for _wz_doc, _items in _pending_wz_deductions:
        _apply_wz_deduction(_wz_doc, _items)
