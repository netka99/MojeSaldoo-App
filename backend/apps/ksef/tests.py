import io
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import Company, CompanyMembership

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
        valid_categories = [
            choice[0] for choice in ReceivedKSeFInvoice.OPEX_CATEGORY_CHOICES
        ]
        self.assertEqual(len(valid_categories), 6)

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
        self.url = reverse("ksef-scan-paper")

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
