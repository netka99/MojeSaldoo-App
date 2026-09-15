"""Tests for purchase_orders app (ZD — Zamówienia do Dostawców)."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.products.models import Product, Warehouse
from apps.suppliers.models import Supplier
from apps.users.models import Company, CompanyMembership, CompanyModule

from .models import SupplierOrder, SupplierOrderItem

User = get_user_model()

LIST_URL = reverse("supplier-order-list")


def _create_company_and_user(username="zd-user"):
    company = Company.objects.create(name=f"ZD Test Co ({username})")
    user = User.objects.create_user(
        username=username, email=f"{username}@test.com", password="pass123"
    )
    CompanyMembership.objects.create(user=user, company=company, role="admin", is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    CompanyModule.objects.create(company=company, module="purchase_orders", is_enabled=True)
    CompanyModule.objects.create(company=company, module="purchasing", is_enabled=True)
    CompanyModule.objects.create(company=company, module="warehouses", is_enabled=True)
    CompanyModule.objects.create(company=company, module="delivery", is_enabled=True)
    return company, user


def _make_product(company, name="Widget", price="10.00"):
    return Product.objects.create(
        name=name,
        company=company,
        price_gross=Decimal(price),
        unit="szt",
    )


def _make_warehouse(company, user):
    return Warehouse.objects.create(
        company=company,
        user=user,
        name="Główny",
        code="MG",
        warehouse_type=Warehouse.WarehouseType.MAIN,
    )


def _make_supplier(company, name="Dostawca A"):
    return Supplier.objects.create(company=company, name=name)


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

class SupplierOrderModelTests(TestCase):
    def setUp(self):
        self.company, self.user = _create_company_and_user("model-user")
        self.product = _make_product(self.company)

    def test_document_number_auto_assigned(self):
        so = SupplierOrder.objects.create(company=self.company, created_by=self.user)
        self.assertRegex(so.document_number, r"^ZD/\d{4}/\d{4}$")

    def test_document_number_increments(self):
        so1 = SupplierOrder.objects.create(company=self.company, created_by=self.user)
        so2 = SupplierOrder.objects.create(company=self.company, created_by=self.user)
        seq1 = int(so1.document_number.split("/")[2])
        seq2 = int(so2.document_number.split("/")[2])
        self.assertEqual(seq2, seq1 + 1)

    def test_supplier_name_snapshot(self):
        supplier = _make_supplier(self.company)
        so = SupplierOrder.objects.create(
            company=self.company, created_by=self.user, supplier=supplier
        )
        self.assertEqual(so.supplier_name, "Dostawca A")

    def test_refresh_status_to_fulfilled(self):
        so = SupplierOrder.objects.create(
            company=self.company, created_by=self.user, status=SupplierOrder.STATUS_SENT
        )
        item = SupplierOrderItem.objects.create(
            supplier_order=so,
            product=self.product,
            quantity_ordered=Decimal("10"),
            quantity_received=Decimal("10"),
        )
        so.refresh_status()
        so.refresh_from_db()
        self.assertEqual(so.status, SupplierOrder.STATUS_FULFILLED)

    def test_refresh_status_to_partial(self):
        so = SupplierOrder.objects.create(
            company=self.company, created_by=self.user, status=SupplierOrder.STATUS_SENT
        )
        SupplierOrderItem.objects.create(
            supplier_order=so,
            product=self.product,
            quantity_ordered=Decimal("10"),
            quantity_received=Decimal("5"),
        )
        so.refresh_status()
        so.refresh_from_db()
        self.assertEqual(so.status, SupplierOrder.STATUS_PARTIAL)


# ---------------------------------------------------------------------------
# API — CRUD
# ---------------------------------------------------------------------------

class SupplierOrderCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company, self.user = _create_company_and_user("crud-user")
        self.client.force_authenticate(self.user)
        self.product = _make_product(self.company)
        self.supplier = _make_supplier(self.company)

    def _create_payload(self, **kwargs):
        payload = {
            "issue_date": "2026-09-15",
            "items": [
                {
                    "product_id": str(self.product.uuid),
                    "quantity_ordered": "20.00",
                    "unit_price_net": "8.50",
                }
            ],
        }
        payload.update(kwargs)
        return payload

    def test_create_returns_201(self):
        r = self.client.post(LIST_URL, self._create_payload(), format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertRegex(r.data["document_number"], r"^ZD/\d{4}/\d{4}$")

    def test_create_with_supplier(self):
        r = self.client.post(
            LIST_URL,
            self._create_payload(supplier_id=str(self.supplier.uuid)),
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["supplier_name"], self.supplier.name)

    def test_create_without_items_returns_400(self):
        r = self.client.post(LIST_URL, {"issue_date": "2026-09-15", "items": []}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_returns_only_own_company(self):
        SupplierOrder.objects.create(company=self.company, created_by=self.user)
        other_company, other_user = _create_company_and_user("other-user")
        SupplierOrder.objects.create(company=other_company, created_by=other_user)

        r = self.client.get(LIST_URL)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data["results"]), 1)

    def test_cancel_sets_status(self):
        r = self.client.post(LIST_URL, self._create_payload(), format="json")
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": r.data["id"]})
        r2 = self.client.delete(detail_url)
        self.assertEqual(r2.status_code, status.HTTP_204_NO_CONTENT)
        so = SupplierOrder.objects.get(uuid=r.data["id"])
        self.assertEqual(so.status, SupplierOrder.STATUS_CANCELLED)

    def test_send_action(self):
        r = self.client.post(LIST_URL, self._create_payload(), format="json")
        send_url = reverse("supplier-order-send", kwargs={"uuid": r.data["id"]})
        r2 = self.client.post(send_url)
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertEqual(r2.data["status"], SupplierOrder.STATUS_SENT)

    def test_requires_module(self):
        CompanyModule.objects.filter(
            company=self.company, module="purchase_orders"
        ).update(is_enabled=False)
        r = self.client.get(LIST_URL)
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(None)
        r = self.client.get(LIST_URL)
        self.assertIn(r.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])


# ---------------------------------------------------------------------------
# API — create-pz action
# ---------------------------------------------------------------------------

class SupplierOrderCreatePzTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company, self.user = _create_company_and_user("pz-user")
        self.client.force_authenticate(self.user)
        self.product = _make_product(self.company)
        self.warehouse = _make_warehouse(self.company, self.user)

        # Create a ZD
        r = self.client.post(
            LIST_URL,
            {
                "issue_date": "2026-09-15",
                "items": [
                    {
                        "product_id": str(self.product.uuid),
                        "quantity_ordered": "50.00",
                        "unit_price_net": "5.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.so_uuid = r.data["id"]
        self.create_pz_url = reverse(
            "supplier-order-create-pz", kwargs={"uuid": self.so_uuid}
        )

    def test_create_pz_returns_201(self):
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["document_type"], "PZ")

    def test_create_pz_links_back_to_zd(self):
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        from apps.delivery.models import DeliveryDocument
        pz = DeliveryDocument.objects.get(uuid=r.data["id"])
        self.assertEqual(str(pz.source_supplier_order.uuid), self.so_uuid)

    def test_create_pz_uses_zd_quantities(self):
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        from apps.delivery.models import DeliveryItem
        items = DeliveryItem.objects.filter(
            delivery_document__uuid=r.data["id"]
        )
        self.assertEqual(items.count(), 1)
        self.assertEqual(items.first().quantity_planned, Decimal("50.00"))

    def test_create_pz_without_warehouse_returns_400(self):
        r = self.client.post(self.create_pz_url, {}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_pz_updates_quantity_received(self):
        # Create PZ and post it (mark as delivered)
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)

        # Simulate posting (completing) the PZ — signal fires on save
        from apps.delivery.models import DeliveryDocument
        pz = DeliveryDocument.objects.get(uuid=r.data["id"])
        pz.status = DeliveryDocument.STATUS_DELIVERED
        pz.save(update_fields=["status"])

        so_item = SupplierOrderItem.objects.get(supplier_order__uuid=self.so_uuid)
        so_item.refresh_from_db()
        # quantity_received should equal quantity_actual of the PZ item
        self.assertEqual(so_item.quantity_received, Decimal("50.00"))

    def test_cancelled_zd_cannot_create_pz(self):
        # Cancel the ZD first
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": self.so_uuid})
        self.client.delete(detail_url)
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_fulfilled_zd_cannot_create_pz(self):
        # Manually set status to fulfilled
        so = SupplierOrder.objects.get(uuid=self.so_uuid)
        so.status = SupplierOrder.STATUS_FULFILLED
        so.save(update_fields=["status"])
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_pz_with_custom_quantities(self):
        """items override in the request body overrides ZD quantities."""
        r = self.client.post(
            self.create_pz_url,
            {
                "to_warehouse_id": str(self.warehouse.uuid),
                "items": [
                    {
                        "product_id": str(self.product.uuid),
                        "quantity_ordered": "20.00",  # partial delivery
                        "unit_cost": "6.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        from apps.delivery.models import DeliveryItem
        item = DeliveryItem.objects.get(delivery_document__uuid=r.data["id"])
        self.assertEqual(item.quantity_planned, Decimal("20.00"))
        self.assertEqual(item.unit_cost, Decimal("6.0000"))

    def test_pz_deletion_resets_quantity_received(self):
        """Deleting a PZ linked to ZD should bring quantity_received back to 0."""
        # Create PZ
        r = self.client.post(
            self.create_pz_url,
            {"to_warehouse_id": str(self.warehouse.uuid)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)

        # Verify quantity_received updated after PZ creation
        so_item = SupplierOrderItem.objects.get(supplier_order__uuid=self.so_uuid)
        so_item.refresh_from_db()
        self.assertEqual(so_item.quantity_received, Decimal("50.00"))

        # Delete the PZ
        from apps.delivery.models import DeliveryDocument
        DeliveryDocument.objects.get(uuid=r.data["id"]).delete()

        # quantity_received should drop back to 0
        so_item.refresh_from_db()
        self.assertEqual(so_item.quantity_received, Decimal("0.00"))

    def test_cross_company_cannot_access_zd(self):
        """A user from another company must not see this company's ZD."""
        other_company, other_user = _create_company_and_user("intruder-user")
        self.client.force_authenticate(other_user)
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": self.so_uuid})
        r = self.client.get(detail_url)
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


# ---------------------------------------------------------------------------
# API — lifecycle edge cases
# ---------------------------------------------------------------------------

class SupplierOrderLifecycleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company, self.user = _create_company_and_user("lifecycle-user")
        self.client.force_authenticate(self.user)
        self.product = _make_product(self.company)

    def _create_zd(self, **kwargs):
        payload = {
            "issue_date": "2026-09-15",
            "items": [{"product_id": str(self.product.uuid), "quantity_ordered": "10.00"}],
        }
        payload.update(kwargs)
        r = self.client.post(LIST_URL, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        return r.data["id"]

    def test_cannot_send_already_sent_zd(self):
        zd_id = self._create_zd()
        send_url = reverse("supplier-order-send", kwargs={"uuid": zd_id})
        self.client.post(send_url)  # first send → OK
        r2 = self.client.post(send_url)  # second send → 400
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_cancel_fulfilled_zd(self):
        zd_id = self._create_zd()
        so = SupplierOrder.objects.get(uuid=zd_id)
        so.status = SupplierOrder.STATUS_FULFILLED
        so.save(update_fields=["status"])
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": zd_id})
        r = self.client.delete(detail_url)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        so.refresh_from_db()
        self.assertEqual(so.status, SupplierOrder.STATUS_FULFILLED)

    def test_patch_notes_and_expected_date(self):
        zd_id = self._create_zd()
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": zd_id})
        r = self.client.patch(
            detail_url,
            {"notes": "Ważna dostawa", "expected_delivery_date": "2026-09-30"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        so = SupplierOrder.objects.get(uuid=zd_id)
        self.assertEqual(so.notes, "Ważna dostawa")
        self.assertEqual(str(so.expected_delivery_date), "2026-09-30")

    def test_patch_rejected_on_fulfilled_zd(self):
        zd_id = self._create_zd()
        so = SupplierOrder.objects.get(uuid=zd_id)
        so.status = SupplierOrder.STATUS_FULFILLED
        so.save(update_fields=["status"])
        detail_url = reverse("supplier-order-detail", kwargs={"uuid": zd_id})
        r = self.client.patch(detail_url, {"notes": "zmiana"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_filter_by_status(self):
        self._create_zd()  # draft
        zd2 = self._create_zd()
        send_url = reverse("supplier-order-send", kwargs={"uuid": zd2})
        self.client.post(send_url)

        r = self.client.get(LIST_URL, {"status": "sent"})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(r.data["results"][0]["status"], "sent")
