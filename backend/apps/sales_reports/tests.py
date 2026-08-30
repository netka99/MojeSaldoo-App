import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from django.test import TestCase

from apps.users.models import Company, CompanyMembership
from apps.products.models import Product
from .models import DailySalesReport, DailySalesReportItem, SalesReportTemplate

User = get_user_model()


def _make_user_with_company(username="sr_user"):
    import uuid
    unique = uuid.uuid4().hex[:6]
    company = Company.objects.create(name=f"Firma {username}", is_active=True)
    user = User.objects.create_user(
        username=f"{username}_{unique}",
        password="pass",
        email=f"{username}_{unique}@test.com",
    )
    CompanyMembership.objects.create(user=user, company=company, role="admin", is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    user.refresh_from_db()
    user.current_company = company
    return user, company


def _auth_client(user):
    refresh = RefreshToken.for_user(user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    return client


def _make_product(company, name="Chleb", price_gross="8.00", avg_cost="3.00"):
    return Product.objects.create(
        company=company,
        name=name,
        price_gross=Decimal(price_gross),
        price_net=Decimal(price_gross) / Decimal("1.08"),
        avg_cost=Decimal(avg_cost),
    )


class DailySalesReportModelTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company()

    def test_auto_number_assigned_on_save_with_status_saved(self):
        report = DailySalesReport.objects.create(
            company=self.company,
            date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_SAVED,
        )
        self.assertTrue(report.report_number.startswith("RK/2026/"))

    def test_draft_has_no_number(self):
        report = DailySalesReport.objects.create(
            company=self.company,
            date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_DRAFT,
        )
        self.assertEqual(report.report_number, "")

    def test_sequential_numbering(self):
        r1 = DailySalesReport.objects.create(
            company=self.company, date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_SAVED,
        )
        r2 = DailySalesReport.objects.create(
            company=self.company, date=datetime.date(2026, 8, 2),
            status=DailySalesReport.STATUS_SAVED,
        )
        self.assertEqual(r1.report_number, "RK/2026/0001")
        self.assertEqual(r2.report_number, "RK/2026/0002")

    def test_recalculate_totals(self):
        report = DailySalesReport.objects.create(
            company=self.company, date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_DRAFT,
        )
        DailySalesReportItem.objects.create(
            report=report, product_name="Chleb", qty=Decimal("10"),
            unit_price=Decimal("8.00"), unit_cost=Decimal("3.00"),
        )
        DailySalesReportItem.objects.create(
            report=report, product_name="Rogalik", qty=Decimal("20"),
            unit_price=Decimal("2.00"), unit_cost=Decimal("0.80"),
        )
        report.recalculate_totals()
        self.assertEqual(report.amount, Decimal("120.00"))  # 80 + 40
        self.assertEqual(report.cost_total, Decimal("46.00"))  # 30 + 16


class DailySalesReportAPITests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company()
        self.client = _auth_client(self.user)
        self.product = _make_product(self.company)

    def test_create_report_draft(self):
        payload = {
            "date": "2026-08-01",
            "status": "draft",
            "notes": "Test",
            "lines": [
                {
                    "product": self.product.pk,
                    "product_name": self.product.name,
                    "unit": "szt.",
                    "qty": "5.000",
                    "unit_price": "8.0000",
                    "unit_cost": "3.0000",
                }
            ],
        }
        resp = self.client.post("/api/sales/reports/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["report_number"], "")
        self.assertEqual(Decimal(data["amount"]), Decimal("40.00"))

    def test_create_report_saved_gets_number(self):
        payload = {
            "date": "2026-08-01",
            "status": "saved",
            "lines": [],
        }
        resp = self.client.post("/api/sales/reports/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()["report_number"].startswith("RK/2026/"))

    def test_list_reports(self):
        DailySalesReport.objects.create(
            company=self.company, date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_SAVED,
        )
        resp = self.client.get("/api/sales/reports/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["count"], 1)

    def test_yesterday_endpoint_returns_last_saved(self):
        DailySalesReport.objects.create(
            company=self.company, date=datetime.date(2026, 7, 1),
            status=DailySalesReport.STATUS_SAVED, amount=Decimal("100.00"),
        )
        resp = self.client.get("/api/sales/reports/yesterday/")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(resp.json())

    def test_isolation_between_companies(self):
        other_user, other_company = _make_user_with_company("other_sr")
        DailySalesReport.objects.create(
            company=other_company, date=datetime.date(2026, 8, 1),
            status=DailySalesReport.STATUS_SAVED,
        )
        resp = self.client.get("/api/sales/reports/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["count"], 0)


class SalesReportTemplateAPITests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company()
        self.client = _auth_client(self.user)

    def test_create_template(self):
        payload = {
            "name": "Mój sklep",
            "is_default": True,
            "lines": [{"product_id": "abc", "product_name": "Chleb", "qty": 20, "unit_price": 8.0}],
        }
        resp = self.client.post("/api/sales/templates/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()["is_default"])

    def test_only_one_default_template(self):
        self.client.post("/api/sales/templates/", {"name": "A", "is_default": True, "lines": []}, format="json")
        self.client.post("/api/sales/templates/", {"name": "B", "is_default": True, "lines": []}, format="json")
        defaults = SalesReportTemplate.objects.filter(company=self.company, is_default=True).count()
        self.assertEqual(defaults, 1)
