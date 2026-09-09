"""
Tests for the DeliveryDocument ↔ KSeF invoice M:M relationship.

Covers:
- DeliveryDocumentKSeFLink model — uniqueness, cascade deletes, M:M cardinality
- KsefUnlinkedFilter — ?ksef_unlinked=true/false, .distinct() on multi-link PZ
- DeliveryDocumentSerializer — ksef_invoice_refs[] and backward-compat ksef_invoice_ref
- create_pz_kor() service — copies all M:M ksef_links to the PZ-KOR document
"""
import uuid
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.delivery.models import DeliveryDocument, DeliveryDocumentKSeFLink, DeliveryItem
from apps.delivery.services import create_pz_kor
from apps.ksef.models import ReceivedKSeFInvoice
from apps.products.models import Product, Warehouse
from apps.suppliers.models import Supplier
from apps.users.models import Company, CompanyMembership, CompanyModule

User = get_user_model()


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _make_company(name="TestCo") -> Company:
    return Company.objects.create(name=name)


def _make_user(company: Company, username_suffix="") -> User:
    uid = uuid.uuid4().hex[:8] + username_suffix
    u = User.objects.create_user(
        username=f"ksef_m2m_{uid}",
        email=f"ksef_m2m_{uid}@test.invalid",
        password="pass",
    )
    # Must be saved separately — create_user kwargs don't include custom fields
    u.current_company = company
    u.save(update_fields=["current_company"])
    CompanyMembership.objects.create(user=u, company=company, role="admin", is_active=True)
    CompanyModule.objects.get_or_create(company=company, module="delivery", defaults={"is_enabled": True})
    return u


def _make_warehouse(company: Company, user: User, code="MAG") -> Warehouse:
    return Warehouse.objects.create(
        company=company,
        user=user,
        code=code,
        name=code,
        warehouse_type=Warehouse.WarehouseType.MAIN,
    )


def _make_pz(company: Company, warehouse: Warehouse, number=None) -> DeliveryDocument:
    kwargs = dict(
        company=company,
        document_type="PZ",
        status="draft",
        issue_date=date(2026, 1, 1),
        to_warehouse=warehouse,
    )
    if number:
        kwargs["document_number"] = number
    return DeliveryDocument.objects.create(**kwargs)


def _make_ksef_invoice(company: Company, ksef_number=None) -> ReceivedKSeFInvoice:
    return ReceivedKSeFInvoice.objects.create(
        company=company,
        ksef_number=ksef_number or f"KSeF/{uuid.uuid4().hex[:8]}",
        invoice_number=f"FV/{uuid.uuid4().hex[:6]}",
    )


def _link(pz: DeliveryDocument, inv: ReceivedKSeFInvoice) -> DeliveryDocumentKSeFLink:
    return DeliveryDocumentKSeFLink.objects.create(
        delivery_document=pz,
        ksef_invoice=inv,
    )


# ─── Model tests ──────────────────────────────────────────────────────────────

class DeliveryDocumentKSeFLinkModelTests(TestCase):
    """DeliveryDocumentKSeFLink uniqueness and cascade behaviour."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)

    def test_duplicate_link_raises_integrity_error(self):
        pz = _make_pz(self.company, self.warehouse)
        inv = _make_ksef_invoice(self.company)
        _link(pz, inv)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                _link(pz, inv)

    def test_deleting_pz_cascades_to_links(self):
        pz = _make_pz(self.company, self.warehouse)
        inv = _make_ksef_invoice(self.company)
        _link(pz, inv)
        pz.delete()
        self.assertEqual(DeliveryDocumentKSeFLink.objects.count(), 0)

    def test_deleting_ksef_invoice_cascades_to_links(self):
        pz = _make_pz(self.company, self.warehouse)
        inv = _make_ksef_invoice(self.company)
        _link(pz, inv)
        inv.delete()
        self.assertEqual(DeliveryDocumentKSeFLink.objects.count(), 0)
        # PZ itself must still exist
        self.assertTrue(DeliveryDocument.objects.filter(pk=pz.pk).exists())

    def test_one_pz_linked_to_multiple_ksef_invoices(self):
        pz = _make_pz(self.company, self.warehouse)
        inv1 = _make_ksef_invoice(self.company, "KSeF/0001")
        inv2 = _make_ksef_invoice(self.company, "KSeF/0002")
        _link(pz, inv1)
        _link(pz, inv2)
        self.assertEqual(pz.ksef_links.count(), 2)

    def test_one_ksef_invoice_linked_to_multiple_pz(self):
        pz1 = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        pz2 = _make_pz(self.company, self.warehouse, "PZ/2026/0002")
        inv = _make_ksef_invoice(self.company)
        _link(pz1, inv)
        _link(pz2, inv)
        self.assertEqual(inv.pz_ksef_links.count(), 2)

    def test_links_ordered_by_linked_at(self):
        pz = _make_pz(self.company, self.warehouse)
        inv1 = _make_ksef_invoice(self.company, "KSeF/A")
        inv2 = _make_ksef_invoice(self.company, "KSeF/B")
        l1 = _link(pz, inv1)
        l2 = _link(pz, inv2)
        links = list(pz.ksef_links.all())
        self.assertEqual(links[0].pk, l1.pk)
        self.assertEqual(links[1].pk, l2.pk)


# ─── Filter tests (API) ───────────────────────────────────────────────────────

class KsefUnlinkedFilterAPITests(TestCase):
    """GET /api/delivery/?ksef_unlinked=true/false returns correct PZ documents."""

    def setUp(self):
        self.client = APIClient()
        self.company = _make_company("FilterCo")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user, "FLT")
        self.client.force_authenticate(user=self.user)
        self.list_url = reverse("delivery-document-list")

    def _pz(self, number):
        return _make_pz(self.company, self.warehouse, number)

    def test_ksef_unlinked_true_returns_only_pz_without_ksef_links(self):
        linked_pz = self._pz("PZ/2026/0001")
        unlinked_pz = self._pz("PZ/2026/0002")
        inv = _make_ksef_invoice(self.company)
        _link(linked_pz, inv)

        resp = self.client.get(self.list_url, {"document_type": "PZ", "ksef_unlinked": "true"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertIn(str(unlinked_pz.uuid), ids)
        self.assertNotIn(str(linked_pz.uuid), ids)

    def test_ksef_unlinked_false_returns_only_pz_with_ksef_links(self):
        linked_pz = self._pz("PZ/2026/0001")
        unlinked_pz = self._pz("PZ/2026/0002")
        inv = _make_ksef_invoice(self.company)
        _link(linked_pz, inv)

        resp = self.client.get(self.list_url, {"document_type": "PZ", "ksef_unlinked": "false"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertIn(str(linked_pz.uuid), ids)
        self.assertNotIn(str(unlinked_pz.uuid), ids)

    def test_ksef_unlinked_true_pz_with_multiple_links_appears_once(self):
        """distinct() prevents duplicate rows when PZ has >1 KSeF link."""
        pz = self._pz("PZ/2026/0001")
        # Link to two invoices — without .distinct() this would return the PZ twice
        # when using ksef_links__isnull=False
        inv1 = _make_ksef_invoice(self.company, "KSeF/A")
        inv2 = _make_ksef_invoice(self.company, "KSeF/B")
        _link(pz, inv1)
        _link(pz, inv2)

        resp = self.client.get(self.list_url, {"document_type": "PZ", "ksef_unlinked": "false"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r["id"] for r in resp.data["results"]]
        count = ids.count(str(pz.uuid))
        self.assertEqual(count, 1, "PZ with multiple KSeF links must appear exactly once")

    def test_ksef_unlinked_omitted_returns_all_pz(self):
        linked_pz = self._pz("PZ/2026/0001")
        unlinked_pz = self._pz("PZ/2026/0002")
        inv = _make_ksef_invoice(self.company)
        _link(linked_pz, inv)

        resp = self.client.get(self.list_url, {"document_type": "PZ"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertIn(str(linked_pz.uuid), ids)
        self.assertIn(str(unlinked_pz.uuid), ids)

    def test_ksef_unlinked_other_company_not_visible(self):
        other_company = _make_company("OtherCo")
        other_user = _make_user(other_company, "other")
        other_wh = _make_warehouse(other_company, other_user, "OTH")
        other_pz = _make_pz(other_company, other_wh, "PZ/2026/0001")

        resp = self.client.get(self.list_url, {"document_type": "PZ", "ksef_unlinked": "true"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertNotIn(str(other_pz.uuid), ids)


# ─── Serializer / API response tests ─────────────────────────────────────────

class DeliveryDocumentKsefRefsAPITests(TestCase):
    """API detail response includes ksef_invoice_refs[] and backward-compat ksef_invoice_ref."""

    def setUp(self):
        self.client = APIClient()
        self.company = _make_company("SerCo")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user, "SER")
        self.client.force_authenticate(user=self.user)

    def _detail_url(self, pz: DeliveryDocument):
        return reverse("delivery-document-detail", kwargs={"uuid": str(pz.uuid)})

    def test_no_links_returns_empty_ksef_invoice_refs(self):
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        resp = self.client.get(self._detail_url(pz))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data.get("ksef_invoice_refs", []), [])
        self.assertIsNone(resp.data.get("ksef_invoice_ref"))

    def test_single_link_returns_one_item_in_ksef_invoice_refs(self):
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        inv = _make_ksef_invoice(self.company, "KSeF/001")
        inv.invoice_number = "FV/2026/001"
        inv.save(update_fields=["invoice_number"])
        _link(pz, inv)

        resp = self.client.get(self._detail_url(pz))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        refs = resp.data.get("ksef_invoice_refs", [])
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["id"], str(inv.id))
        self.assertEqual(refs[0]["ksef_number"], "KSeF/001")
        self.assertEqual(refs[0]["invoice_number"], "FV/2026/001")

    def test_single_link_backward_compat_ksef_invoice_ref(self):
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        inv = _make_ksef_invoice(self.company, "KSeF/001")
        _link(pz, inv)

        resp = self.client.get(self._detail_url(pz))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ref = resp.data.get("ksef_invoice_ref")
        self.assertIsNotNone(ref)
        self.assertEqual(ref["id"], str(inv.id))

    def test_two_links_returns_both_in_ksef_invoice_refs(self):
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        inv1 = _make_ksef_invoice(self.company, "KSeF/A")
        inv2 = _make_ksef_invoice(self.company, "KSeF/B")
        _link(pz, inv1)
        _link(pz, inv2)

        resp = self.client.get(self._detail_url(pz))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        refs = resp.data.get("ksef_invoice_refs", [])
        self.assertEqual(len(refs), 2)
        ids = {r["id"] for r in refs}
        self.assertIn(str(inv1.id), ids)
        self.assertIn(str(inv2.id), ids)

    def test_two_links_backward_compat_returns_first_link(self):
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        inv1 = _make_ksef_invoice(self.company, "KSeF/First")
        inv2 = _make_ksef_invoice(self.company, "KSeF/Second")
        _link(pz, inv1)
        _link(pz, inv2)

        resp = self.client.get(self._detail_url(pz))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ref = resp.data.get("ksef_invoice_ref")
        self.assertIsNotNone(ref)
        # First link (by linked_at) should be the backward-compat value
        self.assertEqual(ref["id"], str(inv1.id))

    def test_ksef_invoice_refs_not_duplicated_in_list_response(self):
        """List endpoint must not return duplicate rows for PZ with multiple KSeF links."""
        pz = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        inv1 = _make_ksef_invoice(self.company, "KSeF/A")
        inv2 = _make_ksef_invoice(self.company, "KSeF/B")
        _link(pz, inv1)
        _link(pz, inv2)

        resp = self.client.get(reverse("delivery-document-list"), {"document_type": "PZ"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r["id"] for r in resp.data["results"]]
        self.assertEqual(ids.count(str(pz.uuid)), 1)


# ─── create_pz_kor M:M propagation ───────────────────────────────────────────

class CreatePzKorCopiesKsefLinksTests(TestCase):
    """create_pz_kor() must copy all M:M KSeF links from the original PZ to the PZ-KOR."""

    def setUp(self):
        self.company = _make_company("KorCo")
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user, "KOR")
        self.supplier = Supplier.objects.create(
            name="Dostawca", company=self.company, nip="0000000000"
        )
        self.product = Product.objects.create(
            name="Towar",
            company=self.company,
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            track_batches=False,  # simplest path: no StockBatch lookup
        )

    def _delivered_pz(self) -> DeliveryDocument:
        pz = DeliveryDocument.objects.create(
            company=self.company,
            document_type="PZ",
            status=DeliveryDocument.STATUS_DELIVERED,
            issue_date=date(2026, 1, 1),
            to_warehouse=self.warehouse,
            from_supplier=self.supplier,
            user=self.user,
        )
        DeliveryItem.objects.create(
            delivery_document=pz,
            product=self.product,
            quantity_planned=Decimal("10"),
            quantity_actual=Decimal("10"),
            unit_cost=Decimal("8.00"),
        )
        return pz

    def _correction_items(self, pz: DeliveryDocument) -> list:
        item = pz.items.first()
        return [
            {
                "delivery_item_id": str(item.uuid),
                "new_unit_cost": Decimal("9.00"),  # price change only
                "new_quantity_actual": None,
            }
        ]

    def test_create_pz_kor_copies_single_ksef_link(self):
        pz = self._delivered_pz()
        inv = _make_ksef_invoice(self.company, "KSeF/ORIG-001")
        _link(pz, inv)

        kor = create_pz_kor(pz, self._correction_items(pz), self.user)

        self.assertEqual(kor.document_type, "PZ-KOR")
        self.assertEqual(kor.ksef_links.count(), 1)
        linked_inv = kor.ksef_links.first().ksef_invoice
        self.assertEqual(linked_inv.pk, inv.pk)

    def test_create_pz_kor_copies_multiple_ksef_links(self):
        pz = self._delivered_pz()
        inv1 = _make_ksef_invoice(self.company, "KSeF/ORIG-001")
        inv2 = _make_ksef_invoice(self.company, "KSeF/ORIG-002")
        _link(pz, inv1)
        _link(pz, inv2)

        kor = create_pz_kor(pz, self._correction_items(pz), self.user)

        self.assertEqual(kor.ksef_links.count(), 2)
        linked_ids = {link.ksef_invoice_id for link in kor.ksef_links.all()}
        self.assertIn(inv1.pk, linked_ids)
        self.assertIn(inv2.pk, linked_ids)

    def test_create_pz_kor_with_no_ksef_links_creates_no_links(self):
        pz = self._delivered_pz()
        # No KSeF invoice linked

        kor = create_pz_kor(pz, self._correction_items(pz), self.user)

        self.assertEqual(kor.ksef_links.count(), 0)

    def test_create_pz_kor_original_pz_links_unchanged(self):
        """Creating a KOR must not remove or modify the original PZ's links."""
        pz = self._delivered_pz()
        inv = _make_ksef_invoice(self.company, "KSeF/ORIG-001")
        _link(pz, inv)

        create_pz_kor(pz, self._correction_items(pz), self.user)

        # Original PZ still has its link
        self.assertEqual(pz.ksef_links.count(), 1)

    def test_two_corrections_of_same_pz_each_get_independent_ksef_links(self):
        """Two PZ-KOR documents created from the same PZ each get their own link copies."""
        pz = self._delivered_pz()
        inv = _make_ksef_invoice(self.company, "KSeF/ORIG-001")
        _link(pz, inv)

        kor1 = create_pz_kor(pz, self._correction_items(pz), self.user)
        kor2 = create_pz_kor(pz, self._correction_items(pz), self.user)

        self.assertEqual(kor1.ksef_links.count(), 1)
        self.assertEqual(kor2.ksef_links.count(), 1)
        # Both KOR link to the same invoice but through independent link rows
        self.assertEqual(kor1.ksef_links.first().ksef_invoice_id, inv.pk)
        self.assertEqual(kor2.ksef_links.first().ksef_invoice_id, inv.pk)
        self.assertNotEqual(kor1.pk, kor2.pk)
