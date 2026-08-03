import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.users.models import Company, CompanyMembership
from apps.cash_flow.models import CompanyTaxConfig, DailyB2CRevenue, QuickExpense

User = get_user_model()


def _make_company(name="Test Firma"):
    import uuid as _uuid
    company = Company.objects.create(name=name, is_active=True)
    unique = _uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        username=f"user_{unique}",
        email=f"{unique}@test.example",
        password="pass",
    )
    CompanyMembership.objects.create(user=user, company=company, role="admin", is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    return user, company


class CompanyTaxConfigModelTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company()

    def test_default_values(self):
        config = CompanyTaxConfig.objects.create(company=self.company)
        self.assertEqual(config.tax_form, CompanyTaxConfig.TAX_FORM_KPIR_LINEAR)
        self.assertEqual(config.tax_rate, Decimal("19.00"))
        self.assertTrue(config.vat_payer)
        self.assertEqual(config.vat_method, CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA)
        self.assertEqual(config.vat_due_day, 25)
        self.assertEqual(config.zus_due_day, 20)
        self.assertEqual(config.cash_balance, Decimal("0.00"))
        self.assertEqual(config.bank_balance, Decimal("0.00"))
        self.assertIsNone(config.balance_updated_at)

    def test_get_or_create_idempotent(self):
        config1, created1 = CompanyTaxConfig.objects.get_or_create(company=self.company)
        config2, created2 = CompanyTaxConfig.objects.get_or_create(company=self.company)
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(config1.pk, config2.pk)

    def test_str_representation(self):
        config = CompanyTaxConfig.objects.create(company=self.company)
        self.assertIn(self.company.name, str(config))

    def test_one_to_one_constraint(self):
        CompanyTaxConfig.objects.create(company=self.company)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            CompanyTaxConfig.objects.create(company=self.company)


class QuickExpenseModelTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("QE Firma")

    def test_date_defaults_to_today(self):
        exp = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("100.00"),
            category=QuickExpense.CAT_FUEL,
        )
        self.assertEqual(exp.date, datetime.date.today())

    def test_cost_type_defaults_to_indirect(self):
        exp = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("50.00"),
        )
        self.assertEqual(exp.cost_type, QuickExpense.COST_TYPE_INDIRECT)

    def test_has_vat_defaults_false(self):
        exp = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("50.00"),
        )
        self.assertFalse(exp.has_vat)

    def test_str_representation(self):
        exp = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("123.45"),
            category=QuickExpense.CAT_FUEL,
        )
        s = str(exp)
        self.assertIn("123.45", s)

    def test_ordering_newest_first(self):
        exp1 = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("10.00"),
            date=datetime.date(2025, 1, 1),
        )
        exp2 = QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("20.00"),
            date=datetime.date(2025, 2, 1),
        )
        qs = QuickExpense.objects.filter(company=self.company)
        self.assertEqual(qs.first().pk, exp2.pk)


class DailyB2CRevenueModelTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("B2C Firma")

    def test_default_vat_rate(self):
        rev = DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date.today(),
            amount=Decimal("1000.00"),
        )
        self.assertEqual(rev.vat_rate, Decimal("23.00"))

    def test_vat_included_defaults_true(self):
        rev = DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date.today(),
            amount=Decimal("500.00"),
        )
        self.assertTrue(rev.vat_included)

    def test_str_representation(self):
        rev = DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date(2025, 8, 1),
            amount=Decimal("999.00"),
        )
        self.assertIn("999.00", str(rev))
