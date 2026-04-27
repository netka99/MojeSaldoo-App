from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Avg
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.invoices.models import Invoice
from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, Warehouse
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
            order=self.order_ok,
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
        self.assertEqual(row["id"], str(self.invoice_mine_draft.id))
        self.assertEqual(row["ksef_status"], "not_sent")
        self.assertEqual(row["customer_name"], "Alice")

    def test_report_invoices_excludes_other_company(self):
        self._auth()
        r = self.client.get(reverse("report-invoices"))
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        ids = {x["id"] for x in r.data["results"]}
        self.assertIn(str(self.invoice_mine_draft.id), ids)
        self.assertNotIn(str(self.invoice_other.id), ids)

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
        self.assertEqual(rej[0]["id"], str(self.invoice_mine_rejected.id))
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
