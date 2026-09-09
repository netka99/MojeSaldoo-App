"""
Tests for 3-way matching (InvoiceItemPzLink):
- _fuzzy_score / _normalize_name helpers
- GET match-proposals endpoint
- POST confirm-line-matches endpoint
- InvoiceItemPzLink model constraints
"""
import uuid
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.products.models import Product, Warehouse
from apps.purchase_documents.models import (
    InvoiceItemPzLink,
    PurchaseDocument,
    PurchaseDocumentItem,
    PurchaseDocumentPzLink,
)
from apps.purchase_documents.views import _build_proposals, _fuzzy_score, _normalize_name
from apps.users.models import Company, CompanyMembership, CompanyModule

User = get_user_model()


# ─── Shared helpers ────────────────────────────────────────────────────────────

def _make_company(name="TestCo3W") -> Company:
    nip = f"{abs(hash(name)) % 10_000_000_000:010d}"
    return Company.objects.create(name=name, nip=nip)


def _make_user(company: Company) -> User:
    uid = uuid.uuid4().hex[:8]
    u = User.objects.create_user(
        username=f"u3w_{uid}",
        email=f"u3w_{uid}@test.invalid",
        password="pass",
        current_company=company,
    )
    CompanyMembership.objects.create(user=u, company=company, role="admin")
    CompanyModule.objects.get_or_create(company=company, module="warehouses")
    CompanyModule.objects.get_or_create(company=company, module="purchase_documents")
    return u


def _make_warehouse(company, user, code="MAG3W") -> Warehouse:
    return Warehouse.objects.create(company=company, user=user, name=code, code=code)


def _make_product(company, name, unit="szt") -> Product:
    return Product.objects.create(company=company, name=name, unit=unit)


def _make_fz(company, number="FV/3W/001") -> PurchaseDocument:
    return PurchaseDocument.objects.create(
        company=company,
        doc_type="FZ",
        status="registered",
        document_number=number,
        issue_date=date(2026, 1, 1),
    )


def _make_fz_with_items(company, items_data, number="FV/3W/001") -> PurchaseDocument:
    """items_data: list of (product_or_None, product_name, quantity)"""
    fz = _make_fz(company, number)
    for product, product_name, qty in items_data:
        PurchaseDocumentItem.objects.create(
            document=fz,
            product=product,
            product_name=product_name,
            quantity=qty,
            unit="szt",
            unit_price_gross="10.00",
            vat_rate="23.00",
            line_gross="10.00",
        )
    return fz


def _make_pz(company, warehouse, number="PZ/3W/0001") -> DeliveryDocument:
    return DeliveryDocument.objects.create(
        company=company,
        document_type="PZ",
        status="draft",
        issue_date=date(2026, 1, 1),
        to_warehouse=warehouse,
        document_number=number,
    )


def _make_pz_with_items(company, warehouse, items_data, number="PZ/3W/0001") -> DeliveryDocument:
    """items_data: list of (product, quantity)"""
    pz = _make_pz(company, warehouse, number)
    for product, qty in items_data:
        DeliveryItem.objects.create(
            delivery_document=pz,
            product=product,
            quantity_planned=qty,
            unit_cost="8.00",
        )
    return pz


# ─── Fuzzy matching helpers ────────────────────────────────────────────────────

class FuzzyMatchingHelperTests(TestCase):

    def test_normalize_strips_weight_unit(self):
        self.assertEqual(_normalize_name("Chleb pszenny 500g"), "chleb pszenny")

    def test_normalize_strips_volume_unit(self):
        self.assertEqual(_normalize_name("Mleko 1L"), "mleko")

    def test_normalize_lowercases(self):
        self.assertEqual(_normalize_name("Maslo EKSTRA"), "maslo ekstra")

    def test_fuzzy_score_identical(self):
        self.assertEqual(_fuzzy_score("Chleb pszenny", "Chleb pszenny"), 1.0)

    def test_fuzzy_score_with_unit_suffix(self):
        score = _fuzzy_score("Chleb pszenny 500g", "Chleb pszenny")
        self.assertGreater(score, 0.7)

    def test_fuzzy_score_completely_different(self):
        score = _fuzzy_score("Maslo ekstra", "Chleb zytni")
        self.assertLess(score, 0.3)

    def test_fuzzy_score_partial_overlap(self):
        score = _fuzzy_score("Olej slonecznikowy wyborny", "Olej Wyborny")
        self.assertGreater(score, 0.4)


# ─── match-proposals ──────────────────────────────────────────────────────────

class MatchProposalsAPITests(TestCase):

    def setUp(self):
        self.company = _make_company("MatchProposalsCo")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _url(self, fz):
        return reverse("purchase-documents-match-proposals", kwargs={"uuid": str(fz.uuid)})

    def test_exact_match_by_product_fk(self):
        p = _make_product(self.company, "Mleko 1L")
        fz = _make_fz_with_items(self.company, [(p, "Mleko 1L", 10)], "FV/MP/001")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 10)], "PZ/MP/0001")

        resp = self.client.get(self._url(fz), {"pz_id": str(pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["proposals"]), 1)
        self.assertEqual(resp.data["proposals"][0]["match_type"], "exact")
        self.assertEqual(resp.data["proposals"][0]["quantity_matched"], "10.0000")
        self.assertEqual(resp.data["unmatched_invoice_items"], [])
        self.assertEqual(resp.data["unmatched_delivery_items"], [])

    def test_partial_quantity_capped_at_pz_qty(self):
        p = _make_product(self.company, "Maslo 200g")
        fz = _make_fz_with_items(self.company, [(p, "Maslo 200g", 20)], "FV/MP/002")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 12)], "PZ/MP/0002")

        resp = self.client.get(self._url(fz), {"pz_id": str(pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["proposals"][0]["quantity_matched"], "12.00")

    def test_fuzzy_match_for_item_without_product_fk(self):
        p = _make_product(self.company, "Chleb pszenny 500g")
        fz = _make_fz_with_items(self.company, [(None, "Chleb pszenny", 5)], "FV/MP/003")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/MP/0003")

        resp = self.client.get(self._url(fz), {"pz_id": str(pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["proposals"]), 1)
        self.assertEqual(resp.data["proposals"][0]["match_type"], "fuzzy")

    def test_no_match_goes_to_unmatched(self):
        p1 = _make_product(self.company, "Ser Gouda")
        fz = _make_fz_with_items(self.company, [(None, "Olej slonecznikowy", 4)], "FV/MP/004")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p1, 10)], "PZ/MP/0004")

        resp = self.client.get(self._url(fz), {"pz_id": str(pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["proposals"]), 0)
        self.assertEqual(len(resp.data["unmatched_invoice_items"]), 1)
        self.assertEqual(len(resp.data["unmatched_delivery_items"]), 1)

    def test_missing_pz_id_returns_400(self):
        fz = _make_fz(self.company, "FV/MP/005")
        resp = self.client.get(self._url(fz))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_wrong_company_pz_returns_404(self):
        other = _make_company("OtherMP")
        other_user = _make_user(other)
        other_wh = _make_warehouse(other, other_user, "MAGOTH")
        other_pz = _make_pz(other, other_wh, "PZ/OTH/0001")
        fz = _make_fz(self.company, "FV/MP/006")
        resp = self.client.get(self._url(fz), {"pz_id": str(other_pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_already_matched_qty_reflected_in_qty_already_matched(self):
        p = _make_product(self.company, "Jajka L")
        fz = _make_fz_with_items(self.company, [(p, "Jajka L", 30)], "FV/MP/007")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 30)], "PZ/MP/0007")
        inv_item = fz.items.first()
        del_item = pz.items.first()
        InvoiceItemPzLink.objects.create(
            invoice_item=inv_item, delivery_item=del_item, quantity_matched=10
        )

        resp = self.client.get(self._url(fz), {"pz_id": str(pz.uuid)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # del_item has 30 planned, 10 already used -> 20 available
        del_data = resp.data["proposals"][0]["delivery_item"] if resp.data["proposals"] else None
        if del_data:
            self.assertEqual(del_data["quantity_already_matched"], "10.0000")


# ─── confirm-line-matches ─────────────────────────────────────────────────────

class ConfirmLineMatchesAPITests(TestCase):

    def setUp(self):
        self.company = _make_company("ConfirmCo3W")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _url(self, fz):
        return reverse("purchase-documents-confirm-line-matches", kwargs={"uuid": str(fz.uuid)})

    def _post(self, fz, pz, inv_item, del_item, qty):
        return self.client.post(self._url(fz), {
            "pz_id": str(pz.uuid),
            "matches": [{
                "invoice_item_id": str(inv_item.uuid),
                "delivery_item_id": str(del_item.uuid),
                "quantity_matched": str(qty),
            }],
        }, format="json")

    def test_creates_line_link_and_parent_pz_link(self):
        p = _make_product(self.company, "Maka 1kg")
        fz = _make_fz_with_items(self.company, [(p, "Maka 1kg", 10)], "FV/CL/001")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 10)], "PZ/CL/0001")

        resp = self._post(fz, pz, fz.items.first(), pz.items.first(), "10.0000")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(InvoiceItemPzLink.objects.filter(
            invoice_item=fz.items.first(), delivery_item=pz.items.first()
        ).exists())
        self.assertTrue(PurchaseDocumentPzLink.objects.filter(
            purchase_document=fz, delivery_document=pz
        ).exists())

    def test_idempotent_updates_quantity(self):
        p = _make_product(self.company, "Ser Edam")
        fz = _make_fz_with_items(self.company, [(p, "Ser Edam", 20)], "FV/CL/002")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 20)], "PZ/CL/0002")

        self._post(fz, pz, fz.items.first(), pz.items.first(), "10.0000")
        self._post(fz, pz, fz.items.first(), pz.items.first(), "20.0000")

        link = InvoiceItemPzLink.objects.get(
            invoice_item=fz.items.first(), delivery_item=pz.items.first()
        )
        self.assertEqual(link.quantity_matched, 20)
        self.assertEqual(InvoiceItemPzLink.objects.count(), 1)

    def test_sets_status_matched(self):
        p = _make_product(self.company, "Twarog")
        fz = _make_fz_with_items(self.company, [(p, "Twarog", 4)], "FV/CL/003")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 4)], "PZ/CL/0003")

        self._post(fz, pz, fz.items.first(), pz.items.first(), "4")
        fz.refresh_from_db()
        self.assertEqual(fz.status, PurchaseDocument.STATUS_MATCHED)

    def test_coverage_field_in_response_items(self):
        p = _make_product(self.company, "Jogurt")
        fz = _make_fz_with_items(self.company, [(p, "Jogurt", 5)], "FV/CL/004")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/CL/0004")

        self._post(fz, pz, fz.items.first(), pz.items.first(), "5")

        resp = self.client.get(
            reverse("purchase-documents-detail", kwargs={"uuid": str(fz.uuid)})
        )
        item_data = resp.data["items"][0]
        self.assertEqual(item_data["coverage"]["quantity_matched_total"], "5.0000")
        self.assertIn(pz.document_number, item_data["coverage"]["pz_numbers"])

    def test_missing_pz_id_returns_400(self):
        fz = _make_fz(self.company, "FV/CL/005")
        resp = self.client.post(self._url(fz), {"matches": []}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_empty_matches_returns_400(self):
        p = _make_product(self.company, "Kefir")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/CL/0006")
        fz = _make_fz(self.company, "FV/CL/006")
        resp = self.client.post(self._url(fz), {"pz_id": str(pz.uuid), "matches": []}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_invoice_item_uuid_returns_400(self):
        p = _make_product(self.company, "Smietana")
        fz = _make_fz_with_items(self.company, [(p, "Smietana", 3)], "FV/CL/007")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 3)], "PZ/CL/0007")
        resp = self.client.post(self._url(fz), {
            "pz_id": str(pz.uuid),
            "matches": [{"invoice_item_id": str(uuid.uuid4()),
                         "delivery_item_id": str(pz.items.first().uuid),
                         "quantity_matched": "3"}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_negative_quantity_returns_400(self):
        p = _make_product(self.company, "Olej")
        fz = _make_fz_with_items(self.company, [(p, "Olej", 5)], "FV/CL/008")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/CL/0008")
        resp = self.client.post(self._url(fz), {
            "pz_id": str(pz.uuid),
            "matches": [{"invoice_item_id": str(fz.items.first().uuid),
                         "delivery_item_id": str(pz.items.first().uuid),
                         "quantity_matched": "-5"}],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ─── InvoiceItemPzLink model constraints ─────────────────────────────────────

class InvoiceItemPzLinkModelTests(TestCase):

    def setUp(self):
        self.company = _make_company("LinkModelCo3W")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)

    def test_duplicate_raises_integrity_error(self):
        p = _make_product(self.company, "Produkt X")
        fz = _make_fz_with_items(self.company, [(p, "Produkt X", 5)], "FV/LM/001")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/LM/0001")
        inv_item = fz.items.first()
        del_item = pz.items.first()
        InvoiceItemPzLink.objects.create(invoice_item=inv_item, delivery_item=del_item, quantity_matched=5)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                InvoiceItemPzLink.objects.create(invoice_item=inv_item, delivery_item=del_item, quantity_matched=3)

    def test_cascade_on_invoice_item_delete(self):
        p = _make_product(self.company, "Produkt Y")
        fz = _make_fz_with_items(self.company, [(p, "Produkt Y", 5)], "FV/LM/002")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/LM/0002")
        InvoiceItemPzLink.objects.create(
            invoice_item=fz.items.first(), delivery_item=pz.items.first(), quantity_matched=5
        )
        fz.delete()
        self.assertEqual(InvoiceItemPzLink.objects.count(), 0)

    def test_cascade_on_delivery_item_delete(self):
        p = _make_product(self.company, "Produkt Z")
        fz = _make_fz_with_items(self.company, [(p, "Produkt Z", 5)], "FV/LM/003")
        pz = _make_pz_with_items(self.company, self.warehouse, [(p, 5)], "PZ/LM/0003")
        InvoiceItemPzLink.objects.create(
            invoice_item=fz.items.first(), delivery_item=pz.items.first(), quantity_matched=5
        )
        pz.delete()
        self.assertEqual(InvoiceItemPzLink.objects.count(), 0)
