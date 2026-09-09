"""
Tests for PurchaseDocument M:M PZ linking (PurchaseDocumentPzLink).

Covers:
- link-pz endpoint (idempotent, multiple PZ per doc)
- unlink-pz endpoint (removes link, reverts status when no links remain)
- create-pz endpoint (creates PZ and links via M:M)
- serializer pz_documents[] output
- backward-compat pz_id / pz_number fields
- status transitions (registered → matched → registered)
"""
import uuid
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.delivery.models import DeliveryDocument
from apps.products.models import Warehouse
from apps.purchase_documents.models import PurchaseDocument, PurchaseDocumentPzLink
from apps.suppliers.models import Supplier
from apps.users.models import Company, CompanyMembership, CompanyModule

User = get_user_model()


def _make_company(name="TestCo") -> Company:
    nip = f"{abs(hash(name)) % 10_000_000_000:010d}"
    return Company.objects.create(name=name, nip=nip)


def _make_user(company: Company, role="admin") -> User:
    uid = uuid.uuid4().hex[:8]
    u = User.objects.create_user(
        username=f"user_{uid}",
        email=f"user_{uid}@test.invalid",
        password="pass",
        current_company=company,
    )
    CompanyMembership.objects.create(user=u, company=company, role=role)
    CompanyModule.objects.get_or_create(company=company, module="warehouses")
    CompanyModule.objects.get_or_create(company=company, module="purchase_documents")
    return u


def _make_pz(company: Company, warehouse: Warehouse, number="PZ/2026/0001") -> DeliveryDocument:
    return DeliveryDocument.objects.create(
        company=company,
        document_type="PZ",
        status="draft",
        issue_date=date(2026, 1, 1),
        to_warehouse=warehouse,
        document_number=number,
    )


def _make_fz(company: Company, number="FV/2026/001") -> PurchaseDocument:
    return PurchaseDocument.objects.create(
        company=company,
        doc_type="FZ",
        status="registered",
        document_number=number,
        issue_date=date(2026, 1, 1),
    )


def _make_warehouse(company: Company, user, code="MAG1") -> Warehouse:
    return Warehouse.objects.create(company=company, user=user, name=code, code=code)


class PurchaseDocPzLinkModelTests(TestCase):
    """PurchaseDocumentPzLink uniqueness and cascade delete."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)

    def test_duplicate_link_raises_integrity_error(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz)
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz)

    def test_deleting_fz_cascades_to_links(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz)
        fz.delete()
        self.assertEqual(PurchaseDocumentPzLink.objects.count(), 0)

    def test_deleting_pz_cascades_to_links(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz)
        pz.delete()
        self.assertEqual(PurchaseDocumentPzLink.objects.count(), 0)
        # FZ should still exist, but with no links
        fz.refresh_from_db()
        self.assertEqual(fz.pz_links.count(), 0)

    def test_one_fz_can_have_multiple_pz(self):
        fz = _make_fz(self.company)
        pz1 = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        pz2 = _make_pz(self.company, self.warehouse, "PZ/2026/0002")
        PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz1)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz, delivery_document=pz2)
        self.assertEqual(fz.pz_links.count(), 2)

    def test_one_pz_can_be_linked_to_multiple_fz(self):
        fz1 = _make_fz(self.company, "FV/2026/001")
        fz2 = _make_fz(self.company, "FV/2026/002")
        pz = _make_pz(self.company, self.warehouse)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz1, delivery_document=pz)
        PurchaseDocumentPzLink.objects.create(purchase_document=fz2, delivery_document=pz)
        self.assertEqual(pz.purchase_doc_links.count(), 2)


class PurchaseDocLinkPzAPITests(TestCase):
    """API: link-pz endpoint."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _link_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-link-pz", kwargs={"uuid": fz.uuid})

    def test_link_pz_creates_m2m_link(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        resp = self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(fz.pz_links.count(), 1)
        self.assertEqual(str(fz.pz_links.first().delivery_document.uuid), str(pz.uuid))

    def test_link_pz_sets_status_matched(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        fz.refresh_from_db()
        self.assertEqual(fz.status, PurchaseDocument.STATUS_MATCHED)

    def test_link_pz_idempotent(self):
        """Linking the same PZ twice returns 200 and creates only one link."""
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        resp = self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(fz.pz_links.count(), 1)

    def test_link_multiple_pz_to_one_fz(self):
        fz = _make_fz(self.company)
        pz1 = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        pz2 = _make_pz(self.company, self.warehouse, "PZ/2026/0002")
        self.client.post(self._link_url(fz), {"pz_id": str(pz1.uuid)}, format="json")
        self.client.post(self._link_url(fz), {"pz_id": str(pz2.uuid)}, format="json")
        self.assertEqual(fz.pz_links.count(), 2)

    def test_link_one_pz_to_multiple_fz(self):
        fz1 = _make_fz(self.company, "FV/2026/001")
        fz2 = _make_fz(self.company, "FV/2026/002")
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz1), {"pz_id": str(pz.uuid)}, format="json")
        self.client.post(self._link_url(fz2), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(pz.purchase_doc_links.count(), 2)

    def test_link_pz_response_contains_pz_documents_list(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        resp = self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        data = resp.json()
        self.assertIn("pz_documents", data)
        self.assertEqual(len(data["pz_documents"]), 1)
        self.assertEqual(data["pz_documents"][0]["id"], str(pz.uuid))

    def test_link_pz_missing_pz_id_returns_400(self):
        fz = _make_fz(self.company)
        resp = self.client.post(self._link_url(fz), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_link_pz_wrong_company_returns_400(self):
        fz = _make_fz(self.company)
        other_company = _make_company("OtherCo")
        other_user = _make_user(other_company)
        other_wh = _make_warehouse(other_company, other_user, "MAG2")
        pz = _make_pz(other_company, other_wh)
        resp = self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_link_pz_nonexistent_uuid_returns_400(self):
        fz = _make_fz(self.company)
        resp = self.client.post(self._link_url(fz), {"pz_id": str(uuid.uuid4())}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class PurchaseDocUnlinkPzAPITests(TestCase):
    """API: unlink-pz endpoint."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _unlink_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-unlink-pz", kwargs={"uuid": fz.uuid})

    def _link_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-link-pz", kwargs={"uuid": fz.uuid})

    def test_unlink_removes_link(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(fz.pz_links.count(), 1)

        resp = self.client.post(self._unlink_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(fz.pz_links.count(), 0)

    def test_unlink_last_pz_reverts_status_to_registered(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.client.post(self._unlink_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        fz.refresh_from_db()
        self.assertEqual(fz.status, PurchaseDocument.STATUS_REGISTERED)

    def test_unlink_one_of_two_pz_keeps_status_matched(self):
        fz = _make_fz(self.company)
        pz1 = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        pz2 = _make_pz(self.company, self.warehouse, "PZ/2026/0002")
        self.client.post(self._link_url(fz), {"pz_id": str(pz1.uuid)}, format="json")
        self.client.post(self._link_url(fz), {"pz_id": str(pz2.uuid)}, format="json")
        self.client.post(self._unlink_url(fz), {"pz_id": str(pz1.uuid)}, format="json")
        fz.refresh_from_db()
        self.assertEqual(fz.status, PurchaseDocument.STATUS_MATCHED)
        self.assertEqual(fz.pz_links.count(), 1)

    def test_unlink_nonexistent_link_returns_404(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        resp = self.client.post(self._unlink_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_unlink_missing_pz_id_returns_400(self):
        fz = _make_fz(self.company)
        resp = self.client.post(self._unlink_url(fz), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unlink_response_pz_documents_is_empty_list(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        resp = self.client.post(self._unlink_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        data = resp.json()
        self.assertEqual(data["pz_documents"], [])

    def test_unlink_pz_from_wrong_company_returns_404(self):
        """Cannot unlink a PZ from a document in another company (not visible)."""
        fz = _make_fz(self.company)
        other_company = _make_company("OtherCo")
        other_user = _make_user(other_company)
        other_wh = _make_warehouse(other_company, other_user, "MAG2")
        pz = _make_pz(other_company, other_wh)
        resp = self.client.post(self._unlink_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class PurchaseDocSerializerPzFieldsTests(TestCase):
    """Serializer: pz_documents, pz_id, pz_number backward-compat."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _detail_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-detail", kwargs={"uuid": fz.uuid})

    def _link_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-link-pz", kwargs={"uuid": fz.uuid})

    def test_no_links_returns_empty_pz_documents(self):
        fz = _make_fz(self.company)
        resp = self.client.get(self._detail_url(fz))
        data = resp.json()
        self.assertEqual(data["pz_documents"], [])
        self.assertIsNone(data["pz_id"])
        self.assertIsNone(data["pz_number"])

    def test_one_link_returns_correct_pz_documents(self):
        fz = _make_fz(self.company)
        pz = _make_pz(self.company, self.warehouse)
        self.client.post(self._link_url(fz), {"pz_id": str(pz.uuid)}, format="json")
        resp = self.client.get(self._detail_url(fz))
        data = resp.json()
        self.assertEqual(len(data["pz_documents"]), 1)
        self.assertEqual(data["pz_documents"][0]["id"], str(pz.uuid))
        self.assertEqual(data["pz_documents"][0]["document_number"], pz.document_number)
        # backward-compat
        self.assertEqual(data["pz_id"], str(pz.uuid))
        self.assertEqual(data["pz_number"], pz.document_number)

    def test_two_links_returns_both_in_pz_documents(self):
        fz = _make_fz(self.company)
        pz1 = _make_pz(self.company, self.warehouse, "PZ/2026/0001")
        pz2 = _make_pz(self.company, self.warehouse, "PZ/2026/0002")
        self.client.post(self._link_url(fz), {"pz_id": str(pz1.uuid)}, format="json")
        self.client.post(self._link_url(fz), {"pz_id": str(pz2.uuid)}, format="json")
        resp = self.client.get(self._detail_url(fz))
        data = resp.json()
        self.assertEqual(len(data["pz_documents"]), 2)
        ids_returned = {d["id"] for d in data["pz_documents"]}
        self.assertIn(str(pz1.uuid), ids_returned)
        self.assertIn(str(pz2.uuid), ids_returned)

    def test_unauthenticated_request_returns_401(self):
        fz = _make_fz(self.company)
        self.client.force_authenticate(user=None)
        resp = self.client.get(self._detail_url(fz))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class PurchaseDocCreatePzAPITests(TestCase):
    """API: create-pz endpoint — creates PZ and links via M:M."""

    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _create_pz_url(self, fz: PurchaseDocument) -> str:
        return reverse("purchase-documents-create-pz", kwargs={"uuid": fz.uuid})

    def test_create_pz_links_new_pz_via_m2m(self):
        fz = _make_fz(self.company)
        resp = self.client.post(
            self._create_pz_url(fz),
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(fz.pz_links.count(), 1)

    def test_create_pz_sets_status_matched(self):
        fz = _make_fz(self.company)
        self.client.post(
            self._create_pz_url(fz),
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        fz.refresh_from_db()
        self.assertEqual(fz.status, PurchaseDocument.STATUS_MATCHED)

    def test_create_second_pz_for_same_fz_is_allowed(self):
        """Multiple create-pz calls create multiple PZ (M:M — no longer blocked)."""
        fz = _make_fz(self.company)
        self.client.post(
            self._create_pz_url(fz),
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        resp = self.client.post(
            self._create_pz_url(fz),
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(fz.pz_links.count(), 2)

    def test_create_pz_missing_warehouse_returns_400(self):
        fz = _make_fz(self.company)
        resp = self.client.post(self._create_pz_url(fz), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_pz_wrong_warehouse_company_returns_400(self):
        fz = _make_fz(self.company)
        other_company = _make_company("OtherCo")
        other_user = _make_user(other_company)
        other_wh = _make_warehouse(other_company, other_user, "MAG2")
        resp = self.client.post(
            self._create_pz_url(fz),
            {"to_warehouse_id": str(other_wh.uuid)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
