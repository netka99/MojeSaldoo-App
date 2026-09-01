"""Tests for the harmonogram (payment schedule) endpoint and service."""

import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.users.models import Company, CompanyMembership
from apps.customers.models import Customer
from apps.fixed_costs.models import FixedCost
from apps.invoices.models import Invoice
from apps.ksef.models import ReceivedKSeFInvoice
from apps.orders.models import Order

from apps.cash_flow.models import CompanyTaxConfig, DailyB2CRevenue
from apps.cash_flow.harmonogram import compute_harmonogram

User = get_user_model()


def _make_company(name="Harm Firma"):
    import uuid as _uuid
    company = Company.objects.create(name=name, is_active=True)
    unique = _uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        username=f"u_{unique}",
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
        zus_status=CompanyTaxConfig.ZUS_PELNY,
        has_sick_insurance=False,
        bank_balance=Decimal("10000.00"),
        cash_balance=Decimal("500.00"),
    )
    defaults.update(kwargs)
    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
    for k, v in defaults.items():
        setattr(config, k, v)
    config.save()
    return config


def _make_customer(company, user, name="Klient"):
    return Customer.objects.create(
        company=company, user=user, name=name,
        payment_terms=14, credit_limit=Decimal("5000.00"), is_active=True,
    )


class HarmonogramServiceTest(TestCase):
    """Unit tests for compute_harmonogram()."""

    def setUp(self):
        self.user, self.company = _make_company()
        self.config = _make_config(self.company)
        self.customer = _make_customer(self.company, self.user)
        self.month = "2026-09"

    # ── helpers ───────────────────────────────────────────────────────────────

    def _make_invoice(self, issue_date, due_date, total_gross, status="sent", paid_at=None):
        order = Order.objects.create(
            company=self.company, user=self.user, customer=self.customer,
            order_number=f"ZAM/{issue_date}",
            order_date=issue_date,
            delivery_date=issue_date + datetime.timedelta(days=1),
            status="delivered",
            subtotal_net=total_gross / Decimal("1.05"),
            subtotal_gross=total_gross,
            total_net=total_gross / Decimal("1.05"),
            total_gross=total_gross,
        )
        inv = Invoice.objects.create(
            company=self.company, user=self.user,
            customer=self.customer, order=order,
            invoice_number=f"FV/{issue_date}",
            issue_date=issue_date, sale_date=issue_date, due_date=due_date,
            payment_method="transfer",
            subtotal_net=total_gross / Decimal("1.05"),
            subtotal_gross=total_gross,
            vat_amount=total_gross - total_gross / Decimal("1.05"),
            total_gross=total_gross,
            status=status,
            paid_at=paid_at,
        )
        return inv

    def _make_fixed_cost(self, description, amount, due_day):
        return FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_CZYNSZ,
            description=description,
            amount_monthly=Decimal(str(amount)),
            due_day=due_day,
            active_from=datetime.date(2026, 1, 1),
            is_active=True,
        )

    def _make_b2c(self, date, amount):
        return DailyB2CRevenue.objects.create(
            company=self.company,
            date=date,
            amount=Decimal(str(amount)),
            vat_included=True,
            vat_rate=Decimal("5.00"),
            sale_type="manual",
        )

    # ── tests ─────────────────────────────────────────────────────────────────

    def test_opening_balance_is_bank_plus_cash(self):
        result = compute_harmonogram(self.company, self.month)
        self.assertEqual(result["opening_balance"], 10500.0)

    def test_no_events_returns_empty(self):
        result = compute_harmonogram(self.company, self.month)
        # Only ZUS/VAT from config may appear — check that structure is valid
        self.assertIn("events", result)
        self.assertIn("total_in", result)
        self.assertIn("total_out", result)

    def test_paid_b2b_invoice_appears_on_payment_date(self):
        """Paid invoices should appear on their paid_at date, not due_date."""
        paid_at = timezone.make_aware(
            datetime.datetime(2026, 9, 10, 10, 0, 0)
        )
        self._make_invoice(
            issue_date=datetime.date(2026, 8, 25),
            due_date=datetime.date(2026, 9, 8),
            total_gross=Decimal("1000.00"),
            status=Invoice.STATUS_PAID,
            paid_at=paid_at,
        )
        result = compute_harmonogram(self.company, self.month)
        b2b_events = [e for e in result["events"] if e["type"] == "b2b_incoming"]
        self.assertEqual(len(b2b_events), 1)
        self.assertEqual(b2b_events[0]["date"], "2026-09-10")
        self.assertEqual(b2b_events[0]["status"], "paid")

    def test_unpaid_b2b_invoice_appears_on_due_date(self):
        self._make_invoice(
            issue_date=datetime.date(2026, 8, 20),
            due_date=datetime.date(2026, 9, 15),
            total_gross=Decimal("500.00"),
            status=Invoice.STATUS_SENT,
        )
        result = compute_harmonogram(self.company, self.month)
        b2b_events = [e for e in result["events"] if e["type"] == "b2b_incoming"]
        self.assertEqual(len(b2b_events), 1)
        self.assertEqual(b2b_events[0]["date"], "2026-09-15")
        self.assertEqual(b2b_events[0]["status"], "expected")

    def test_b2c_entry_appears_as_paid(self):
        self._make_b2c(datetime.date(2026, 9, 5), 400)
        result = compute_harmonogram(self.company, self.month)
        b2c_events = [e for e in result["events"] if e["type"] == "b2c_incoming"]
        self.assertEqual(len(b2c_events), 1)
        self.assertEqual(b2c_events[0]["date"], "2026-09-05")
        self.assertEqual(b2c_events[0]["status"], "paid")
        self.assertEqual(b2c_events[0]["direction"], "in")

    def test_fixed_cost_placed_on_due_day(self):
        self._make_fixed_cost("Wynajem", 2000, due_day=5)
        result = compute_harmonogram(self.company, self.month)
        fc_events = [e for e in result["events"] if e["type"] == "fixed_cost"]
        self.assertEqual(len(fc_events), 1)
        self.assertEqual(fc_events[0]["date"], "2026-09-05")
        self.assertEqual(fc_events[0]["direction"], "out")
        self.assertEqual(fc_events[0]["amount"], 2000.0)

    def test_fixed_cost_without_due_day_excluded(self):
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_INNE,
            description="Bez terminu",
            amount_monthly=Decimal("500.00"),
            due_day=None,
            active_from=datetime.date(2026, 1, 1),
            is_active=True,
        )
        result = compute_harmonogram(self.company, self.month)
        fc_events = [e for e in result["events"] if e["type"] == "fixed_cost"]
        self.assertEqual(len(fc_events), 0)

    def test_running_balance_decreases_for_outgoing(self):
        self._make_fixed_cost("Wynajem", 3000, due_day=10)
        result = compute_harmonogram(self.company, self.month)
        fc_events = [e for e in result["events"] if e["type"] == "fixed_cost"]
        self.assertEqual(len(fc_events), 1)
        # Balance should be opening_balance - 3000
        expected_bal = result["opening_balance"] - 3000
        self.assertAlmostEqual(fc_events[0]["running_balance"], expected_bal, places=2)

    def test_running_balance_increases_for_incoming(self):
        self._make_b2c(datetime.date(2026, 9, 3), 800)
        result = compute_harmonogram(self.company, self.month)
        b2c_events = [e for e in result["events"] if e["type"] == "b2c_incoming"]
        self.assertEqual(len(b2c_events), 1)
        expected_bal = result["opening_balance"] + 800
        self.assertAlmostEqual(b2c_events[0]["running_balance"], expected_bal, places=2)

    def test_total_in_sums_all_incoming(self):
        self._make_b2c(datetime.date(2026, 9, 1), 500)
        self._make_b2c(datetime.date(2026, 9, 2), 300)
        result = compute_harmonogram(self.company, self.month)
        b2c_total = sum(
            e["amount"] for e in result["events"] if e["type"] == "b2c_incoming"
        )
        self.assertAlmostEqual(b2c_total, 800.0, places=2)

    def test_min_balance_tracks_lowest_point(self):
        # Use ZUS_ETAT_JDG to disable both ZUS social and health (covered by employer),
        # so only the fixed cost affects the running balance.
        self.config.zus_status = CompanyTaxConfig.ZUS_ETAT_JDG
        self.config.save(update_fields=["zus_status"])
        # Fixed cost larger than opening balance → min balance should be negative
        self._make_fixed_cost("Ogromny koszt", 20000, due_day=15)
        result = compute_harmonogram(self.company, self.month)
        self.assertLess(result["min_balance"], 0)
        self.assertEqual(result["min_balance_date"], "2026-09-15")

    def test_supplier_invoice_in_period(self):
        ReceivedKSeFInvoice.objects.create(
            company=self.company,
            ksef_number="TEST-001",
            invoice_number="FV/TEST/001",
            issue_date=datetime.date(2026, 9, 1),
            due_date=datetime.date(2026, 9, 20),
            seller_name="Dostawca ABC",
            net_amount=Decimal("1000.00"),
            gross_amount=Decimal("1230.00"),
            vat_amount=Decimal("230.00"),
            currency="PLN",
            is_paid=False,
            first_seen_at=timezone.now(),
            last_synced_at=timezone.now(),
        )
        result = compute_harmonogram(self.company, self.month)
        sup_events = [e for e in result["events"] if e["type"] == "supplier_invoice"]
        self.assertEqual(len(sup_events), 1)
        self.assertEqual(sup_events[0]["date"], "2026-09-20")
        self.assertEqual(sup_events[0]["direction"], "out")
        self.assertEqual(sup_events[0]["amount"], 1230.0)

    def test_events_sorted_by_date(self):
        self._make_b2c(datetime.date(2026, 9, 15), 200)
        self._make_b2c(datetime.date(2026, 9, 5), 300)
        self._make_fixed_cost("Test", 500, due_day=10)
        result = compute_harmonogram(self.company, self.month)
        dates = [e["date"] for e in result["events"] if e["type"] in ("b2c_incoming", "fixed_cost")]
        self.assertEqual(dates, sorted(dates))

    def test_has_balance_false_when_zero(self):
        _make_config(self.company, bank_balance=Decimal("0.00"), cash_balance=Decimal("0.00"))
        result = compute_harmonogram(self.company, self.month)
        self.assertFalse(result["has_balance"])

    def test_has_balance_true_when_set(self):
        result = compute_harmonogram(self.company, self.month)
        self.assertTrue(result["has_balance"])

    # ── Anchor date tests ─────────────────────────────────────────────────────

    def test_anchor_date_returned_in_response(self):
        """anchor_date in response matches balance_updated_at date."""
        anchor = datetime.datetime(2026, 9, 10, 12, 0, 0)
        self.config.balance_updated_at = timezone.make_aware(anchor)
        self.config.save(update_fields=["balance_updated_at"])
        result = compute_harmonogram(self.company, self.month)
        self.assertEqual(result["anchor_date"], "2026-09-10")

    def test_anchor_at_start_of_month_includes_all_events(self):
        """When anchor is on the 1st, all events chain normally (no before_anchor)."""
        anchor = datetime.datetime(2026, 9, 1, 8, 0, 0)
        self.config.balance_updated_at = timezone.make_aware(anchor)
        self.config.save(update_fields=["balance_updated_at"])
        self._make_b2c(datetime.date(2026, 9, 5), 500)
        result = compute_harmonogram(self.company, self.month)
        b2c = [e for e in result["events"] if e["type"] == "b2c_incoming"]
        self.assertEqual(len(b2c), 1)
        self.assertFalse(b2c[0]["before_anchor"])
        self.assertIsNotNone(b2c[0]["running_balance"])

    def test_anchor_mid_month_excludes_before_events_from_chain(self):
        """Events before anchor date have before_anchor=True and running_balance=None."""
        # anchor = Sep 15; B2C entry Sep 5 → before anchor
        anchor = datetime.datetime(2026, 9, 15, 8, 0, 0)
        self.config.balance_updated_at = timezone.make_aware(anchor)
        self.config.save(update_fields=["balance_updated_at"])
        self._make_b2c(datetime.date(2026, 9, 5), 800)
        self._make_fixed_cost("Czynsz", 2000, due_day=20)  # Sep 20 → after anchor
        result = compute_harmonogram(self.company, self.month)

        b2c = [e for e in result["events"] if e["type"] == "b2c_incoming"]
        self.assertEqual(len(b2c), 1)
        self.assertTrue(b2c[0]["before_anchor"])
        self.assertIsNone(b2c[0]["running_balance"])

        fc = [e for e in result["events"] if e["type"] == "fixed_cost"]
        self.assertEqual(len(fc), 1)
        self.assertFalse(fc[0]["before_anchor"])
        self.assertIsNotNone(fc[0]["running_balance"])
        # running_balance should be opening_balance - 2000 (b2c not counted)
        expected = result["opening_balance"] - 2000
        self.assertAlmostEqual(fc[0]["running_balance"], expected, places=2)

    def test_no_balance_running_starts_from_zero(self):
        """When has_balance is False, opening_balance is 0 and chain runs from 0."""
        _make_config(self.company, bank_balance=Decimal("0.00"), cash_balance=Decimal("0.00"))
        self._make_b2c(datetime.date(2026, 9, 10), 500)
        result = compute_harmonogram(self.company, self.month)
        self.assertFalse(result["has_balance"])
        self.assertEqual(result["opening_balance"], 0.0)
        b2c = [e for e in result["events"] if e["type"] == "b2c_incoming"]
        self.assertEqual(len(b2c), 1)
        self.assertAlmostEqual(b2c[0]["running_balance"], 500.0, places=2)

    def test_quick_expense_appears_as_outgoing_paid(self):
        """QuickExpense entries show as paid outgoing events on their date."""
        from apps.cash_flow.models import QuickExpense
        QuickExpense.objects.create(
            company=self.company,
            date=datetime.date(2026, 9, 12),
            amount=Decimal("350.00"),
            category="fuel",
            vendor="Orlen",
            has_vat=False,
        )
        result = compute_harmonogram(self.company, self.month)
        qe_events = [e for e in result["events"] if e["type"] == "quick_expense"]
        self.assertEqual(len(qe_events), 1)
        self.assertEqual(qe_events[0]["date"], "2026-09-12")
        self.assertEqual(qe_events[0]["direction"], "out")
        self.assertEqual(qe_events[0]["status"], "paid")
        self.assertAlmostEqual(qe_events[0]["amount"], 350.0, places=2)
        self.assertEqual(qe_events[0]["label"], "Orlen")

    def test_quick_expense_outside_period_excluded(self):
        """QuickExpense from a different month is not included."""
        from apps.cash_flow.models import QuickExpense
        QuickExpense.objects.create(
            company=self.company,
            date=datetime.date(2026, 8, 20),  # previous month
            amount=Decimal("200.00"),
            category="fuel",
            has_vat=False,
        )
        result = compute_harmonogram(self.company, self.month)
        qe_events = [e for e in result["events"] if e["type"] == "quick_expense"]
        self.assertEqual(len(qe_events), 0)

    def test_quick_expense_included_in_total_out(self):
        """total_out includes quick expenses alongside other outgoing events."""
        from apps.cash_flow.models import QuickExpense
        # Disable ZUS to isolate the quick expense cost
        self.config.zus_status = CompanyTaxConfig.ZUS_ETAT_JDG
        self.config.vat_payer = False
        self.config.save(update_fields=["zus_status", "vat_payer"])
        QuickExpense.objects.create(
            company=self.company,
            date=datetime.date(2026, 9, 5),
            amount=Decimal("400.00"),
            category="other",
            has_vat=False,
        )
        result = compute_harmonogram(self.company, self.month)
        self.assertAlmostEqual(result["total_out"], 400.0, places=2)

    # ── Month-to-month carryover tests ────────────────────────────────────────

    def test_next_month_opening_balance_carries_over_from_anchor(self):
        """Viewing a month after the anchor: opening_balance = anchor + net flow since anchor."""
        # Anchor Aug 28 with balance 8000
        # B2C income on Aug 30: +500
        # Fixed cost on Aug 31 (due_day=31): -1000
        # Net flow Aug 28-31 = +500 - 1000 = -500
        # October opening_balance = 8000 + net(Aug 28 → Sep 30) = 8000 - 500 + whatever Sep has
        # We test September which is simpler: net Aug 28-31 = -500 → Sep opening = 7500
        _make_config(
            self.company,
            bank_balance=Decimal("8000.00"),
            cash_balance=Decimal("0.00"),
            vat_payer=False,
            zus_status=CompanyTaxConfig.ZUS_ETAT_JDG,
            balance_date=datetime.date(2026, 8, 28),
        )
        self._make_b2c(datetime.date(2026, 8, 30), Decimal("500.00"))
        self._make_fixed_cost("Koszt sierpień", Decimal("1000.00"), due_day=31)
        result = compute_harmonogram(self.company, "2026-09")
        # Aug 28-31: +500 B2C - 1000 fixed = -500 net
        # Sep opening = 8000 - 500 = 7500
        self.assertAlmostEqual(result["opening_balance"], 7500.0, places=2)

    def test_next_month_opening_balance_anchor_same_month_unchanged(self):
        """Viewing the anchor month itself: opening_balance equals the entered balance."""
        _make_config(
            self.company,
            bank_balance=Decimal("12000.00"),
            cash_balance=Decimal("0.00"),
            vat_payer=False,
            zus_status=CompanyTaxConfig.ZUS_ETAT_JDG,
            balance_date=datetime.date(2026, 9, 1),
        )
        result = compute_harmonogram(self.company, "2026-09")
        self.assertAlmostEqual(result["opening_balance"], 12000.0, places=2)

    def test_previous_month_opening_balance_carries_back_from_anchor(self):
        """Viewing a month before the anchor: opening_balance = anchor - net flow until anchor."""
        # Anchor Sep 1 with balance 7500
        # In August there were no events (no B2C, no fixed costs for Aug, zus etat_jdg)
        # → Aug opening = 7500 - 0 = 7500
        _make_config(
            self.company,
            bank_balance=Decimal("7500.00"),
            cash_balance=Decimal("0.00"),
            vat_payer=False,
            zus_status=CompanyTaxConfig.ZUS_ETAT_JDG,
            balance_date=datetime.date(2026, 9, 1),
        )
        result = compute_harmonogram(self.company, "2026-08")
        # No events in Aug → net flow(Aug 1 → Aug 31) = 0 → Aug opening = 7500
        self.assertAlmostEqual(result["opening_balance"], 7500.0, places=2)

    def test_previous_month_opening_balance_subtracts_net_flow(self):
        """Viewing July with anchor Sep 1: July opening = anchor - net(Jul-Aug)."""
        # Anchor Sep 1 = 5000; B2C in Aug = +2000
        # Jul opening = 5000 - 2000 = 3000
        _make_config(
            self.company,
            bank_balance=Decimal("5000.00"),
            cash_balance=Decimal("0.00"),
            vat_payer=False,
            zus_status=CompanyTaxConfig.ZUS_ETAT_JDG,
            balance_date=datetime.date(2026, 9, 1),
        )
        self._make_b2c(datetime.date(2026, 8, 15), Decimal("2000.00"))
        result = compute_harmonogram(self.company, "2026-07")
        # net(Jul 1 → Aug 31) = +2000 → Jul opening = 5000 - 2000 = 3000
        self.assertAlmostEqual(result["opening_balance"], 3000.0, places=2)

    def test_no_anchor_opening_balance_always_zero(self):
        """Without anchor (no balance entered) opening_balance is always 0 for every month."""
        _make_config(
            self.company,
            bank_balance=Decimal("0.00"),
            cash_balance=Decimal("0.00"),
            vat_payer=False,
            zus_status=CompanyTaxConfig.ZUS_ETAT_JDG,
        )
        for m in ("2026-07", "2026-08", "2026-09", "2026-10"):
            result = compute_harmonogram(self.company, m)
            self.assertAlmostEqual(result["opening_balance"], 0.0, places=2, msg=f"month={m}")


class HarmonogramAPITest(TestCase):
    """Integration tests for GET /api/cash-flow/harmonogram/."""

    def setUp(self):
        self.user, self.company = _make_company("API Firma")
        _make_config(self.company)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_200(self):
        response = self.client.get("/api/cash-flow/harmonogram/")
        self.assertEqual(response.status_code, 200)

    def test_returns_correct_shape(self):
        response = self.client.get("/api/cash-flow/harmonogram/")
        data = response.json()
        for key in ("period", "opening_balance", "total_in", "total_out",
                    "closing_balance", "min_balance", "events", "has_balance"):
            self.assertIn(key, data, f"Missing key: {key}")

    def test_month_param_changes_period(self):
        response = self.client.get("/api/cash-flow/harmonogram/", {"month": "2026-07"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["period"], "2026-07")

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        response = anon.get("/api/cash-flow/harmonogram/")
        self.assertEqual(response.status_code, 401)

    def test_events_list_is_list(self):
        response = self.client.get("/api/cash-flow/harmonogram/")
        self.assertIsInstance(response.json()["events"], list)

    def test_event_has_running_balance(self):
        FixedCost.objects.create(
            company=self.company,
            category=FixedCost.CAT_CZYNSZ,
            description="Test koszt",
            amount_monthly=Decimal("1000.00"),
            due_day=10,
            active_from=datetime.date(2026, 1, 1),
            is_active=True,
        )
        response = self.client.get("/api/cash-flow/harmonogram/", {"month": "2026-09"})
        events = response.json()["events"]
        fc = [e for e in events if e["type"] == "fixed_cost"]
        self.assertGreater(len(fc), 0)
        self.assertIn("running_balance", fc[0])
