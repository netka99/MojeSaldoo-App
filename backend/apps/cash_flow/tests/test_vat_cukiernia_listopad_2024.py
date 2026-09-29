"""November 2024 confectionery VAT pack vs the cash-flow engine.

Gold numbers come from a real JPK_V7M (anonymised). Purchases are FZ/PAR/PAR_VAT
— KSeF was not in use that month.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.cash_flow.cukiernia_vat import (
    gold,
    intended_purchases,
    intended_row_vat,
    intended_sales,
    load_fixture,
    period_bounds,
    rows_by_id,
    seed_cukiernia_vat,
)
from apps.cash_flow.models import CompanyTaxConfig
from apps.cash_flow.services import _get_vat_naliczony, _get_vat_nalezny
from apps.common.vat import q
from apps.users.models import Company, CompanyMembership

User = get_user_model()


class CukierniaVatFixtureTests(TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.gold = gold(self.fixture)
        self.rows = rows_by_id(self.fixture)

    def test_intended_totals_match_vat7_gold(self):
        sales_net, sales_vat = intended_sales(self.fixture)
        purch_net, purch_vat = intended_purchases(self.fixture)
        self.assertEqual(sales_net, self.gold["sales_net"])
        self.assertEqual(sales_vat, self.gold["vat_nalezny"])
        self.assertEqual(purch_net, self.gold["purchases_net_deductible"])
        self.assertEqual(purch_vat, self.gold["vat_naliczony"])
        self.assertEqual(sales_vat - purch_vat, self.gold["vat_to_pay"])

    def test_passenger_car_is_half(self):
        self.assertEqual(intended_row_vat(self.rows["shell"]), Decimal("23.00"))
        self.assertEqual(intended_row_vat(self.rows["bmw"]), Decimal("17.25"))

    def test_private_par_vat_is_zero(self):
        self.assertEqual(intended_row_vat(self.rows["private-par-vat"]), Decimal("0.00"))

    def test_quick_expense_uses_eight_percent(self):
        self.assertEqual(intended_row_vat(self.rows["biedronka-8pct-quick"]), Decimal("8.00"))

    def test_par_without_nip_is_zero(self):
        self.assertEqual(intended_row_vat(self.rows["biedronka-par-no-nip"]), Decimal("0.00"))

    def test_fixture_has_no_ksef_rows(self):
        self.assertFalse(any(row["source"] == "ksef" for row in self.fixture["purchases"]))


class CukierniaVatEngineTests(TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.gold = gold(self.fixture)
        self.start, self.end = period_bounds(self.fixture)
        self.company = Company.objects.create(
            name="Cukiernia VAT engine test",
            nip="5550000099",
            is_vat_payer=True,
        )
        user = User.objects.create_user(
            username="vat11_tester",
            email="vat11@test.invalid",
            password="pass",
        )
        CompanyMembership.objects.create(
            user=user, company=self.company, role="admin", is_active=True
        )
        user.current_company = self.company
        user.save(update_fields=["current_company"])
        seed_cukiernia_vat(self.company, reset=True)
        self.config = CompanyTaxConfig.objects.get(company=self.company)

    def test_output_vat_matches_gold(self):
        vat = _get_vat_nalezny(self.company, self.config, self.start, self.end)
        self.assertEqual(q(vat), self.gold["vat_nalezny"])

    def test_engine_input_vat_matches_gold(self):
        vat = _get_vat_naliczony(self.company, self.config, self.start, self.end)
        self.assertEqual(q(vat), self.gold["vat_naliczony"])
        due = _get_vat_nalezny(self.company, self.config, self.start, self.end) - vat
        self.assertEqual(q(due), self.gold["vat_to_pay"])
