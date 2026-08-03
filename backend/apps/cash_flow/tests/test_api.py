import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.models import Company, CompanyMembership
from apps.cash_flow.models import CompanyTaxConfig, DailyB2CRevenue, QuickExpense

User = get_user_model()


def _make_user_with_company(username="cf_apiuser", role="admin"):
    import uuid as _uuid
    company = Company.objects.create(name=f"Firma {username}", is_active=True)
    unique = _uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        username=f"{username}_{unique}",
        email=f"{unique}@test.example",
        password="pass",
    )
    CompanyMembership.objects.create(user=user, company=company, role=role, is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    user.refresh_from_db()
    user.current_company = company
    return user, company


def _auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    return client


# ---------------------------------------------------------------------------
# Tax Config
# ---------------------------------------------------------------------------


class TaxConfigViewTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company()
        self.client = _auth_client(self.user)

    def test_unauthenticated_returns_401(self):
        resp = APIClient().get("/api/cash-flow/tax-config/")
        self.assertEqual(resp.status_code, 401)

    def test_get_creates_config_with_defaults(self):
        self.assertFalse(CompanyTaxConfig.objects.filter(company=self.company).exists())
        resp = self.client.get("/api/cash-flow/tax-config/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(CompanyTaxConfig.objects.filter(company=self.company).exists())
        data = resp.json()
        self.assertEqual(data["tax_form"], "kpir_linear")
        self.assertEqual(data["vat_due_day"], 25)
        self.assertTrue(data["vat_payer"])

    def test_get_returns_existing_config(self):
        CompanyTaxConfig.objects.create(
            company=self.company,
            tax_form=CompanyTaxConfig.TAX_FORM_RYCZALT,
            tax_rate=Decimal("5.50"),
        )
        resp = self.client.get("/api/cash-flow/tax-config/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["tax_form"], "ryczalt")

    def test_patch_updates_cash_balance_and_sets_timestamp(self):
        resp = self.client.patch(
            "/api/cash-flow/tax-config/",
            {"cash_balance": "2500.00", "bank_balance": "7000.00"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        config = CompanyTaxConfig.objects.get(company=self.company)
        self.assertEqual(config.cash_balance, Decimal("2500.00"))
        self.assertEqual(config.bank_balance, Decimal("7000.00"))
        self.assertIsNotNone(config.balance_updated_at)

    def test_patch_tax_form_does_not_update_balance_timestamp(self):
        resp = self.client.patch(
            "/api/cash-flow/tax-config/",
            {"tax_form": "ryczalt"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        config = CompanyTaxConfig.objects.get(company=self.company)
        self.assertIsNone(config.balance_updated_at)


# ---------------------------------------------------------------------------
# Quick Expenses
# ---------------------------------------------------------------------------


class QuickExpenseViewSetTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("qe_admin")
        self.client = _auth_client(self.user)

    def test_list_empty(self):
        resp = self.client.get("/api/cash-flow/quick-expenses/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_create_expense(self):
        resp = self.client.post(
            "/api/cash-flow/quick-expenses/",
            {
                "amount": "150.00",
                "category": "fuel",
                "date": str(datetime.date.today()),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["amount"], "150.00")
        self.assertEqual(data["category"], "fuel")
        # Company is auto-set
        self.assertEqual(QuickExpense.objects.filter(company=self.company).count(), 1)

    def test_create_requires_authentication(self):
        resp = APIClient().post(
            "/api/cash-flow/quick-expenses/",
            {"amount": "100.00"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_delete_expense(self):
        exp = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("50.00"),
        )
        resp = self.client.delete(f"/api/cash-flow/quick-expenses/{exp.uuid}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(QuickExpense.objects.filter(pk=exp.pk).exists())

    def test_cross_company_isolation(self):
        _, other_company = _make_user_with_company("qe_other")
        QuickExpense.objects.create(company=other_company, amount=Decimal("999.00"))

        resp = self.client.get("/api/cash-flow/quick-expenses/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_cross_company_uuid_returns_404(self):
        _, other_company = _make_user_with_company("qe_other2")
        exp = QuickExpense.objects.create(company=other_company, amount=Decimal("999.00"))
        resp = self.client.get(f"/api/cash-flow/quick-expenses/{exp.uuid}/")
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# B2C Revenue
# ---------------------------------------------------------------------------


class DailyB2CRevenueViewSetTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("b2c_admin")
        self.client = _auth_client(self.user)

    def test_create_b2c_revenue(self):
        resp = self.client.post(
            "/api/cash-flow/b2c-revenue/",
            {
                "date": "2025-08-01",
                "amount": "3200.00",
                "vat_included": True,
                "vat_rate": "23.00",
                "notes": "Piątkowy targ",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["amount"], "3200.00")
        self.assertEqual(DailyB2CRevenue.objects.filter(company=self.company).count(), 1)

    def test_list_only_own_company(self):
        _, other = _make_user_with_company("b2c_other")
        DailyB2CRevenue.objects.create(
            company=other, date=datetime.date.today(), amount=Decimal("500.00")
        )
        resp = self.client.get("/api/cash-flow/b2c-revenue/")
        self.assertEqual(resp.json(), [])


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class CashFlowDashboardViewTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("dash_user")
        self.client = _auth_client(self.user)

    def test_unauthenticated_returns_401(self):
        resp = APIClient().get("/api/cash-flow/dashboard/")
        self.assertEqual(resp.status_code, 401)

    def test_returns_today_and_month_sections(self):
        resp = self.client.get("/api/cash-flow/dashboard/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("today", data)
        self.assertIn("month", data)

    def test_today_section_has_required_fields(self):
        resp = self.client.get("/api/cash-flow/dashboard/")
        today = resp.json()["today"]
        for field in [
            "cash_balance", "bank_balance", "total_available",
            "upcoming_obligations", "total_reserved", "really_yours", "has_config",
        ]:
            self.assertIn(field, today)

    def test_month_section_has_required_fields(self):
        resp = self.client.get("/api/cash-flow/dashboard/")
        month = resp.json()["month"]
        for field in [
            "period", "revenue_paid", "revenue_outstanding", "b2c_revenue",
            "vat_to_pay", "pit_estimate", "pit_is_estimate", "zus_monthly",
            "really_yours_estimate", "recent_quick_expenses",
        ]:
            self.assertIn(field, month)

    def test_month_param_accepted(self):
        resp = self.client.get("/api/cash-flow/dashboard/?month=2025-07")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["month"]["period"], "2025-07")

    def test_invalid_month_param_uses_current_month(self):
        import datetime
        resp = self.client.get("/api/cash-flow/dashboard/?month=invalid")
        self.assertEqual(resp.status_code, 200)
        expected = datetime.date.today().strftime("%Y-%m")
        self.assertEqual(resp.json()["month"]["period"], expected)
