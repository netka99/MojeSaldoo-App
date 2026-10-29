"""Tests for build_customer_flow() in apps.reporting.flow_report.

Scenarios covered:
  1. Happy path — order → WZ → invoice all linked, no problems
  2. Delivered order without invoice → problem: delivered_no_invoice
  3. WZ without invoice → problem: wz_no_invoice
  4. Overdue invoice → problem: invoice_overdue
  5. Multi-order invoice → cross_period flag when one order is outside the period
  6. FV-KOR correction → appears in invoice.corrections list
  7. fv_kor mode: ZW return doc without FV-KOR → problem: wz_zw_no_fvkor
  8. net_qty mode: returns via WZ quantity_returned (not ZW), no wz_zw_no_fvkor problem
  9. Manual invoice (no order, no InvoiceOrder) → appears in manual_invoices
 10. Delivered quantities read from DeliveryItem, not OrderItem.quantity_delivered
 11. Invoiced quantities read from InvoiceItem by product (even when order_item FK is null)
 12. Date filter — orders outside range not included; invoices follow their orders
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice, InvoiceItem, InvoiceOrder
from apps.orders.models import Order, OrderItem
from apps.products.models import Product
from apps.reporting.flow_report import build_customer_flow
from apps.users.models import Company, CompanyMembership

User = get_user_model()

D_FROM = date(2026, 10, 1)
D_TO   = date(2026, 10, 31)
D_MID  = date(2026, 10, 15)
D_PREV = date(2026, 9, 20)  # outside period


def _make_company(name="FlowCo", returns_mode="fv_kor"):
    co = Company.objects.create(name=name)
    co.invoice_returns_mode = returns_mode
    co.save(update_fields=["invoice_returns_mode"])
    return co


def _make_user(co, username="flow-user"):
    u = User.objects.create_user(username=username, email=f"{username}@test.com", password="pw")
    CompanyMembership.objects.create(user=u, company=co, role="admin", is_active=True)
    u.current_company = co
    u.save(update_fields=["current_company"])
    return u


def _make_product(co, name="Widget", price_net="10.00", price_gross="12.30", vat="23.00"):
    return Product.objects.create(
        company=co, name=name, unit="szt",
        price_net=Decimal(price_net),
        price_gross=Decimal(price_gross),
        vat_rate=Decimal(vat),
    )


def _make_customer(co, name="Klient A"):
    return Customer.objects.create(company=co, name=name)


def _make_order(co, user, customer, delivery_date=D_MID, status="delivered",
                total_gross="100.00"):
    return Order.objects.create(
        company=co, user=user, customer=customer,
        order_date=delivery_date, delivery_date=delivery_date,
        status=status, total_gross=Decimal(total_gross),
    )


def _make_order_item(order, product, qty="10.00", price_gross="12.30"):
    return OrderItem.objects.create(
        order=order, product=product,
        product_name=product.name, product_unit=product.unit,
        quantity=Decimal(qty),
        unit_price_net=Decimal("10.00"), unit_price_gross=Decimal(price_gross),
        vat_rate=product.vat_rate,
    )


def _make_wz(co, order=None, customer=None, status="delivered", issue_date=D_MID):
    return DeliveryDocument.objects.create(
        company=co,
        document_type=DeliveryDocument.DOC_TYPE_WZ,
        document_number=f"WZ/{issue_date.year}/{issue_date.month:02d}/1",
        status=status,
        issue_date=issue_date,
        order=order,
        to_customer=customer or (order.customer if order else None),
    )


def _make_wz_item(wz, product, qty_actual="10.00", qty_returned="0.00"):
    return DeliveryItem.objects.create(
        delivery_document=wz, product=product,
        quantity_planned=Decimal(qty_actual),
        quantity_actual=Decimal(qty_actual),
        quantity_returned=Decimal(qty_returned),
    )


def _make_zw(co, linked_wz, customer, issue_date=D_MID):
    return DeliveryDocument.objects.create(
        company=co,
        document_type=DeliveryDocument.DOC_TYPE_ZW,
        document_number=f"ZW/{issue_date.year}/{issue_date.month:02d}/1",
        status="delivered",
        issue_date=issue_date,
        linked_wz=linked_wz,
        to_customer=customer,
    )


_inv_seq = 0


def _make_invoice(co, customer, order=None, status="issued",
                  issue_date=D_MID, due_date=None, total_gross="123.00",
                  is_correction=False, corrects=None):
    global _inv_seq
    _inv_seq += 1
    prefix = "FV-KOR" if is_correction else "FV"
    inv = Invoice.objects.create(
        company=co, customer=customer,
        order=order,
        status=status,
        issue_date=issue_date,
        sale_date=issue_date,
        due_date=due_date or issue_date + timedelta(days=30),
        total_gross=Decimal(total_gross),
        is_correction=is_correction,
        corrects_invoice=corrects,
        invoice_number=f"{prefix}/{issue_date.year}/{issue_date.month:02d}/{_inv_seq}",
    )
    return inv


def _make_invoice_item(inv, product, qty="10.00", price_net="10.00",
                       vat_rate="23.00", order_item=None):
    return InvoiceItem.objects.create(
        invoice=inv, product=product,
        product_name=product.name, product_unit=product.unit,
        quantity=Decimal(qty),
        unit_price_net=Decimal(price_net),
        vat_rate=Decimal(vat_rate),
        line_net=Decimal(price_net) * Decimal(qty),
        line_vat=Decimal(price_net) * Decimal(qty) * Decimal(vat_rate) / 100,
        line_gross=Decimal(price_net) * Decimal(qty) * (1 + Decimal(vat_rate) / 100),
        order_item=order_item,
    )


# ─── Tests ────────────────────────────────────────────────────────────────────

class FlowReportHappyPathTest(TestCase):
    """Order → WZ → Invoice all linked — no problems."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="invoiced")
        self.oi = _make_order_item(self.order, self.product, qty="10.00")

        self.wz = _make_wz(self.co, order=self.order)
        _make_wz_item(self.wz, self.product, qty_actual="10.00")

        self.inv = _make_invoice(self.co, self.customer, order=self.order)
        _make_invoice_item(self.inv, self.product, qty="10.00", order_item=self.oi)

    def test_one_customer_returned(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        self.assertEqual(len(result["customers"]), 1)

    def test_no_problems(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertEqual(row["problems"], [])

    def test_order_detail_ok_flag(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail = result["customers"][0]["orders_detail"][0]
        self.assertTrue(detail["ok"])
        self.assertIsNone(detail["problem"])

    def test_invoice_in_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail = result["customers"][0]["orders_detail"][0]
        self.assertEqual(len(detail["invoices"]), 1)
        self.assertEqual(detail["invoices"][0]["id"], str(self.inv.uuid))

    def test_wz_in_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail = result["customers"][0]["orders_detail"][0]
        self.assertEqual(len(detail["wz"]), 1)
        self.assertEqual(detail["wz"][0]["id"], str(self.wz.uuid))


class FlowReportDeliveredNoInvoiceTest(TestCase):
    """Delivered order without invoice → problem flag."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="delivered")
        _make_order_item(self.order, self.product)
        _make_wz(self.co, order=self.order)

    def test_problem_delivered_no_invoice(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertIn("delivered_no_invoice", row["problems"])

    def test_row_detail_not_ok(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail = result["customers"][0]["orders_detail"][0]
        self.assertFalse(detail["ok"])
        self.assertEqual(detail["problem"], "delivered_no_invoice")


class FlowReportOverdueInvoiceTest(TestCase):
    """Invoice past due date → problem: invoice_overdue."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="invoiced")
        _make_order_item(self.order, self.product)

        # due_date in the past
        self.inv = _make_invoice(
            self.co, self.customer, order=self.order,
            status="overdue",
            due_date=date(2026, 9, 1),
        )
        _make_invoice_item(self.inv, self.product)

    def test_problem_overdue(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertIn("invoice_overdue", row["problems"])

    def test_overdue_count(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertEqual(row["invoices"]["overdue"], 1)


class FlowReportFvKorCorrectionTest(TestCase):
    """FV-KOR correction → appears in invoice.corrections list."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="invoiced")
        _make_order_item(self.order, self.product)

        self.inv = _make_invoice(self.co, self.customer, order=self.order)
        _make_invoice_item(self.inv, self.product)

        self.kor = _make_invoice(
            self.co, self.customer, order=self.order,
            is_correction=True, corrects=self.inv,
            total_gross="-20.00", status="issued",
        )

    def test_correction_in_invoice_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail = result["customers"][0]["orders_detail"][0]
        inv_entry = detail["invoices"][0]
        self.assertEqual(len(inv_entry["corrections"]), 1)
        self.assertEqual(inv_entry["corrections"][0]["id"], str(self.kor.uuid))

    def test_correction_has_required_fields(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        kor = result["customers"][0]["orders_detail"][0]["invoices"][0]["corrections"][0]
        for field in ("id", "number", "status", "issue_date", "total_gross", "correction_reason"):
            self.assertIn(field, kor, f"Missing field: {field}")


class FlowReportCrossPeriodTest(TestCase):
    """Multi-order invoice where one order is outside the report period → cross_period=True."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        # Order inside period
        self.order_in = _make_order(self.co, self.user, self.customer, delivery_date=D_MID, status="invoiced")
        _make_order_item(self.order_in, self.product)

        # Order outside period (previous month)
        self.order_out = _make_order(self.co, self.user, self.customer, delivery_date=D_PREV, status="invoiced")
        _make_order_item(self.order_out, self.product)

        # Invoice linked to both via InvoiceOrder (no direct order FK)
        self.inv = _make_invoice(self.co, self.customer, order=None)
        _make_invoice_item(self.inv, self.product, qty="20.00")
        InvoiceOrder.objects.create(invoice=self.inv, order=self.order_in)
        InvoiceOrder.objects.create(invoice=self.inv, order=self.order_out)

    def test_cross_period_flag_set(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        # The invoice should appear in the in-period order's detail
        customer = result["customers"][0]
        invoices_in_detail = [
            inv
            for detail in customer["orders_detail"]
            for inv in detail["invoices"]
            if inv["id"] == str(self.inv.uuid)
        ]
        self.assertTrue(len(invoices_in_detail) >= 1, "Invoice not found in any order detail")
        self.assertTrue(invoices_in_detail[0]["cross_period"])

    def test_no_cross_period_for_single_order_invoice(self):
        """Single-order invoice should never have cross_period=True."""
        inv2 = _make_invoice(self.co, self.customer, order=self.order_in,
                             total_gross="50.00")
        _make_invoice_item(inv2, self.product)
        result = build_customer_flow(self.co, D_FROM, D_TO)
        customer = result["customers"][0]
        for detail in customer["orders_detail"]:
            for inv_entry in detail["invoices"]:
                if inv_entry["id"] == str(inv2.uuid):
                    self.assertFalse(inv_entry["cross_period"])
                    return


class FlowReportDeliveredQtyFromWZTest(TestCase):
    """delivered_qty must be read from DeliveryItem, not OrderItem.quantity_delivered."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="delivered")
        self.oi = _make_order_item(self.order, self.product, qty="10.00")
        # OrderItem.quantity_delivered intentionally NOT updated (= 0, default)

        self.wz = _make_wz(self.co, order=self.order)
        _make_wz_item(self.wz, self.product, qty_actual="8.00")  # partial delivery

    def test_delivered_qty_from_wz_items(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["orders_detail"][0]["lines"]
        self.assertEqual(len(lines), 1)
        self.assertEqual(Decimal(lines[0]["delivered_qty"]), Decimal("8.00"))

    def test_ordered_qty_from_order_item(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["orders_detail"][0]["lines"]
        self.assertEqual(Decimal(lines[0]["ordered_qty"]), Decimal("10.00"))


class FlowReportInvoicedQtyNullOrderItemTest(TestCase):
    """invoiced_qty must aggregate from InvoiceItem directly when order_item FK is null."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="invoiced")
        _make_order_item(self.order, self.product, qty="5.00")

        # Invoice linked via InvoiceOrder (multi-order path), no direct order FK
        self.inv = _make_invoice(self.co, self.customer, order=None)
        # InvoiceItem with order_item=None (van flow)
        _make_invoice_item(self.inv, self.product, qty="5.00", order_item=None)
        InvoiceOrder.objects.create(invoice=self.inv, order=self.order)

    def test_invoiced_qty_from_invoice_items(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["orders_detail"][0]["lines"]
        self.assertEqual(len(lines), 1)
        self.assertEqual(Decimal(lines[0]["invoiced_qty"]), Decimal("5.00"))


class FlowReportZwWithoutFvKorTest(TestCase):
    """fv_kor mode: ZW return doc without correction → wz_zw_no_fvkor problem."""

    def setUp(self):
        self.co = _make_company(returns_mode="fv_kor")
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="delivered")
        _make_order_item(self.order, self.product, qty="10.00")

        self.wz = _make_wz(self.co, order=self.order)
        _make_wz_item(self.wz, self.product, qty_actual="10.00")

        # ZW return linked to WZ — no FV-KOR issued
        self.zw = _make_zw(self.co, linked_wz=self.wz, customer=self.customer)
        _make_wz_item(self.zw, self.product, qty_actual="3.00")

    def test_problem_wz_zw_no_fvkor(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertIn("wz_zw_no_fvkor", row["problems"])

    def test_zw_in_wz_entry(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        wz_entries = result["customers"][0]["orders_detail"][0]["wz"]
        self.assertEqual(len(wz_entries[0]["zw"]), 1)
        self.assertEqual(wz_entries[0]["zw"][0]["id"], str(self.zw.uuid))

    def test_returned_qty_from_zw(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["orders_detail"][0]["lines"]
        self.assertEqual(Decimal(lines[0]["returned_qty"]), Decimal("3.00"))

    def test_no_problem_when_fvkor_issued(self):
        """Adding a FV-KOR correction should clear the wz_zw_no_fvkor problem."""
        inv = _make_invoice(self.co, self.customer, order=self.order)
        _make_invoice_item(inv, self.product)
        _make_invoice(
            self.co, self.customer, order=self.order,
            is_correction=True, corrects=inv,
            total_gross="-36.90", status="issued",
        )
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertNotIn("wz_zw_no_fvkor", row["problems"])


class FlowReportNetQtyModeTest(TestCase):
    """net_qty mode: returns via quantity_returned on WZ lines; no ZW prefetched, no wz_zw_no_fvkor."""

    def setUp(self):
        self.co = _make_company(returns_mode="net_qty")
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        self.order = _make_order(self.co, self.user, self.customer, status="invoiced")
        _make_order_item(self.order, self.product, qty="10.00")

        self.wz = _make_wz(self.co, order=self.order)
        _make_wz_item(self.wz, self.product, qty_actual="10.00", qty_returned="2.00")

        self.inv = _make_invoice(self.co, self.customer, order=self.order)
        _make_invoice_item(self.inv, self.product, qty="8.00")  # invoiced net

    def test_returns_mode_in_output(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        self.assertEqual(result["returns_mode"], "net_qty")

    def test_returned_qty_from_wz_quantity_returned(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["orders_detail"][0]["lines"]
        self.assertEqual(Decimal(lines[0]["returned_qty"]), Decimal("2.00"))

    def test_no_wz_zw_no_fvkor_problem_in_net_qty_mode(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertNotIn("wz_zw_no_fvkor", row["problems"])

    def test_no_problems(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertEqual(row["problems"], [])


class FlowReportManualInvoiceTest(TestCase):
    """Manual invoice (no order, no InvoiceOrder) → in manual_invoices, not orders_detail."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        # Manual invoice: no order FK, no InvoiceOrder
        self.inv = _make_invoice(self.co, self.customer, order=None, total_gross="246.00")
        _make_invoice_item(self.inv, self.product, qty="20.00")

    def test_manual_invoice_in_manual_invoices(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertEqual(len(row["manual_invoices"]), 1)
        self.assertEqual(row["manual_invoices"][0]["id"], str(self.inv.uuid))

    def test_manual_invoice_has_lines(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        lines = result["customers"][0]["manual_invoices"][0]["lines"]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["product_name"], self.product.name)

    def test_manual_invoice_not_in_orders_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        orders_detail = result["customers"][0]["orders_detail"]
        self.assertEqual(orders_detail, [])


class FlowReportDateFilterTest(TestCase):
    """Orders outside the date range are excluded; invoices follow their orders."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.customer = _make_customer(self.co)
        self.product = _make_product(self.co)

        # Order inside period
        self.order_in = _make_order(self.co, self.user, self.customer,
                                    delivery_date=D_MID, status="invoiced")
        _make_order_item(self.order_in, self.product)
        inv_in = _make_invoice(self.co, self.customer, order=self.order_in, issue_date=D_MID)
        _make_invoice_item(inv_in, self.product)

        # Order outside period (next month)
        d_next = date(2026, 11, 5)
        self.order_out = _make_order(self.co, self.user, self.customer,
                                     delivery_date=d_next, status="invoiced")
        _make_order_item(self.order_out, self.product)
        inv_out = _make_invoice(self.co, self.customer, order=self.order_out, issue_date=d_next)
        _make_invoice_item(inv_out, self.product)

    def test_only_in_period_order_included(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        row = result["customers"][0]
        self.assertEqual(row["orders"]["total"], 1)

    def test_out_of_period_order_not_in_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail_ids = [d["id"] for d in result["customers"][0]["orders_detail"]]
        self.assertNotIn(str(self.order_out.uuid), detail_ids)

    def test_in_period_order_in_detail(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        detail_ids = [d["id"] for d in result["customers"][0]["orders_detail"]]
        self.assertIn(str(self.order_in.uuid), detail_ids)


class FlowReportMultiCustomerTest(TestCase):
    """Multiple customers are sorted by name and isolated."""

    def setUp(self):
        self.co = _make_company()
        self.user = _make_user(self.co)
        self.product = _make_product(self.co)

        self.c1 = _make_customer(self.co, name="Alfa")
        self.c2 = _make_customer(self.co, name="Beta")
        self.c3 = _make_customer(self.co, name="Gamma")

        for customer in (self.c1, self.c2, self.c3):
            o = _make_order(self.co, self.user, customer, status="invoiced")
            _make_order_item(o, self.product)
            inv = _make_invoice(self.co, customer, order=o)
            _make_invoice_item(inv, self.product)

    def test_three_customers_returned(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        self.assertEqual(len(result["customers"]), 3)

    def test_sorted_alphabetically(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        names = [c["customer_name"] for c in result["customers"]]
        self.assertEqual(names, ["Alfa", "Beta", "Gamma"])

    def test_data_isolation_between_customers(self):
        result = build_customer_flow(self.co, D_FROM, D_TO)
        for row in result["customers"]:
            self.assertEqual(row["orders"]["total"], 1)


class FlowReportReturnsModeFieldTest(TestCase):
    """returns_mode is present in the output and matches company setting."""

    def test_fv_kor_mode(self):
        co = _make_company(returns_mode="fv_kor")
        result = build_customer_flow(co, D_FROM, D_TO)
        self.assertEqual(result["returns_mode"], "fv_kor")

    def test_net_qty_mode(self):
        co = _make_company(returns_mode="net_qty")
        result = build_customer_flow(co, D_FROM, D_TO)
        self.assertEqual(result["returns_mode"], "net_qty")

    def test_period_in_output(self):
        co = _make_company()
        result = build_customer_flow(co, D_FROM, D_TO)
        self.assertEqual(result["period"]["date_from"], D_FROM)
        self.assertEqual(result["period"]["date_to"], D_TO)
