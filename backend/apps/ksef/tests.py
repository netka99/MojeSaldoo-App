import io
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import Company, CompanyMembership, CompanyModule

from .models import ReceivedKSeFInvoice

User = get_user_model()

KSEF_REF = "PL2025-TEST-0001"


def _make_invoice(company, ksef_number=KSEF_REF):
    return ReceivedKSeFInvoice.objects.create(
        company=company,
        ksef_number=ksef_number,
        invoice_number="FV/2025/001",
        issue_date=date(2025, 1, 15),
        seller_nip="1234567890",
        seller_name="Test Supplier Sp. z o.o.",
        gross_amount=Decimal("1230.00"),
        net_amount=Decimal("1000.00"),
        vat_amount=Decimal("230.00"),
    )


class InvoiceOpexTagViewTests(TestCase):
    """Tests for PATCH /api/ksef/inbox/<ksef_reference_number>/opex/"""

    def setUp(self):
        self.client = APIClient()

        self.user = User.objects.create_user(
            username="opex-test-user",
            email="opex@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Opex Test Company")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.create(company=self.company, module="ksef", is_enabled=True)

        self.invoice = _make_invoice(self.company)
        self.url = reverse("ksef-inbox-opex", kwargs={"ksef_reference_number": KSEF_REF})

    # ------------------------------------------------------------------
    # 1. Unauthenticated request
    # ------------------------------------------------------------------

    def test_unauthenticated_returns_401(self):
        r = self.client.patch(self.url, {"opex_category": "utilities"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)

    # ------------------------------------------------------------------
    # 2. Tag with a valid category
    # ------------------------------------------------------------------

    def test_tag_valid_category(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.patch(self.url, {"opex_category": "utilities"}, format="json")

        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.opex_category, "utilities")
        self.assertIsNotNone(self.invoice.opex_tagged_at)

    # ------------------------------------------------------------------
    # 3. Clear the tag by sending null
    # ------------------------------------------------------------------

    def test_tag_clears_with_null(self):
        # First set a category
        self.invoice.opex_category = "rent"
        from django.utils import timezone
        self.invoice.opex_tagged_at = timezone.now()
        self.invoice.save(update_fields=["opex_category", "opex_tagged_at"])

        self.client.force_authenticate(user=self.user)
        r = self.client.patch(self.url, {"opex_category": None}, format="json")

        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)

        self.invoice.refresh_from_db()
        self.assertIsNone(self.invoice.opex_category)
        self.assertIsNone(self.invoice.opex_tagged_at)

    # ------------------------------------------------------------------
    # 4. Invalid category value
    # ------------------------------------------------------------------

    def test_invalid_category_returns_400(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.patch(self.url, {"opex_category": "invalid"}, format="json")

        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("opex_category", r.data)

    # ------------------------------------------------------------------
    # 5. Invoice belonging to another company returns 404
    # ------------------------------------------------------------------

    def test_wrong_company_returns_404(self):
        # Create a second company with its own invoice
        company_b = Company.objects.create(name="Other Company B")
        invoice_b = _make_invoice(company_b, ksef_number="PL2025-OTHER-0002")

        # Create a user belonging to company B
        user_b = User.objects.create_user(
            username="opex-user-b",
            email="opex-b@test.com",
            password="test12345",
        )
        CompanyMembership.objects.create(
            user=user_b,
            company=company_b,
            role="admin",
            is_active=True,
        )
        user_b.current_company = company_b
        user_b.save(update_fields=["current_company"])
        CompanyModule.objects.create(company=company_b, module="ksef", is_enabled=True)

        # user_b tries to tag self.invoice which belongs to self.company (not company_b)
        self.client.force_authenticate(user=user_b)
        r = self.client.patch(self.url, {"opex_category": "services"}, format="json")

        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

        # The original invoice must remain unchanged
        self.invoice.refresh_from_db()
        self.assertIsNone(self.invoice.opex_category)

    # ------------------------------------------------------------------
    # 6. All six valid categories succeed
    # ------------------------------------------------------------------

    def test_tag_all_valid_categories(self):
        from apps.cash_flow.models import OPEX_CATEGORY_CHOICES
        valid_categories = [choice[0] for choice in OPEX_CATEGORY_CHOICES]
        self.assertEqual(len(valid_categories), 11)

        self.client.force_authenticate(user=self.user)
        for category in valid_categories:
            with self.subTest(category=category):
                r = self.client.patch(
                    self.url, {"opex_category": category}, format="json"
                )
                self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
                self.assertEqual(r.data["opex_category"], category)

                self.invoice.refresh_from_db()
                self.assertEqual(self.invoice.opex_category, category)
                self.assertIsNotNone(self.invoice.opex_tagged_at)

    def test_patch_vat_deduction_without_opex(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.patch(self.url, {"vat_deduction": "half"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.vat_deduction, "half")
        self.assertIsNone(self.invoice.opex_category)

    def test_patch_is_private(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.patch(
            self.url, {"is_private": True, "vat_deduction": "none"}, format="json"
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.invoice.refresh_from_db()
        self.assertTrue(self.invoice.is_private)
        self.assertEqual(self.invoice.vat_deduction, "none")


class PaperScanViewTests(TestCase):
    """Tests for POST /api/ksef/scan-paper/"""

    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="scan-test-user",
            email="scan@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Scan Test Company")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.create(company=self.company, module="ksef", is_enabled=True)
        self.url = reverse("ksef-scan-paper")
        self.analyze_patcher = patch("apps.ksef.views._analyze_invoice", return_value=None)
        self.analyze_patcher.start()
        self.addCleanup(self.analyze_patcher.stop)

    def _minimal_png(self):
        """Return a minimal 1x1 white PNG as an in-memory file."""
        import struct, zlib
        def u32(n):
            return struct.pack(">I", n)
        png_sig = b"\x89PNG\r\n\x1a\n"
        ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
        ihdr_crc = zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF
        ihdr_chunk = u32(13) + b"IHDR" + ihdr_data + u32(ihdr_crc)
        raw_row = b"\x00\xff\xff\xff"
        compressed = zlib.compress(raw_row)
        idat_crc = zlib.crc32(b"IDAT" + compressed) & 0xFFFFFFFF
        idat_chunk = u32(len(compressed)) + b"IDAT" + compressed + u32(idat_crc)
        iend_crc = zlib.crc32(b"IEND") & 0xFFFFFFFF
        iend_chunk = u32(0) + b"IEND" + u32(iend_crc)
        data = png_sig + ihdr_chunk + idat_chunk + iend_chunk
        f = io.BytesIO(data)
        f.name = "invoice.png"
        return f

    # ------------------------------------------------------------------
    # 1. Unauthenticated request returns 401
    # ------------------------------------------------------------------

    def test_unauthenticated_returns_401(self):
        f = self._minimal_png()
        r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)

    # ------------------------------------------------------------------
    # 2. Missing image field returns 400
    # ------------------------------------------------------------------

    def test_missing_image_returns_400(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.post(self.url, {}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    # ------------------------------------------------------------------
    # 3. Valid image returns 200 with expected keys (OCR mocked)
    # ------------------------------------------------------------------

    def test_valid_image_returns_structured_response(self):
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        # Mock _ocr_image so we don't need Tesseract installed in CI
        with patch("apps.ksef.views._ocr_image", return_value=""):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        for key in ("seller_name", "seller_nip", "invoice_number", "issue_date", "total_gross", "raw_text"):
            self.assertIn(key, r.data, f"Missing key: {key}")

    # ------------------------------------------------------------------
    # 4. OCR text produces correctly extracted fields
    # ------------------------------------------------------------------

    def test_ocr_text_extraction(self):
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        sample_text = (
            "Faktura VAT FV/2026/042\n"
            "Data wystawienia: 15.04.2026\n"
            "NIP: 1234567890\n"
            "Do zapłaty: 1 230,00 PLN\n"
        )
        with patch("apps.ksef.views._ocr_image", return_value=sample_text):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["seller_nip"], "1234567890")
        self.assertEqual(r.data["issue_date"], "2026-04-15")
        self.assertEqual(r.data["total_gross"], "1230.00")

    # ------------------------------------------------------------------
    # 5. Paragon (fiscal receipt) format is parsed correctly
    # ------------------------------------------------------------------

    def test_paragon_text_extraction(self):
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        sample_text = (
            "As Bylak i Wspólnicy S-ka jawna\n"
            "16-400 Suwałki, ul. Leśna 68\n"
            "NIP 8441866342          nr:480130\n"
            "PARAGON FISKALNY\n"
            "SUMA PLN                    82,53\n"
            "NIP NABYWCY:\n"
            "8442120248\n"
            "2026-06-10 18:47\n"
        )
        with patch("apps.ksef.views._ocr_image", return_value=sample_text):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["seller_nip"], "8441866342")
        self.assertEqual(r.data["invoice_number"], "480130")
        self.assertEqual(r.data["issue_date"], "2026-06-10")
        self.assertEqual(r.data["total_gross"], "82.53")
        self.assertIn("S-ka jawna", r.data["seller_name"])
        self.assertEqual(r.data["buyer_nip"], "8442120248")
        self.assertFalse(r.data["buyer_nip_matches_company"])

    def test_paragon_buyer_nip_matches_company(self):
        self.company.nip = "8442120248"
        self.company.save(update_fields=["nip"])
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        sample_text = (
            "As Bylak i Wspólnicy S-ka jawna\n"
            "NIP 8441866342          nr:480130\n"
            "PARAGON FISKALNY\n"
            "SUMA PLN                    82,53\n"
            "NIP NABYWCY:\n"
            "8442120248\n"
            "2026-06-10 18:47\n"
        )
        with patch("apps.ksef.views._ocr_image", return_value=sample_text):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["buyer_nip"], "8442120248")
        self.assertTrue(r.data["buyer_nip_matches_company"])
        self.assertEqual(r.data["doc_type"], "paragon")

    def test_valid_image_includes_vat_keys(self):
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        with patch("apps.ksef.views._ocr_image", return_value=""):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        for key in ("buyer_nip", "buyer_nip_matches_company", "total_net", "total_vat"):
            self.assertIn(key, r.data, f"Missing key: {key}")

    # ------------------------------------------------------------------
    # 6. Empty OCR text returns empty fields (graceful degradation)
    # ------------------------------------------------------------------

    def test_empty_ocr_returns_empty_fields(self):
        self.client.force_authenticate(user=self.user)
        f = self._minimal_png()
        with patch("apps.ksef.views._ocr_image", return_value=""):
            r = self.client.post(self.url, {"image": f}, format="multipart")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["seller_nip"], "")
        self.assertEqual(r.data["invoice_number"], "")
        self.assertEqual(r.data["issue_date"], "")
        self.assertEqual(r.data["total_gross"], "")


class ParseInvoiceFieldsTests(TestCase):
    """Regex OCR helpers — net/VAT and buyer NIP without inventing 23%."""

    def test_ptu_summary_gives_net_and_vat(self):
        from apps.ksef.views import _parse_invoice_fields

        text = (
            "PARAGON FISKALNY\n"
            "PTU C 8,00%                 76,42    6,11    82,53\n"
            "SUMA PLN                    82,53\n"
            "SUMA PTU                     6,11\n"
            "NIP NABYWCY:\n"
            "8442120248\n"
        )
        parsed = _parse_invoice_fields(text)
        self.assertEqual(parsed["buyer_nip"], "8442120248")
        self.assertEqual(parsed["total_gross"], "82.53")
        self.assertEqual(parsed["total_vat"], "6.11")
        self.assertEqual(parsed["total_net"], "76.42")

    def test_missing_vat_is_empty_not_23(self):
        from apps.ksef.views import _parse_invoice_fields

        text = "Faktura VAT FV/1\nNIP: 1234567890\nDo zapłaty: 100,00\n"
        parsed = _parse_invoice_fields(text)
        self.assertEqual(parsed["total_gross"], "100.00")
        self.assertEqual(parsed["total_vat"], "")
        self.assertEqual(parsed["total_net"], "")


class AnonymizeForLlmTests(TestCase):
    """GDPR anonymization — nothing personal reaches the external LLM."""

    def _anon(self, text):
        from apps.ksef.views import _anonymize_for_llm
        return _anonymize_for_llm(text)

    # ── NIPs ──────────────────────────────────────────────────────────────────

    def test_nip_replaced(self):
        # NIPs outside labeled sections (e.g. in footer or header lines)
        text = "NIP sprzedawcy: 7791011327\nNIP nabywcy: 8442120248\n"
        result, token_map = self._anon(text)
        self.assertNotIn("7791011327", result)
        self.assertNotIn("8442120248", result)
        # Both NIPs must be tokenized
        nip_tokens = [v for v in token_map if v.startswith("[NIP_")]
        self.assertEqual(len(nip_tokens), 2)
        self.assertIn("7791011327", token_map.values())
        self.assertIn("8442120248", token_map.values())

    def test_same_nip_deduplicated(self):
        """Same NIP appearing twice gets same token, not two different tokens."""
        text = "NIP: 7791011327\nNIP: 7791011327\n"
        result, token_map = self._anon(text)
        self.assertEqual(result.count("[NIP_0]"), 2)
        self.assertNotIn("[NIP_1]", result)

    def test_nip_with_dashes_replaced(self):
        text = "NIP: 779-101-13-27\n"
        result, token_map = self._anon(text)
        self.assertNotIn("779-101-13-27", result)
        self.assertIn("[NIP_0]", result)

    # ── Dates ─────────────────────────────────────────────────────────────────

    def test_date_iso_replaced(self):
        text = "Data wystawienia: 2026-07-08\n"
        result, token_map = self._anon(text)
        self.assertNotIn("2026-07-08", result)
        self.assertIn("[DATA_0]", result)
        self.assertEqual(token_map["[DATA_0]"], "2026-07-08")

    def test_date_polish_format_replaced(self):
        text = "Data: 08.07.2026\n"
        result, token_map = self._anon(text)
        self.assertNotIn("08.07.2026", result)
        self.assertIn("[DATA_0]", result)

    def test_same_date_deduplicated(self):
        text = "Data sprzedaży 2026-07-08 Data wystawienia: 2026-07-08\n"
        result, _ = self._anon(text)
        self.assertEqual(result.count("[DATA_0]"), 2)
        self.assertNotIn("[DATA_1]", result)

    # ── Buyer block ───────────────────────────────────────────────────────────

    def test_nabywca_block_replaced(self):
        """Full buyer name + address replaced with [NABYWCA] token."""
        text = (
            "Sprzedawca: BIEDRONKA Sp. z o.o.\n"
            "Nabywca SMACZNY KĄSEK- catering- Ewelina Radon ul. Senieńska 21/1 16-400 Suwałki NIP: 8442120248\n"
            "Gotówka\n"
        )
        result, token_map = self._anon(text)
        self.assertNotIn("Ewelina Radon", result)
        self.assertNotIn("Senieńska", result)
        self.assertNotIn("Suwałki", result)
        self.assertIn("[NABYWCA]", result)
        self.assertIn("SMACZNY KĄSEK", token_map["[NABYWCA]"])

    def test_odbiorca_label_also_replaced(self):
        text = "Odbiorca: Jan Nowak, ul. Lipowa 3, 00-001 Warszawa\nVAT%\n"
        result, token_map = self._anon(text)
        self.assertNotIn("Jan Nowak", result)
        self.assertIn("[NABYWCA]", result)

    def test_kupujacy_label_also_replaced(self):
        text = "Kupujący: Anna Wiśniewska, ul. Kwiatowa 1\nNazwa towaru\n"
        result, token_map = self._anon(text)
        self.assertNotIn("Anna Wiśniewska", result)
        self.assertIn("[NABYWCA]", result)

    # ── Seller block ──────────────────────────────────────────────────────────

    def test_sprzedawca_label_replaced(self):
        """Explicit seller label → replaced with [SPRZEDAWCA] token."""
        text = (
            "Sprzedawca: Piotr Kowalski, ul. Domowa 5, 15-001 Białystok NIP: 5423112233\n"
            "Nabywca [NABYWCA]\n"
        )
        result, token_map = self._anon(text)
        self.assertNotIn("Piotr Kowalski", result)
        self.assertNotIn("Białystok", result)
        self.assertIn("[SPRZEDAWCA]", result)

    def test_wystawca_label_replaced(self):
        text = "Wystawca: Maria Zielińska, ul. Leśna 10\nNabywca [NABYWCA]\n"
        result, _ = self._anon(text)
        self.assertNotIn("Maria Zielińska", result)
        self.assertIn("[SPRZEDAWCA]", result)

    # ── JDG seller without explicit label ─────────────────────────────────────

    def test_jdg_person_name_near_address_replaced(self):
        """JDG name 'Jan Kowalski' next to street address → replaced with [OSOBA_0]."""
        text = "Jan Kowalski ul. Różana 7, 30-001 Kraków NIP: 6781234567\n"
        result, token_map = self._anon(text)
        self.assertNotIn("Jan Kowalski", result)
        self.assertIn("[OSOBA_0]", result)
        self.assertEqual(token_map["[OSOBA_0]"], "Jan Kowalski")

    def test_jdg_person_name_near_nip_replaced(self):
        text = "Anna Nowak NIP 9871234567\n"
        result, token_map = self._anon(text)
        self.assertNotIn("Anna Nowak", result)
        self.assertIn("[OSOBA_0]", result)

    def test_product_name_not_replaced(self):
        """Product names like 'Bocz Kości' should NOT be treated as person names."""
        text = (
            "Bocz Bez Kości kg  0,686 KG  16,99  6,52  5  6,85\n"
            "Szynka Wieprzowa  1,000 KG  12,99  9,99  5  10,49\n"
        )
        result, token_map = self._anon(text)
        # No [OSOBA_*] tokens should appear — product names lack ul./NIP next to them
        self.assertNotIn("[OSOBA_0]", result)
        self.assertIn("Bocz Bez Kości", result)

    def test_sp_zoo_name_not_replaced(self):
        """Large company name (ALL CAPS or Sp. z o.o.) should not be treated as JDG."""
        text = "JERONIMO MARTINS POLSKA S.A. ul. Żniwna 5 NIP: 7791011327\n"
        result, _ = self._anon(text)
        # JERONIMO etc are all caps — the regex requires Title-case, so no [OSOBA_*]
        self.assertNotIn("[OSOBA_0]", result)

    # ── Product names survive ──────────────────────────────────────────────────

    def test_product_names_survive_anonymization(self):
        """Anonymization must not touch product names in the line items section."""
        text = (
            "Nabywca [NABYWCA]\n"
            "Gotówka\n"
            "Nazwa towaru i stawka\n"
            "Bocz Bez Kości kg  C  0,686  KG  16,99  6,52  5  6,85\n"
            "SzynkaWpVAC b k kg  C  1,279  KG  14,99  8,51  5  8,94\n"
            "VAT% Wartość netto\n"
        )
        result, _ = self._anon(text)
        self.assertIn("Bocz Bez Kości kg", result)
        self.assertIn("SzynkaWpVAC b k kg", result)

    # ── Nothing leaks ─────────────────────────────────────────────────────────

    def test_biedronka_invoice_full_anonymization(self):
        """Simulate the full Biedronka thermal invoice — all PII must be gone."""
        text = (
            "FAKTURA ORYGINAŁ\n"
            "nr: 2868F00778/0726 Data sprzedaży 2026-07-08\n"
            "BIEDRONKA 2868 SUWAŁKI NIP: 7791011327\n"
            "Nabywca SMACZNY KĄSEK- catering- Ewelina Radon ul. Senieńska 21/1 16-400 Suwałki NIP: 8442120248\n"
            "Gotówka\n"
            "Bocz Bez Kości kg  C  0,686  KG  16,99  6,52  5  6,85\n"
            "SzynkaWpVAC b k kg  C  1,279  KG  14,99  8,51  5  8,94\n"
            "VAT% 5  154,36  7,72  162,08\n"
        )
        result, token_map = self._anon(text)

        # All NIPs gone
        self.assertNotIn("7791011327", result)
        self.assertNotIn("8442120248", result)
        # Date gone
        self.assertNotIn("2026-07-08", result)
        # Buyer PII gone
        self.assertNotIn("Ewelina Radon", result)
        self.assertNotIn("Senieńska", result)
        # Products intact
        self.assertIn("Bocz Bez Kości kg", result)
        self.assertIn("SzynkaWpVAC b k kg", result)
        # Tokens present
        self.assertIn("[NIP_0]", result)
        self.assertIn("[DATA_0]", result)
        self.assertIn("[NABYWCA]", result)

