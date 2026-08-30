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

    def test_create_expense_with_lines(self):
        """Expense with line items stores amount_net, vat_rate, lines."""
        lines = [
            {
                "name": "Mąka pszenna",
                "quantity": "50",
                "unit": "kg",
                "unit_price": "2.50",
                "vat_rate": "8",
                "line_net": "125.00",
                "line_gross": "135.00",
            }
        ]
        resp = self.client.post(
            "/api/cash-flow/quick-expenses/",
            {
                "amount": "135.00",
                "amount_net": "125.00",
                "vat_rate": "8",
                "lines": lines,
                "category": "raw_materials",
                "has_vat": True,
                "vendor": "Mlyn Kujawski",
                "document_type": "faktura_vat",
                "date": str(datetime.date.today()),
                "cost_type": "indirect",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["amount"], "135.00")
        self.assertEqual(data["amount_net"], "125.00")
        self.assertEqual(data["vat_rate"], "8")
        self.assertEqual(len(data["lines"]), 1)
        self.assertEqual(data["lines"][0]["name"], "Mąka pszenna")
        self.assertTrue(data["has_vat"])

    def test_create_expense_with_new_doc_types(self):
        """faktura_pdf and faktura_rr are valid document_type values."""
        for doc_type in ("faktura_pdf", "faktura_rr"):
            resp = self.client.post(
                "/api/cash-flow/quick-expenses/",
                {
                    "amount": "200.00",
                    "category": "services",
                    "document_type": doc_type,
                    "date": str(datetime.date.today()),
                    "cost_type": "indirect",
                },
                format="json",
            )
            self.assertEqual(resp.status_code, 201, msg=f"Failed for {doc_type}")
            self.assertEqual(resp.json()["document_type"], doc_type)


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


# ---------------------------------------------------------------------------
# Period Summary
# ---------------------------------------------------------------------------


class CashFlowPeriodSummaryViewTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("period_user")
        self.client = _auth_client(self.user)

    def test_returns_200_authenticated(self):
        resp = self.client.get("/api/cash-flow/period-summary/")
        self.assertEqual(resp.status_code, 200)

    def test_unauthenticated_returns_401(self):
        resp = APIClient().get("/api/cash-flow/period-summary/")
        self.assertEqual(resp.status_code, 401)

    def test_required_fields_in_response(self):
        resp = self.client.get("/api/cash-flow/period-summary/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        for field in [
            "date_from", "date_to",
            "revenue_total", "revenue_b2b_paid", "revenue_b2c",
            "costs_suppliers", "costs_quick", "costs_fixed_total",
            "taxes_vat", "taxes_zus_social", "taxes_zus_health", "taxes_pit",
            "taxes_total", "profit_net",
        ]:
            self.assertIn(field, data, msg=f"Missing field: {field}")

    def test_invalid_date_returns_400(self):
        resp = self.client.get("/api/cash-flow/period-summary/?date_from=not-a-date")
        self.assertEqual(resp.status_code, 400)

    def test_date_from_after_date_to_returns_400(self):
        resp = self.client.get(
            "/api/cash-flow/period-summary/?date_from=2026-12-31&date_to=2026-01-01"
        )
        self.assertEqual(resp.status_code, 400)

    def test_custom_date_range_accepted(self):
        resp = self.client.get(
            "/api/cash-flow/period-summary/?date_from=2026-01-01&date_to=2026-06-30"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["date_from"], "2026-01-01")


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


class CashFlowHistoryViewTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("history_user")
        self.client = _auth_client(self.user)

    def test_unauthenticated_returns_401(self):
        resp = APIClient().get("/api/cash-flow/history/")
        self.assertEqual(resp.status_code, 401)

    def test_empty_history_returns_empty_list(self):
        resp = self.client.get("/api/cash-flow/history/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_history_includes_month_with_quick_expense(self):
        today = datetime.date.today()
        QuickExpense.objects.create(
            company=self.company,
            date=today,
            amount=Decimal("250.00"),
            category="fuel",
            cost_type="direct",
            document_type="paragon",
        )
        resp = self.client.get("/api/cash-flow/history/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        period = f"{today.year}-{today.month:02d}"
        self.assertEqual(data[0]["period"], period)

    def test_history_item_has_required_fields(self):
        today = datetime.date.today()
        QuickExpense.objects.create(
            company=self.company,
            date=today,
            amount=Decimal("100.00"),
            category="fuel",
            cost_type="direct",
            document_type="paragon",
        )
        resp = self.client.get("/api/cash-flow/history/")
        item = resp.json()[0]
        for field in ("period", "revenue_total", "costs_total", "really_yours", "is_loss", "margin_pct"):
            self.assertIn(field, item, f"Missing field: {field}")

    def test_history_newest_first(self):
        # Two expenses in different months
        today = datetime.date.today()
        prev_month = (today.replace(day=1) - datetime.timedelta(days=1))
        QuickExpense.objects.create(
            company=self.company, date=today,
            amount=Decimal("100.00"), category="fuel",
            cost_type="direct", document_type="paragon",
        )
        QuickExpense.objects.create(
            company=self.company, date=prev_month,
            amount=Decimal("50.00"), category="fuel",
            cost_type="direct", document_type="paragon",
        )
        resp = self.client.get("/api/cash-flow/history/")
        data = resp.json()
        self.assertEqual(len(data), 2)
        # Newest first
        self.assertGreater(data[0]["period"], data[1]["period"])

    def test_empty_months_not_included(self):
        # Only one month has data — history should not include gap months
        QuickExpense.objects.create(
            company=self.company,
            date=datetime.date.today(),
            amount=Decimal("100.00"), category="fuel",
            cost_type="direct", document_type="paragon",
        )
        resp = self.client.get("/api/cash-flow/history/")
        self.assertEqual(len(resp.json()), 1)
