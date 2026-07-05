import datetime
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Avg
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice, InvoiceItem
from apps.ksef.models import ReceivedKSeFInvoice
from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, StockBatch, Warehouse
from apps.users.models import Company, CompanyMembership


class ReportingUrlTests(TestCase):
    def test_report_urls_resolve(self):
        self.assertEqual(
            reverse("report-sales-summary"), "/api/reports/sales-summary/"
        )
        self.assertEqual(reverse("report-invoices"), "/api/reports/invoices/")
        self.assertEqual(reverse("report-top-products"), "/api/reports/top-products/")
        self.assertEqual(
            reverse("report-top-customers"), "/api/reports/top-customers/"
        )
        self.assertEqual(reverse("report-inventory"), "/api/reports/inventory/")
        self.assertEqual(reverse("report-ksef-status"), "/api/reports/ksef-status/")


class ReportingAuthTests(TestCase):
    """All report endpoints require authentication."""

    _names = (
        "report-sales-summary",
        "report-invoices",
        "report-top-products",
        "report-top-customers",
        "report-inventory",
        "report-ksef-status",
    )

    def setUp(self):
        self.client = APIClient()

    def test_unauthenticated_returns_401(self):
        for name in self._names:
            with self.subTest(url=name):
                r = self.client.get(reverse(name))
                self.assertEqual(
                    r.status_code,
                    status.HTTP_401_UNAUTHORIZED,
                    r.content,
                )


class ReportingPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="report-perm-user",
            email="report-perm@test.com",
            password="test12345",
        )
        co = Company.objects.create(name="Report Perm Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=co,
            role="viewer",
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_forbidden_without_current_company(self):
        r = self.client.get(reverse("report-sales-summary"))
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)


class ReportingScopedApiTests(TestCase):
    """Aggregations and lists scoped to current_company."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="report-api-user",
            email="report-api@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Report Tenant A")
        self.co_b = Company.objects.create(name="Report Tenant B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])

        self.customer_a = Customer.objects.create(name="Alice", company=self.co)
        self.customer_b = Customer.objects.create(name="Bob", company=self.co_b)

        self.product_a = Product.objects.create(
            name="Alpha SKU",
            company=self.co,
            unit="szt",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            min_stock_alert=Decimal("100.00"),
        )
        self.product_b = Product.objects.create(
            name="Beta SKU",
            company=self.co_b,
            unit="szt",
        )

        self.order_ok = Order.objects.create(
            user=self.user,
            customer=self.customer_a,
            company=self.co,
            order_date=date(2026, 4, 10),
            delivery_date=date(2026, 4, 12),
            status=Order.STATUS_CONFIRMED,
            total_net=Decimal("80.00"),
            total_gross=Decimal("100.00"),
        )
        OrderItem.objects.create(
            order=self.order_ok,
            product=self.product_a,
            quantity=Decimal("2"),
            unit_price_net=Decimal("40.00"),
            unit_price_gross=Decimal("50.00"),
            vat_rate=Decimal("23.00"),
        )

        self.order_cancelled = Order.objects.create(
            user=self.user,
            customer=self.customer_a,
            company=self.co,
            order_date=date(2026, 4, 11),
            delivery_date=date(2026, 4, 13),
            status=Order.STATUS_CANCELLED,
            total_net=Decimal("200.00"),
            total_gross=Decimal("250.00"),
        )

        self.order_other_co = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.co_b,
            order_date=date(2026, 4, 10),
            delivery_date=date(2026, 4, 12),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("1000.00"),
            total_gross=Decimal("2000.00"),
        )
        OrderItem.objects.create(
            order=self.order_other_co,
            product=self.product_b,
            quantity=Decimal("1"),
            unit_price_net=Decimal("1000.00"),
            unit_price_gross=Decimal("2000.00"),
            vat_rate=Decimal("23.00"),
        )

        self.order_april_only = Order.objects.create(
            user=self.user,
            customer=self.customer_a,
            company=self.co,
            order_date=date(2026, 5, 1),
            delivery_date=date(2026, 5, 3),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("10.00"),
            total_gross=Decimal("12.00"),
        )

        self.wh = Warehouse.objects.create(
            user=self.user,
            company=self.co,
            code="MG",
            name="Main",
        )
        ProductStock.objects.create(
            company=self.co,
            product=self.product_a,
            warehouse=self.wh,
            quantity_available=Decimal("5.00"),
        )

        self.invoice_mine_draft = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order_ok,
            customer=self.customer_a,
            issue_date=date(2026, 4, 15),
            sale_date=date(2026, 4, 15),
            due_date=date(2026, 4, 30),
            status=Invoice.STATUS_DRAFT,
            ksef_status="not_sent",
        )
        self.invoice_mine_rejected = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order_cancelled,
            customer=self.customer_a,
            issue_date=date(2026, 4, 16),
            sale_date=date(2026, 4, 16),
            due_date=date(2026, 5, 1),
            status=Invoice.STATUS_ISSUED,
            ksef_status="rejected",
            ksef_error_message="KSeF test rejection",
        )
        other_order_b = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.co_b,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 5),
            status=Order.STATUS_DELIVERED,
        )
        self.invoice_other = Invoice.objects.create(
            company=self.co_b,
            user=self.user,
            order=other_order_b,
            customer=self.customer_b,
            issue_date=date(2026, 4, 20),
            sale_date=date(2026, 4, 20),
            due_date=date(2026, 5, 5),
            status=Invoice.STATUS_ISSUED,
            ksef_status="accepted",
        )

    def _auth(self):
        self.client.force_authenticate(user=self.user)

    def test_sales_summary_counts_all_statuses_money_excludes_cancelled(self):
        self._auth()
        r = self.client.get(reverse("report-sales-summary"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["totalOrders"], 3)
        self.assertEqual(Decimal(str(r.data["totalGross"])), Decimal("112.00"))
        self.assertEqual(Decimal(str(r.data["totalNet"])), Decimal("90.00"))
        self.assertEqual(Decimal(str(r.data["totalVat"])), Decimal("22.00"))
        self.assertEqual(Decimal(str(r.data["avgOrderValue"])), Decimal("56.00"))
        self.assertEqual(r.data["byStatus"][Order.STATUS_CANCELLED], 1)
        self.assertEqual(r.data["byStatus"][Order.STATUS_CONFIRMED], 1)

    def test_sales_summary_date_filter(self):
        self._auth()
        r = self.client.get(
            reverse("report-sales-summary"),
            {"date_from": "2026-04-01", "date_to": "2026-04-30"},
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["totalOrders"], 2)

    def test_sales_summary_invalid_date(self):
        self._auth()
        r = self.client.get(
            reverse("report-sales-summary"),
            {"date_from": "not-a-date"},
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_report_invoices_paginated_and_filtered(self):
        self._auth()
        r = self.client.get(
            reverse("report-invoices"),
            {"status": "draft", "date_from": "2026-04-01", "date_to": "2026-04-30"},
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertIn("results", r.data)
        self.assertEqual(r.data["count"], 1)
        row = r.data["results"][0]
        self.assertEqual(row["id"], str(self.invoice_mine_draft.uuid))
        self.assertEqual(row["ksef_status"], "not_sent")
        self.assertEqual(row["customer_name"], "Alice")

    def test_report_invoices_excludes_other_company(self):
        self._auth()
        r = self.client.get(reverse("report-invoices"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        ids = {x["id"] for x in r.data["results"]}
        self.assertIn(str(self.invoice_mine_draft.uuid), ids)
        self.assertNotIn(str(self.invoice_other.uuid), ids)

    def test_top_products_tenant_and_ordering(self):
        self._auth()
        r = self.client.get(reverse("report-top-products"), {"limit": "5"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertTrue(isinstance(r.data, list))
        names = [x["productName"] for x in r.data]
        self.assertIn("Alpha SKU", names)
        self.assertTrue(all("Beta" not in x["productName"] for x in r.data))

    def test_top_customers(self):
        self._auth()
        r = self.client.get(reverse("report-top-customers"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertGreaterEqual(len(r.data), 1)
        alice = next(x for x in r.data if x["customerName"] == "Alice")
        self.assertGreaterEqual(alice["orderCount"], 1)
        self.assertGreater(Decimal(str(alice["totalGross"])), Decimal("0"))

    def test_inventory_row_and_below_minimum(self):
        self._auth()
        r = self.client.get(reverse("report-inventory"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        row = next(x for x in r.data if x["warehouseCode"] == "MG")
        self.assertEqual(row["productName"], "Alpha SKU")
        self.assertEqual(Decimal(str(row["quantityAvailable"])), Decimal("5.00"))
        self.assertTrue(row["belowMinimum"])

    def test_ksef_status_counts_and_rejected_list(self):
        self._auth()
        r = self.client.get(reverse("report-ksef-status"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["notSent"], 1)
        self.assertEqual(r.data["rejected"], 1)
        self.assertEqual(r.data["accepted"], 0)
        rej = r.data["rejectedInvoices"]
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0]["id"], str(self.invoice_mine_rejected.uuid))
        self.assertEqual(rej[0]["ksef_error_message"], "KSeF test rejection")

    def test_sales_summary_avg_matches_orm_avg(self):
        """avgOrderValue must match Avg('total_gross') on non-cancelled orders (ORM)."""
        self._auth()
        money_qs = Order.objects.filter(company=self.co).exclude(
            status=Order.STATUS_CANCELLED
        )
        orm_avg = money_qs.aggregate(v=Avg("total_gross"))["v"]
        r = self.client.get(reverse("report-sales-summary"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(
            Decimal(str(r.data["avgOrderValue"])),
            Decimal(str(orm_avg)).quantize(Decimal("0.01")),
        )


class ReportingInventoryOrmTests(TestCase):
    """Inventory report: belowMinimum from ORM Case/When (strict lt min)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="report-inv-user",
            email="report-inv@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Inv Report Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.wh = Warehouse.objects.create(
            user=self.user,
            company=self.co,
            code="WH1",
            name="One",
        )
        self.product = Product.objects.create(
            name="Stocked",
            company=self.co,
            unit="szt",
            min_stock_alert=Decimal("50.00"),
        )
        ProductStock.objects.create(
            company=self.co,
            product=self.product,
            warehouse=self.wh,
            quantity_available=Decimal("50.00"),
        )

    def test_inventory_not_below_when_quantity_equals_min(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.get(reverse("report-inventory"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(len(r.data), 1)
        self.assertFalse(r.data[0]["belowMinimum"])
        self.assertEqual(
            Decimal(str(r.data[0]["quantityAvailable"])),
            Decimal(str(r.data[0]["minStockAlert"])),
        )


class ProfitLossViewTests(TestCase):
    """Tests for GET /api/reports/profit-loss/ (url name: report-profit-loss)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="pl-user",
            email="pl@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="PL Company A")
        self.co_b = Company.objects.create(name="PL Company B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

        self.customer = Customer.objects.create(name="PL Customer", company=self.co)

        # Two orders for two invoices (different months)
        self.order_apr = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 5),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("1000.00"),
            total_gross=Decimal("1230.00"),
        )
        self.order_may = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 5, 1),
            delivery_date=date(2026, 5, 5),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("500.00"),
            total_gross=Decimal("615.00"),
        )

        # Invoice for April
        self.invoice_apr = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order_apr,
            customer=self.customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 30),
            status=Invoice.STATUS_ISSUED,
            ksef_status="not_sent",
            total_gross=Decimal("1230.00"),
            subtotal_net=Decimal("1000.00"),
        )
        # Invoice for May — with tagged OPEX in same month
        self.invoice_may = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order_may,
            customer=self.customer,
            issue_date=date(2026, 5, 5),
            sale_date=date(2026, 5, 5),
            due_date=date(2026, 5, 31),
            status=Invoice.STATUS_ISSUED,
            ksef_status="not_sent",
            total_gross=Decimal("615.00"),
            subtotal_net=Decimal("500.00"),
        )

        # PZ delivery document with items (April)
        self.pz = DeliveryDocument.objects.create(
            company=self.co,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_PZ,
            status=DeliveryDocument.STATUS_DELIVERED,
            issue_date=date(2026, 4, 5),
            document_number="PZ/2026/0001",
        )
        self.product = Product.objects.create(
            name="PL Product",
            company=self.co,
            unit="szt",
            avg_cost=Decimal("8.0000"),
        )
        DeliveryItem.objects.create(
            delivery_document=self.pz,
            product=self.product,
            quantity_planned=Decimal("10.00"),
            unit_cost=Decimal("8.00"),
        )

        # ReceivedKSeFInvoice with opex_category in May
        self.opex_invoice = ReceivedKSeFInvoice.objects.create(
            company=self.co,
            ksef_number="KSEF-OPEX-001",
            invoice_number="FV-UTIL/2026/001",
            issue_date=date(2026, 5, 10),
            opex_category=ReceivedKSeFInvoice.OPEX_UTILITIES,
            gross_amount=Decimal("200.00"),
        )

        # Other-company invoice (should be excluded)
        self.customer_b = Customer.objects.create(name="PL Customer B", company=self.co_b)
        self.order_b = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.co_b,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 5),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("9999.00"),
            total_gross=Decimal("9999.00"),
        )
        self.invoice_b = Invoice.objects.create(
            company=self.co_b,
            user=self.user,
            order=self.order_b,
            customer=self.customer_b,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 30),
            status=Invoice.STATUS_ISSUED,
            ksef_status="not_sent",
            total_gross=Decimal("9999.00"),
            subtotal_net=Decimal("9999.00"),
        )

    def _get(self, params=None):
        return self.client.get(reverse("report-profit-loss"), params or {})

    def test_profit_loss_returns_rows(self):
        r = self._get({"date_from": "2026-04-01", "date_to": "2026-05-31"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertIn("rows", r.data)
        self.assertGreaterEqual(len(r.data["rows"]), 1)
        row = r.data["rows"][0]
        for key in ("month", "revenue", "purchaseCosts", "grossProfit", "opex", "operatingProfit"):
            self.assertIn(key, row, f"Missing key '{key}' in row")

    def test_profit_loss_totals_include_opex(self):
        r = self._get({"date_from": "2026-04-01", "date_to": "2026-05-31"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertIn("totals", r.data)
        totals = r.data["totals"]
        for key in ("opex", "operatingProfit", "operatingMarginPercent"):
            self.assertIn(key, totals, f"Missing key '{key}' in totals")
        self.assertEqual(Decimal(str(totals["opex"])), Decimal("200.00"))

    def test_profit_loss_opex_by_category(self):
        r = self._get({"date_from": "2026-04-01", "date_to": "2026-05-31"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        rows = r.data["rows"]
        may_row = next((row for row in rows if row["month"] == "2026-05"), None)
        self.assertIsNotNone(may_row, "Expected a row for 2026-05")
        self.assertIn("opexByCategory", may_row)
        self.assertIn("utilities", may_row["opexByCategory"])
        self.assertEqual(Decimal(str(may_row["opexByCategory"]["utilities"])), Decimal("200.00"))

    def test_profit_loss_scoped_to_company(self):
        r = self._get({"date_from": "2026-04-01", "date_to": "2026-04-30"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        rows = r.data["rows"]
        # Only one april row; revenue must NOT include the other-company invoice (9999)
        self.assertEqual(len(rows), 1)
        apr_row = rows[0]
        self.assertEqual(apr_row["month"], "2026-04")
        self.assertNotEqual(Decimal(str(apr_row["revenue"])), Decimal("9999.00"))
        self.assertEqual(Decimal(str(apr_row["revenue"])), Decimal("1230.00"))


class CustomerMarginViewTests(TestCase):
    """Tests for GET /api/reports/customer-margin/ (url name: report-customer-margin)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="cm-user",
            email="cm@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="CM Company A")
        self.co_b = Company.objects.create(name="CM Company B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

        self.customer = Customer.objects.create(name="CM Customer A", company=self.co)
        self.product = Product.objects.create(
            name="CM Product",
            company=self.co,
            unit="szt",
            price_net=Decimal("20.00"),
            price_gross=Decimal("24.60"),
            vat_rate=Decimal("23.00"),
            avg_cost=Decimal("10.0000"),
        )

        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 5),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("40.00"),
            total_gross=Decimal("49.20"),
        )
        self.invoice = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 30),
            status=Invoice.STATUS_ISSUED,
            ksef_status="not_sent",
            total_gross=Decimal("49.20"),
            subtotal_net=Decimal("40.00"),
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            quantity=Decimal("2.00"),
            unit_price_net=Decimal("20.00"),
            vat_rate=Decimal("23.00"),
        )

        # Other-company data
        self.customer_b = Customer.objects.create(name="CM Customer B", company=self.co_b)
        self.product_b = Product.objects.create(
            name="CM Product B",
            company=self.co_b,
            unit="szt",
        )
        self.order_b = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.co_b,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 5),
            status=Order.STATUS_DELIVERED,
            total_net=Decimal("9999.00"),
            total_gross=Decimal("9999.00"),
        )
        self.invoice_b = Invoice.objects.create(
            company=self.co_b,
            user=self.user,
            order=self.order_b,
            customer=self.customer_b,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 30),
            status=Invoice.STATUS_ISSUED,
            ksef_status="not_sent",
            total_gross=Decimal("9999.00"),
            subtotal_net=Decimal("9999.00"),
        )
        InvoiceItem.objects.create(
            invoice=self.invoice_b,
            product=self.product_b,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("9999.00"),
            vat_rate=Decimal("23.00"),
        )

    def _get(self, params=None):
        return self.client.get(reverse("report-customer-margin"), params or {})

    def test_customer_margin_returns_rows(self):
        r = self._get()
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertIn("rows", r.data)
        self.assertIn("productsMissingCost", r.data)
        self.assertGreaterEqual(len(r.data["rows"]), 1)
        row = r.data["rows"][0]
        self.assertEqual(row["customerName"], "CM Customer A")
        self.assertIn("totalRevenue", row)
        self.assertIn("cogs", row)
        self.assertIn("grossProfit", row)
        self.assertIn("marginPercent", row)

    def test_customer_margin_scoped(self):
        r = self._get()
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        customer_names = [row["customerName"] for row in r.data["rows"]]
        self.assertIn("CM Customer A", customer_names)
        self.assertNotIn("CM Customer B", customer_names)


class ExpiryAlertsViewTests(TestCase):
    """Tests for GET /api/reports/expiry-alerts/ (url name: report-expiry-alerts)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ea-user",
            email="ea@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="EA Company A")
        self.co_b = Company.objects.create(name="EA Company B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

        self.product = Product.objects.create(
            name="EA Product",
            company=self.co,
            unit="szt",
        )
        self.wh = Warehouse.objects.create(
            user=self.user,
            company=self.co,
            code="EA1",
            name="EA Warehouse",
        )

        today = datetime.date.today()

        # Batch expiring within 30 days (not yet expired)
        self.batch_soon = StockBatch.objects.create(
            company=self.co,
            product=self.product,
            warehouse=self.wh,
            quantity_initial=Decimal("100.00"),
            quantity_remaining=Decimal("50.00"),
            expiry_date=today + datetime.timedelta(days=20),
            received_date=today - datetime.timedelta(days=10),
            unit_cost=Decimal("5.00"),
        )

        # Batch already expired
        self.batch_expired = StockBatch.objects.create(
            company=self.co,
            product=self.product,
            warehouse=self.wh,
            quantity_initial=Decimal("50.00"),
            quantity_remaining=Decimal("10.00"),
            expiry_date=today - datetime.timedelta(days=5),
            received_date=today - datetime.timedelta(days=60),
            unit_cost=Decimal("5.00"),
        )

        # Other-company batch (should be excluded)
        self.product_b = Product.objects.create(
            name="EA Product B",
            company=self.co_b,
            unit="szt",
        )
        self.wh_b = Warehouse.objects.create(
            user=self.user,
            company=self.co_b,
            code="EA2",
            name="EA Warehouse B",
        )
        self.batch_other = StockBatch.objects.create(
            company=self.co_b,
            product=self.product_b,
            warehouse=self.wh_b,
            quantity_initial=Decimal("200.00"),
            quantity_remaining=Decimal("200.00"),
            expiry_date=today + datetime.timedelta(days=10),
            received_date=today - datetime.timedelta(days=5),
            unit_cost=Decimal("3.00"),
        )

    def _get(self, params=None):
        return self.client.get(reverse("report-expiry-alerts"), params or {})

    def test_expiry_alerts_returns_batch(self):
        r = self._get({"days": "90"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertIsInstance(r.data, list)
        self.assertGreaterEqual(len(r.data), 1)
        batch_ids = [item["batchId"] for item in r.data]
        self.assertIn(str(self.batch_soon.uuid), batch_ids)
        row = next(item for item in r.data if item["batchId"] == str(self.batch_soon.uuid))
        for key in ("batchId", "productName", "expiryDate", "daysUntilExpiry", "expired"):
            self.assertIn(key, row, f"Missing key '{key}' in expiry alert row")
        self.assertEqual(row["productName"], "EA Product")
        self.assertFalse(row["expired"])

    def test_expiry_alerts_expired_flag(self):
        r = self._get({"days": "90"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        batch_ids = [item["batchId"] for item in r.data]
        self.assertIn(str(self.batch_expired.uuid), batch_ids)
        expired_row = next(item for item in r.data if item["batchId"] == str(self.batch_expired.uuid))
        self.assertTrue(expired_row["expired"])
        self.assertLess(expired_row["daysUntilExpiry"], 0)
        # Other-company batch must not appear
        self.assertNotIn(str(self.batch_other.uuid), batch_ids)

    def test_expiry_days_param(self):
        # ?days=7 — only the soon-expiring batch (20 days out) should NOT appear;
        # the expired batch (-5 days) IS within the cutoff (expiry_date <= today+7)
        # and the soon batch (20 days) is NOT within cutoff.
        r = self._get({"days": "7"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        batch_ids = [item["batchId"] for item in r.data]
        # Batch expiring in 20 days should not appear with days=7
        self.assertNotIn(str(self.batch_soon.uuid), batch_ids)
        # Expired batch (already past) has expiry_date <= today+7, so it appears
        self.assertIn(str(self.batch_expired.uuid), batch_ids)
