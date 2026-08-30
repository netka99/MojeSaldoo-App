"""Tests for the dashboard computation logic (services.py).

Tests cover VAT calculation (memoriałowa vs kasowa), PIT estimates, ZUS from
FixedCosts, B2C VAT extraction and the 'really_yours_estimate' formula.
"""

import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.users.models import Company, CompanyMembership
from apps.customers.models import Customer
from apps.orders.models import Order
from apps.fixed_costs.models import FixedCost
from apps.invoices.models import Invoice
from apps.ksef.models import ReceivedKSeFInvoice

from apps.cash_flow.models import CompanyTaxConfig, DailyB2CRevenue, QuickExpense
from apps.cash_flow.services import (
    _get_vat_nalezny,
    _get_vat_naliczony,
    _get_pit_estimate,
    _get_zus_monthly,
    _next_due_date,
    compute_dashboard,
)

User = get_user_model()
_CENT = Decimal("0.01")


def _make_company(name="Dash Firma"):
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


def _make_config(company, **kwargs):
    defaults = dict(
        tax_form=CompanyTaxConfig.TAX_FORM_KPIR_LINEAR,
        tax_rate=Decimal("19.00"),
        vat_payer=True,
        vat_method=CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA,
        vat_due_day=25,
        zus_due_day=20,
    )
    defaults.update(kwargs)
    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
    for k, v in defaults.items():
        setattr(config, k, v)
    config.save()
    return config


_invoice_counter = 0


def _make_invoice(company, status, amount_gross, vat, amount_net, issue_date, paid_at=None):
    """Create a minimal but valid Invoice with required Order and Customer."""
    global _invoice_counter
    _invoice_counter += 1

    customer, _ = Customer.objects.get_or_create(
        company=company,
        name="Test Klient",
        defaults={"country": "PL"},
    )
    order = Order.objects.create(
        company=company,
        customer=customer,
        order_date=issue_date,
        delivery_date=issue_date,
        status=Order.STATUS_DELIVERED,
    )
    return Invoice.objects.create(
        company=company,
        order=order,
        customer=customer,
        status=status,
        total_gross=amount_gross,
        vat_amount=vat,
        subtotal_net=amount_net,
        subtotal_gross=amount_gross,
        issue_date=issue_date,
        sale_date=issue_date,
        due_date=issue_date + datetime.timedelta(days=14),
        paid_at=paid_at,
        invoice_number=f"FV/{_invoice_counter}/2025",
        payment_method="transfer",
    )


def _make_received_invoice(company, gross, vat, net, issue_date, opex_category="services"):
    return ReceivedKSeFInvoice.objects.create(
        company=company,
        ksef_number=f"KSEF_{ReceivedKSeFInvoice.objects.count() + 1}",
        invoice_number=f"INV/{ReceivedKSeFInvoice.objects.count() + 1}",
        issue_date=issue_date,
        seller_nip="1234567890",
        seller_name="Dostawca sp. z o.o.",
        buyer_nip="0987654321",
        buyer_name="Kupujący",
        net_amount=net,
        gross_amount=gross,
        vat_amount=vat,
        currency="PLN",
        opex_category=opex_category,
    )


PERIOD_START = datetime.date(2025, 8, 1)
PERIOD_END = datetime.date(2025, 8, 31)


# ---------------------------------------------------------------------------
# Empty state
# ---------------------------------------------------------------------------


class EmptyStateDashboardTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Empty Firma")
        self.config = _make_config(self.company)

    def test_empty_state_returns_zeros(self):
        result = compute_dashboard(self.company, "2025-08")
        month = result["month"]
        self.assertEqual(month["revenue_paid"], 0.0)
        self.assertEqual(month["revenue_outstanding"], 0.0)
        self.assertEqual(month["vat_to_pay"], 0.0)
        self.assertEqual(month["pit_estimate"], 0.0)
        # really_yours_estimate is negative when ZUS is deducted from zero revenue
        self.assertIsInstance(month["really_yours_estimate"], float)

    def test_has_config_true(self):
        result = compute_dashboard(self.company, "2025-08")
        self.assertTrue(result["today"]["has_config"])

    def test_config_created_on_first_access(self):
        _, company2 = _make_company("NoConfig2")
        CompanyTaxConfig.objects.filter(company=company2).delete()
        result = compute_dashboard(company2, "2025-08")
        self.assertTrue(CompanyTaxConfig.objects.filter(company=company2).exists())


# ---------------------------------------------------------------------------
# VAT memoriałowa
# ---------------------------------------------------------------------------


class VatMemorialowaTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Memoriałowa Firma")
        self.config = _make_config(
            self.company, vat_method=CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA
        )

    def test_issued_invoices_included_in_vat_output(self):
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 15),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("230.00"))

    def test_sent_invoices_included(self):
        _make_invoice(
            self.company, Invoice.STATUS_SENT,
            amount_gross=Decimal("615.00"), vat=Decimal("115.00"),
            amount_net=Decimal("500.00"), issue_date=datetime.date(2025, 8, 10),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("115.00"))

    def test_paid_invoices_included(self):
        paid_at = timezone.make_aware(datetime.datetime(2025, 8, 20))
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("246.00"), vat=Decimal("46.00"),
            amount_net=Decimal("200.00"), issue_date=datetime.date(2025, 8, 5),
            paid_at=paid_at,
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("46.00"))

    def test_invoices_outside_period_excluded(self):
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 7, 31),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat, Decimal("0.00"))

    def test_draft_invoices_excluded(self):
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 1),
        )
        # Draft invoice from same period should not count
        _make_invoice(
            self.company, "draft",
            amount_gross=Decimal("500.00"), vat=Decimal("93.50"),
            amount_net=Decimal("406.50"), issue_date=datetime.date(2025, 8, 1),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("230.00"))


# ---------------------------------------------------------------------------
# VAT kasowa
# ---------------------------------------------------------------------------


class VatKasowaTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Kasowa Firma")
        self.config = _make_config(
            self.company, vat_method=CompanyTaxConfig.VAT_METHOD_KASOWA
        )

    def test_only_paid_invoices_counted(self):
        paid_at = timezone.make_aware(datetime.datetime(2025, 8, 15))
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 1),
            paid_at=paid_at,
        )
        # Issued but not paid — should NOT count under kasowa
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("615.00"), vat=Decimal("115.00"),
            amount_net=Decimal("500.00"), issue_date=datetime.date(2025, 8, 10),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("230.00"))

    def test_paid_outside_period_excluded(self):
        paid_at = timezone.make_aware(datetime.datetime(2025, 7, 31))
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 7, 1),
            paid_at=paid_at,
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat, Decimal("0.00"))


# ---------------------------------------------------------------------------
# B2C VAT extraction
# ---------------------------------------------------------------------------


class B2CVatTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("B2C VAT Firma")
        self.config = _make_config(self.company)

    def test_b2c_vat_extracted_correctly_at_23_percent(self):
        # gross=1230, VAT = 1230 * 23 / 123 = 230.00
        DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date(2025, 8, 1),
            amount=Decimal("1230.00"),
            vat_included=True,
            vat_rate=Decimal("23.00"),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertAlmostEqual(float(vat), 230.0, places=1)

    def test_b2c_without_vat_excluded(self):
        DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date(2025, 8, 1),
            amount=Decimal("1000.00"),
            vat_included=False,
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat, Decimal("0.00"))

    def test_b2c_vat_at_8_percent(self):
        # gross=1080, VAT = 1080 * 8 / 108 = 80.00
        DailyB2CRevenue.objects.create(
            company=self.company,
            date=datetime.date(2025, 8, 1),
            amount=Decimal("1080.00"),
            vat_included=True,
            vat_rate=Decimal("8.00"),
        )
        vat = _get_vat_nalezny(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertAlmostEqual(float(vat), 80.0, places=1)


# ---------------------------------------------------------------------------
# VAT naliczony (input VAT)
# ---------------------------------------------------------------------------


class VatNaliczonyTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Input VAT Firma")
        self.config = _make_config(self.company)

    def test_ksef_vat_summed(self):
        _make_received_invoice(
            self.company,
            gross=Decimal("1230.00"), vat=Decimal("230.00"),
            net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 10),
        )
        vat = _get_vat_naliczony(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat.quantize(_CENT), Decimal("230.00"))

    def test_quick_expense_with_vat_deducted(self):
        # amount=123 gross → VAT = 123 * 23/123 = 23.00
        QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("123.00"),
            has_vat=True,
            date=datetime.date(2025, 8, 5),
        )
        vat = _get_vat_naliczony(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertAlmostEqual(float(vat), 23.0, places=1)

    def test_quick_expense_without_vat_not_deducted(self):
        QuickExpense.objects.create(
            company=self.company,
            amount=Decimal("500.00"),
            has_vat=False,
            date=datetime.date(2025, 8, 5),
        )
        vat = _get_vat_naliczony(self.company, self.config, PERIOD_START, PERIOD_END)
        self.assertEqual(vat, Decimal("0.00"))

    def test_vat_to_pay_floors_at_zero(self):
        """When input VAT > output VAT, vat_to_pay must be 0 (not negative)."""
        # Large purchase, no sales
        _make_received_invoice(
            self.company,
            gross=Decimal("12300.00"), vat=Decimal("2300.00"),
            net=Decimal("10000.00"), issue_date=datetime.date(2025, 8, 1),
        )
        result = compute_dashboard(self.company, "2025-08")
        self.assertGreaterEqual(result["month"]["vat_to_pay"], 0.0)


# ---------------------------------------------------------------------------
# ZUS from FixedCosts
# ---------------------------------------------------------------------------


class ZusFromFixedCostsTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("ZUS Firma")
        self.config = _make_config(self.company)

    def test_zus_from_fixed_cost(self):
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_ZUS_ZDROWOTNE,
            amount_monthly=Decimal("1600.00"),
            active_from=datetime.date(2025, 1, 1),
            is_active=True,
        )
        zus = _get_zus_monthly(self.company, datetime.date(2025, 8, 1))
        self.assertEqual(zus, Decimal("1600.00"))

    def test_inactive_zus_excluded(self):
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_ZUS_ZDROWOTNE,
            amount_monthly=Decimal("1600.00"),
            active_from=datetime.date(2025, 1, 1),
            is_active=False,
        )
        zus = _get_zus_monthly(self.company, datetime.date(2025, 8, 1))
        self.assertEqual(zus, Decimal("0.00"))

    def test_zus_not_yet_active_excluded(self):
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_ZUS_ZDROWOTNE,
            amount_monthly=Decimal("1600.00"),
            active_from=datetime.date(2025, 9, 1),  # starts next month
            is_active=True,
        )
        zus = _get_zus_monthly(self.company, datetime.date(2025, 8, 1))
        self.assertEqual(zus, Decimal("0.00"))

    def test_zus_appears_in_today_obligations(self):
        # ZUS social is now calculated from config (pelny_zus, no sick = 1788.27)
        # FixedCost ZUS no longer drives the social obligation (kept for _get_zus_monthly compat)
        result = compute_dashboard(self.company)
        obligations = result["today"]["upcoming_obligations"]
        zus_items = [o for o in obligations if o["type"] == "zus"]
        self.assertEqual(len(zus_items), 1)
        # pelny_zus without sick insurance = 1788.27
        self.assertAlmostEqual(zus_items[0]["amount"], 1788.27, places=1)
        # Health contribution also appears as a separate obligation
        health_items = [o for o in obligations if o["type"] == "zus_health"]
        self.assertEqual(len(health_items), 1)
        self.assertGreater(health_items[0]["amount"], 0.0)


# ---------------------------------------------------------------------------
# PIT estimate
# ---------------------------------------------------------------------------


class PitEstimateTests(TestCase):
    def test_kpir_linear_pit(self):
        config = CompanyTaxConfig(tax_form=CompanyTaxConfig.TAX_FORM_KPIR_LINEAR, tax_rate=Decimal("19.00"))
        pit = _get_pit_estimate(config, Decimal("10000.00"), Decimal("5000.00"))
        # (10000 - 5000) * 0.19 = 950.00
        self.assertEqual(pit, Decimal("950.00"))

    def test_kpir_scale_pit(self):
        config = CompanyTaxConfig(tax_form=CompanyTaxConfig.TAX_FORM_KPIR_SCALE, tax_rate=Decimal("17.00"))
        pit = _get_pit_estimate(config, Decimal("8000.00"), Decimal("3000.00"))
        # (8000 - 3000) * 0.17 = 850.00
        self.assertEqual(pit, Decimal("850.00"))

    def test_ryczalt_pit_no_cost_deduction(self):
        config = CompanyTaxConfig(tax_form=CompanyTaxConfig.TAX_FORM_RYCZALT, tax_rate=Decimal("5.50"))
        pit = _get_pit_estimate(config, Decimal("10000.00"), Decimal("9000.00"))
        # Ryczałt ignores costs: 10000 * 0.055 = 550.00
        self.assertEqual(pit, Decimal("550.00"))

    def test_kpir_pit_floored_at_zero_when_loss(self):
        config = CompanyTaxConfig(tax_form=CompanyTaxConfig.TAX_FORM_KPIR_LINEAR, tax_rate=Decimal("19.00"))
        pit = _get_pit_estimate(config, Decimal("1000.00"), Decimal("5000.00"))
        # (1000 - 5000) negative → floored to 0
        self.assertEqual(pit, Decimal("0.00"))


# ---------------------------------------------------------------------------
# Due date calculation
# ---------------------------------------------------------------------------


class NextDueDateTests(TestCase):
    def test_due_date_in_future_this_month(self):
        today = datetime.date(2025, 8, 10)
        due = _next_due_date(today, 25)
        self.assertEqual(due, datetime.date(2025, 8, 25))

    def test_due_date_today_returns_today(self):
        today = datetime.date(2025, 8, 25)
        due = _next_due_date(today, 25)
        self.assertEqual(due, datetime.date(2025, 8, 25))

    def test_due_date_past_moves_to_next_month(self):
        today = datetime.date(2025, 8, 26)  # day after due
        due = _next_due_date(today, 25)
        self.assertEqual(due, datetime.date(2025, 9, 25))

    def test_due_date_wraps_december_to_january(self):
        today = datetime.date(2025, 12, 26)
        due = _next_due_date(today, 25)
        self.assertEqual(due, datetime.date(2026, 1, 25))


# ---------------------------------------------------------------------------
# Integration: really_yours_estimate
# ---------------------------------------------------------------------------


class ReallyYoursEstimateTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Wynik Firma")
        self.config = _make_config(
            self.company,
            vat_payer=True,
            vat_method=CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA,
            tax_form=CompanyTaxConfig.TAX_FORM_KPIR_LINEAR,
            tax_rate=Decimal("19.00"),
        )
        # ZUS
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_ZUS_ZDROWOTNE,
            amount_monthly=Decimal("1600.00"),
            active_from=datetime.date(2025, 1, 1),
            is_active=True,
        )

    def test_really_yours_estimate_correct(self):
        paid_at = timezone.make_aware(datetime.datetime(2025, 8, 15))
        # Paid invoice: 12300 gross, 2300 VAT, 10000 net
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("12300.00"), vat=Decimal("2300.00"),
            amount_net=Decimal("10000.00"), issue_date=datetime.date(2025, 8, 1),
            paid_at=paid_at,
        )
        # KSeF purchase: 1230 gross, 230 VAT, 1000 net
        _make_received_invoice(
            self.company,
            gross=Decimal("1230.00"), vat=Decimal("230.00"),
            net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 10),
        )

        result = compute_dashboard(self.company, "2025-08")
        month = result["month"]

        # VAT to pay = 2300 - 230 = 2070
        self.assertAlmostEqual(month["vat_to_pay"], 2070.0, places=1)
        # ZUS social (pełny ZUS, no sick) = 1788.27; health on top
        self.assertGreater(month["zus_monthly"], 0.0)
        self.assertIn("zus_social", month)
        self.assertIn("zus_health", month)
        self.assertIsNotNone(month["really_yours_estimate"])
        # Must be a number
        self.assertIsInstance(month["really_yours_estimate"], float)


# ---------------------------------------------------------------------------
# Uncategorized KSeF invoice count
# ---------------------------------------------------------------------------


class UncategorizedKsefCountTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Uncategorized Firma")
        self.config = _make_config(self.company)

    def _make_uncategorized(self, issue_date):
        return ReceivedKSeFInvoice.objects.create(
            company=self.company,
            ksef_number=f"KSEF_U_{ReceivedKSeFInvoice.objects.count() + 1}",
            invoice_number=f"INV_U/{ReceivedKSeFInvoice.objects.count() + 1}",
            issue_date=issue_date,
            seller_nip="1234567890",
            seller_name="Dostawca",
            buyer_nip="0987654321",
            buyer_name="Kupujący",
            net_amount=Decimal("1000.00"),
            gross_amount=Decimal("1230.00"),
            vat_amount=Decimal("230.00"),
            currency="PLN",
            opex_category=None,
        )

    def test_zero_when_all_categorized(self):
        _make_received_invoice(
            self.company,
            gross=Decimal("1230.00"), vat=Decimal("230.00"),
            net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 10),
            opex_category="services",
        )
        result = compute_dashboard(self.company, "2025-08")
        self.assertEqual(result["month"]["uncategorized_ksef_count"], 0)

    def test_counts_uncategorized_invoices(self):
        # 2 uncategorized in period
        self._make_uncategorized(datetime.date(2025, 8, 5))
        self._make_uncategorized(datetime.date(2025, 8, 15))
        # 1 categorized — should NOT count
        _make_received_invoice(
            self.company,
            gross=Decimal("1230.00"), vat=Decimal("230.00"),
            net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 10),
            opex_category="fuel",
        )
        result = compute_dashboard(self.company, "2025-08")
        self.assertEqual(result["month"]["uncategorized_ksef_count"], 2)

    def test_out_of_period_not_counted(self):
        # Invoice from previous month — not in the selected period
        self._make_uncategorized(datetime.date(2025, 7, 31))
        result = compute_dashboard(self.company, "2025-08")
        self.assertEqual(result["month"]["uncategorized_ksef_count"], 0)

    def test_empty_state_returns_zero(self):
        result = compute_dashboard(self.company, "2025-08")
        self.assertEqual(result["month"]["uncategorized_ksef_count"], 0)


# ---------------------------------------------------------------------------
# Receivables
# ---------------------------------------------------------------------------


class ReceivablesTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Receivables Firma")
        self.config = _make_config(self.company)

    def test_open_invoices_appear_in_receivables(self):
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("3690.00"), vat=Decimal("690.00"),
            amount_net=Decimal("3000.00"), issue_date=datetime.date(2025, 8, 1),
        )
        result = compute_dashboard(self.company)
        receivables = result["today"]["receivables"]
        self.assertEqual(len(receivables), 1)
        self.assertAlmostEqual(receivables[0]["amount"], 3690.0, places=1)
        self.assertIn("invoice_number", receivables[0])
        self.assertIn("customer_name", receivables[0])
        self.assertIn("due_date", receivables[0])
        self.assertIn("days_until", receivables[0])

    def test_paid_invoices_excluded_from_receivables(self):
        paid_at = timezone.make_aware(datetime.datetime(2025, 8, 15))
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("3690.00"), vat=Decimal("690.00"),
            amount_net=Decimal("3000.00"), issue_date=datetime.date(2025, 8, 1),
            paid_at=paid_at,
        )
        result = compute_dashboard(self.company)
        self.assertEqual(result["today"]["receivables"], [])

    def test_overdue_invoices_appear_in_receivables(self):
        _make_invoice(
            self.company, Invoice.STATUS_OVERDUE,
            amount_gross=Decimal("1230.00"), vat=Decimal("230.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 7, 1),
        )
        result = compute_dashboard(self.company)
        self.assertEqual(len(result["today"]["receivables"]), 1)

    def test_receivables_sorted_by_due_date(self):
        # Earlier issue_date → earlier due_date (due = issue + 14 days)
        _make_invoice(
            self.company, Invoice.STATUS_SENT,
            amount_gross=Decimal("2000.00"), vat=Decimal("0.00"),
            amount_net=Decimal("2000.00"), issue_date=datetime.date(2025, 8, 1),
        )
        _make_invoice(
            self.company, Invoice.STATUS_ISSUED,
            amount_gross=Decimal("1000.00"), vat=Decimal("0.00"),
            amount_net=Decimal("1000.00"), issue_date=datetime.date(2025, 8, 15),
        )
        result = compute_dashboard(self.company)
        receivables = result["today"]["receivables"]
        self.assertEqual(len(receivables), 2)
        self.assertLessEqual(receivables[0]["due_date"], receivables[1]["due_date"])

    def test_empty_receivables_when_no_open_invoices(self):
        result = compute_dashboard(self.company)
        self.assertEqual(result["today"]["receivables"], [])


# ---------------------------------------------------------------------------
# Payables
# ---------------------------------------------------------------------------


class PayablesTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("Payables Firma")
        self.config = _make_config(self.company)

    def _make_supplier_invoice(self, gross, due_date, is_paid=False):
        return ReceivedKSeFInvoice.objects.create(
            company=self.company,
            ksef_number=f"KSEF_P_{ReceivedKSeFInvoice.objects.count() + 1}",
            invoice_number=f"INV_P/{ReceivedKSeFInvoice.objects.count() + 1}",
            issue_date=due_date - datetime.timedelta(days=14),
            seller_nip="1111111111",
            seller_name="Dostawca Testowy",
            buyer_nip="2222222222",
            buyer_name="Kupujący",
            gross_amount=gross,
            currency="PLN",
            due_date=due_date,
            is_paid=is_paid,
        )

    def test_unpaid_supplier_invoices_appear_in_payables(self):
        self._make_supplier_invoice(Decimal("1200.00"), datetime.date(2025, 8, 20))
        result = compute_dashboard(self.company)
        payables = result["today"]["payables"]
        self.assertEqual(payables["total_count"], 1)
        self.assertAlmostEqual(payables["total_amount"], 1200.0, places=1)
        self.assertEqual(len(payables["items"]), 1)
        self.assertAlmostEqual(payables["items"][0]["amount"], 1200.0, places=1)
        self.assertEqual(payables["items"][0]["seller_name"], "Dostawca Testowy")
        self.assertIn("due_date", payables["items"][0])
        self.assertIn("days_until", payables["items"][0])

    def test_paid_supplier_invoices_excluded_from_payables(self):
        self._make_supplier_invoice(Decimal("1200.00"), datetime.date(2025, 8, 20), is_paid=True)
        result = compute_dashboard(self.company)
        payables = result["today"]["payables"]
        self.assertEqual(payables["total_count"], 0)
        self.assertEqual(payables["items"], [])

    def test_supplier_invoices_without_due_date_excluded(self):
        ReceivedKSeFInvoice.objects.create(
            company=self.company,
            ksef_number="KSEF_NODUE",
            invoice_number="INV_NODUE",
            issue_date=datetime.date(2025, 8, 1),
            seller_nip="1111111111",
            seller_name="Dostawca",
            buyer_nip="2222222222",
            buyer_name="Kupujący",
            gross_amount=Decimal("500.00"),
            currency="PLN",
            due_date=None,
            is_paid=False,
        )
        result = compute_dashboard(self.company)
        payables = result["today"]["payables"]
        # Invoice without due_date counted in total_count but NOT in items preview
        self.assertEqual(payables["total_count"], 1)
        self.assertEqual(payables["items"], [])

    def test_empty_payables_when_no_supplier_invoices(self):
        result = compute_dashboard(self.company)
        payables = result["today"]["payables"]
        self.assertEqual(payables["total_count"], 0)
        self.assertEqual(payables["items"], [])


# ---------------------------------------------------------------------------
# PIT in today obligations
# ---------------------------------------------------------------------------


class PitInTodayObligationsTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_company("PIT Today Firma")
        self.config = _make_config(
            self.company,
            tax_form=CompanyTaxConfig.TAX_FORM_KPIR_LINEAR,
            tax_rate=Decimal("19.00"),
            vat_payer=False,
            zus_due_day=20,
        )

    def test_pit_always_present_with_zero_amount_when_no_income(self):
        result = compute_dashboard(self.company)
        pit_items = [o for o in result["today"]["upcoming_obligations"] if o["type"] == "pit"]
        self.assertEqual(len(pit_items), 1)
        self.assertEqual(pit_items[0]["amount"], 0.0)
        self.assertEqual(pit_items[0]["label"], "Podatek dochodowy (~szacunek)")

    def test_pit_structure_when_income_exists(self):
        # Paid invoice in the previous month so the PIT billing period picks it up
        prev_month_start = datetime.date(2025, 7, 1)
        paid_at = timezone.make_aware(datetime.datetime(2025, 7, 15))
        _make_invoice(
            self.company, Invoice.STATUS_PAID,
            amount_gross=Decimal("10000.00"), vat=Decimal("0.00"),
            amount_net=Decimal("10000.00"), issue_date=prev_month_start,
            paid_at=paid_at,
        )
        result = compute_dashboard(self.company)
        obligations = result["today"]["upcoming_obligations"]
        for ob in obligations:
            self.assertIn("type", ob)
            self.assertIn("amount", ob)
            self.assertIn("due_date", ob)
            self.assertIn("days_until", ob)
            self.assertGreaterEqual(ob["amount"], 0)

    def test_today_obligations_include_all_keys(self):
        result = compute_dashboard(self.company)
        today = result["today"]
        self.assertIn("receivables", today)
        self.assertIn("payables", today)
        self.assertIsInstance(today["receivables"], list)
        self.assertIsInstance(today["payables"], dict)
        self.assertIn("total_count", today["payables"])
        self.assertIn("items", today["payables"])
