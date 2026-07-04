"""Tests for JPK_EWP generator and export endpoint."""
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

from django.test import TestCase
from django.urls import reverse

from apps.invoices.models import Invoice
from apps.users.models import Company

from .jpk_ewp_generator import CATEGORY_XML_FIELD, generate_jpk_ewp


# ---------------------------------------------------------------------------
# Unit tests: XML generator
# ---------------------------------------------------------------------------

class JpkEwpGeneratorTests(TestCase):
    def _make_company(self, ryczalt_category="uslugi"):
        company = MagicMock(spec=Company)
        company.nip = "1234567890"
        company.name = "Firma Testowa sp.j."
        company.address = "ul. Testowa 1"
        company.city = "Warszawa"
        company.postal_code = "00-001"
        company.ryczalt_category = ryczalt_category
        return company

    def _make_invoice(self, number, issue_date, total_gross, customer_name="Klient A"):
        inv = MagicMock(spec=Invoice)
        inv.invoice_number = number
        inv.issue_date = issue_date
        inv.total_gross = Decimal(str(total_gross))
        customer = MagicMock()
        customer.name = customer_name
        customer.company_name = ""
        customer.street = "ul. Klienta 2"
        customer.postal_code = "01-001"
        customer.city = "Kraków"
        inv.customer = customer
        return inv

    def test_xml_has_correct_header(self):
        company = self._make_company()
        xml = generate_jpk_ewp(company, [], 2026, 6)
        self.assertIn("<?xml version", xml)
        self.assertIn("JPK_EWP", xml)
        self.assertIn("<DataOd>2026-06-01</DataOd>", xml)
        self.assertIn("<DataDo>2026-06-30</DataDo>", xml)

    def test_xml_includes_company_nip(self):
        company = self._make_company()
        xml = generate_jpk_ewp(company, [], 2026, 6)
        self.assertIn("<etd:NIP>1234567890</etd:NIP>", xml)

    def test_xml_escapes_special_chars(self):
        company = self._make_company()
        company.name = "Firma & Spółka <Test>"
        xml = generate_jpk_ewp(company, [], 2026, 6)
        self.assertIn("Firma &amp; Spółka &lt;Test&gt;", xml)

    def test_single_invoice_entry(self):
        company = self._make_company("uslugi")
        inv = self._make_invoice("FV/2026/0001", date(2026, 6, 15), "1000.00")
        xml = generate_jpk_ewp(company, [inv], 2026, 6)
        self.assertIn("<LpEP>1</LpEP>", xml)
        self.assertIn("<NrDokumentu>FV/2026/0001</NrDokumentu>", xml)
        self.assertIn("<DataPrzychodu>2026-06-15</DataPrzychodu>", xml)
        self.assertIn("<PrzychodyUslugi>1000.00</PrzychodyUslugi>", xml)
        self.assertIn("<PrzychodnyCalosc>1000.00</PrzychodnyCalosc>", xml)

    def test_revenue_field_mapped_by_category(self):
        for category, xml_field in CATEGORY_XML_FIELD.items():
            company = self._make_company(category)
            inv = self._make_invoice("FV/2026/0001", date(2026, 6, 1), "500.00")
            xml = generate_jpk_ewp(company, [inv], 2026, 6)
            self.assertIn(f"<{xml_field}>500.00</{xml_field}>", xml, f"Missing {xml_field} for {category}")

    def test_summary_totals(self):
        company = self._make_company("handel")
        invoices = [
            self._make_invoice("FV/2026/0001", date(2026, 6, 1), "200.00"),
            self._make_invoice("FV/2026/0002", date(2026, 6, 15), "300.00"),
        ]
        xml = generate_jpk_ewp(company, invoices, 2026, 6)
        self.assertIn("<LiczbaWierszy>2</LiczbaWierszy>", xml)
        self.assertIn("<SumaPrzychodnyCalosc>500.00</SumaPrzychodnyCalosc>", xml)
        self.assertIn("<SumaPrzychodyHandel>500.00</SumaPrzychodyHandel>", xml)

    def test_empty_invoice_list(self):
        company = self._make_company()
        xml = generate_jpk_ewp(company, [], 2026, 6)
        self.assertIn("<LiczbaWierszy>0</LiczbaWierszy>", xml)
        self.assertIn("<SumaPrzychodnyCalosc>0.00</SumaPrzychodnyCalosc>", xml)

    def test_december_period_to(self):
        company = self._make_company()
        xml = generate_jpk_ewp(company, [], 2026, 12)
        self.assertIn("<DataDo>2026-12-31</DataDo>", xml)

    def test_february_period_to_leap_year(self):
        company = self._make_company()
        xml = generate_jpk_ewp(company, [], 2024, 2)
        self.assertIn("<DataDo>2024-02-29</DataDo>", xml)


# ---------------------------------------------------------------------------
# Integration tests: export endpoint
# ---------------------------------------------------------------------------

class JpkEwpEndpointTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        self.company = Company.objects.create(
            name="Ryczałt Test",
            nip="9999999999",
            taxation_form=Company.TAXATION_RYCZALT,
            ryczalt_category=Company.RYCZALT_USLUGI,
        )
        self.user = User.objects.create_user(
            username="testuser_ewp",
            password="testpass123",
            current_company=self.company,
        )
        from apps.users.models import CompanyMembership
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
        )
        self.client.force_login(self.user)

    def test_returns_xml_for_ryczalt_company(self):
        url = reverse("report-jpk-ewp") + "?year=2026&month=6"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("application/xml", resp["Content-Type"])
        self.assertIn(b"JPK_EWP", resp.content)
        self.assertEqual(
            resp["Content-Disposition"],
            'attachment; filename="JPK_EWP_2026_06.xml"',
        )

    def test_rejects_non_ryczalt_company(self):
        self.company.taxation_form = Company.TAXATION_KPIR
        self.company.save()
        url = reverse("report-jpk-ewp") + "?year=2026&month=6"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 400)

    def test_rejects_missing_year(self):
        url = reverse("report-jpk-ewp") + "?month=6"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 400)

    def test_rejects_invalid_month(self):
        url = reverse("report-jpk-ewp") + "?year=2026&month=13"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 400)

    def test_requires_authentication(self):
        from django.test import Client
        anon = Client()
        url = reverse("report-jpk-ewp") + "?year=2026&month=6"
        resp = anon.get(url)
        self.assertIn(resp.status_code, [401, 403])
