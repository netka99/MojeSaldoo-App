import uuid
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.delivery.serializers import DeliveryDocumentSerializer
from apps.delivery.services import generate_delivery_from_order
from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, StockMovement, Warehouse
from apps.users.models import Company, CompanyMembership


class DeliveryDocumentModelTests(TestCase):
    """Document numbering, uniqueness, and basic persistence."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="delivery-model-user",
            email="delivery-model@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Comp A")
        self.company_b = Company.objects.create(name="Comp B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.customer = Customer.objects.create(name="Cust A", company=self.company)
        self.customer_b = Customer.objects.create(name="Cust B", company=self.company_b)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DRAFT,
        )
        self.order_b = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.company_b,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DRAFT,
        )

    def _make_doc(self, company=None, order=None, **kwargs):
        return DeliveryDocument.objects.create(
            company=company or self.company,
            order=order or self.order,
            user=self.user,
            document_type=kwargs.pop("document_type", DeliveryDocument.DOC_TYPE_WZ),
            issue_date=kwargs.pop("issue_date", date(2026, 4, 1)),
            **kwargs,
        )

    def test_new_document_receives_sequential_number_per_company_and_type(self):
        d1 = self._make_doc()
        d2 = self._make_doc()
        self.assertEqual(d1.document_number, "WZ/2026/0001")
        self.assertEqual(d2.document_number, "WZ/2026/0002")

    def test_different_document_types_have_independent_sequences(self):
        wz = self._make_doc(document_type=DeliveryDocument.DOC_TYPE_WZ)
        mm = self._make_doc(document_type=DeliveryDocument.DOC_TYPE_MM)
        pz = self._make_doc(document_type=DeliveryDocument.DOC_TYPE_PZ)
        self.assertEqual(wz.document_number, "WZ/2026/0001")
        self.assertEqual(mm.document_number, "MM/2026/0001")
        self.assertEqual(pz.document_number, "PZ/2026/0001")

    def test_different_companies_may_reuse_number_pattern(self):
        a = self._make_doc()
        b = self._make_doc(company=self.company_b, order=self.order_b)
        self.assertEqual(a.document_number, "WZ/2026/0001")
        self.assertEqual(b.document_number, "WZ/2026/0001")

    def test_year_is_taken_from_issue_date(self):
        d = self._make_doc(issue_date=date(2025, 6, 15))
        self.assertEqual(d.document_number, "WZ/2025/0001")

    def test_explicit_document_number_is_not_replaced(self):
        d = self._make_doc(document_number="MANUAL-WZ-1")
        self.assertEqual(d.document_number, "MANUAL-WZ-1")

    def test_duplicate_document_number_per_company_fails(self):
        first = self._make_doc()
        with self.assertRaises(IntegrityError):
            DeliveryDocument.objects.create(
                company=self.company,
                order=self.order,
                user=self.user,
                document_type=DeliveryDocument.DOC_TYPE_WZ,
                issue_date=date(2026, 4, 1),
                document_number=first.document_number,
            )

    def test_id_is_uuid(self):
        d = self._make_doc()
        self.assertEqual(len(str(d.id)), 36)

    def test_default_status_is_draft(self):
        d = self._make_doc()
        self.assertEqual(d.status, DeliveryDocument.STATUS_DRAFT)

    def test_str_uses_document_number_when_set(self):
        d = self._make_doc()
        self.assertEqual(str(d), "WZ/2026/0001")


class DeliveryItemModelTests(TestCase):
    """Line items: FK behavior and defaults."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="delivery-item-user",
            email="delivery-item@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Item Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.customer = Customer.objects.create(name="C1", company=self.company)
        self.product = Product.objects.create(
            name="Widget",
            company=self.company,
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DRAFT,
        )
        self.order_item = OrderItem.objects.create(
            order=self.order,
            product=self.product,
            quantity=Decimal("5.00"),
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            discount_percent=Decimal("0.00"),
        )
        self.doc = DeliveryDocument.objects.create(
            company=self.company,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
        )

    def test_create_sets_defaults_and_optional_actual(self):
        line = DeliveryItem.objects.create(
            delivery_document=self.doc,
            order_item=self.order_item,
            product=self.product,
            quantity_planned=Decimal("3.50"),
        )
        self.assertEqual(line.quantity_planned, Decimal("3.50"))
        self.assertIsNone(line.quantity_actual)
        self.assertEqual(line.quantity_returned, Decimal("0"))
        self.assertEqual(line.return_reason, "")
        self.assertFalse(line.is_damaged)
        self.assertEqual(len(str(line.id)), 36)

    def test_delete_delivery_document_cascades_to_items(self):
        line = DeliveryItem.objects.create(
            delivery_document=self.doc,
            order_item=self.order_item,
            product=self.product,
            quantity_planned=Decimal("1.00"),
        )
        pk = line.pk
        self.doc.delete()
        self.assertFalse(DeliveryItem.objects.filter(pk=pk).exists())

    def test_delete_order_item_blocked_while_referenced(self):
        DeliveryItem.objects.create(
            delivery_document=self.doc,
            order_item=self.order_item,
            product=self.product,
            quantity_planned=Decimal("1.00"),
        )
        with self.assertRaises(ProtectedError):
            self.order_item.delete()


class DeliveryDocumentSerializerTests(TestCase):
    """Serializer validation with request / current company context."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="delivery-serializer-user",
            email="delivery-ser@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Ser Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.customer = Customer.objects.create(name="C1", company=self.company)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DRAFT,
        )
        self.factory = APIRequestFactory()
        self.request = self.factory.post("/api/delivery/")
        self.request.user = self.user

    def test_valid_minimal_payload(self):
        ser = DeliveryDocumentSerializer(
            data={
                "order_id": str(self.order.id),
                "document_type": DeliveryDocument.DOC_TYPE_WZ,
                "issue_date": "2026-04-20",
            },
            context={"request": self.request},
        )
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_validate_order_rejects_other_company_when_in_context(self):
        other_co = Company.objects.create(name="Other")
        foreign_c = Customer.objects.create(name="FC", company=other_co)
        foreign_o = Order.objects.create(
            user=self.user,
            customer=foreign_c,
            company=other_co,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 2, 1),
            status=Order.STATUS_DRAFT,
        )
        ser = DeliveryDocumentSerializer(
            data={
                "order_id": str(foreign_o.id),
                "document_type": DeliveryDocument.DOC_TYPE_WZ,
                "issue_date": "2026-04-20",
            },
            context={"request": self.request},
        )
        self.assertFalse(ser.is_valid())
        self.assertIn("order_id", ser.errors)


class DeliveryDocumentAPITests(TestCase):
    """ViewSet: auth, tenant scope, CRUD."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="delivery-api-user",
            email="delivery-api@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Delivery tenant")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.customer = Customer.objects.create(name="Buyer", company=self.co)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DRAFT,
        )
        self.wh = Warehouse.objects.create(
            user=self.user,
            company=self.co,
            code="MG",
            name="Main",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        self.product = Product.objects.create(
            name="Line product",
            company=self.co,
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
        )
        self.product_b = Product.objects.create(
            name="Other line product",
            company=self.co,
            price_net=Decimal("5.00"),
            price_gross=Decimal("6.00"),
        )

    def test_delivery_document_list_url_resolves(self):
        self.assertEqual(reverse("delivery-document-list"), "/api/delivery/")

    def test_list_requires_authentication(self):
        r = self.client.get(reverse("delivery-document-list"))
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_authenticated_returns_results(self):
        DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 15),
        )
        self.client.force_authenticate(user=self.user)
        r = self.client.get(reverse("delivery-document-list"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("results", r.data)
        self.assertGreaterEqual(r.data["count"], 1)

    def test_list_includes_order_number_and_customer_name(self):
        self.client.force_authenticate(user=self.user)
        DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 20),
        )
        r = self.client.get(reverse("delivery-document-list"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        row = r.data["results"][0]
        self.assertEqual(row["order_number"], self.order.order_number)
        self.assertEqual(row["customer_name"], self.customer.name)

    def test_list_forbidden_without_current_company(self):
        u = get_user_model().objects.create_user(
            username="no-cc-del",
            email="no-cc-d@test.com",
            password="x",
        )
        CompanyMembership.objects.create(
            user=u, company=self.co, role="viewer", is_active=True
        )
        self.client.force_authenticate(u)
        r = self.client.get(reverse("delivery-document-list"))
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_list_forbidden_wrong_current_company(self):
        other = Company.objects.create(name="Not member")
        self.user.current_company = other
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)
        r = self.client.get(reverse("delivery-document-list"))
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])

    def test_create_sets_company_user_and_document_number(self):
        self.client.force_authenticate(user=self.user)
        body = {
            "order_id": str(self.order.id),
            "document_type": DeliveryDocument.DOC_TYPE_WZ,
            "issue_date": "2026-04-18",
            "from_warehouse_id": str(self.wh.id),
        }
        r = self.client.post(
            reverse("delivery-document-list"),
            data=body,
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["document_number"], "WZ/2026/0001")
        self.assertEqual(r.data["status"], DeliveryDocument.STATUS_DRAFT)
        self.assertEqual(str(r.data["company"]), str(self.co.id))
        self.assertEqual(str(r.data["user"]), str(self.user.id))
        row = DeliveryDocument.objects.get(id=r.data["id"])
        self.assertEqual(row.company_id, self.co.id)
        self.assertEqual(row.user_id, self.user.id)

    def test_retrieve_from_other_company_returns_404(self):
        self.client.force_authenticate(user=self.user)
        other_co = Company.objects.create(name="OtherCo")
        foreign_c = Customer.objects.create(name="Ext", company=other_co)
        foreign_o = Order.objects.create(
            user=self.user,
            customer=foreign_c,
            company=other_co,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 8, 1),
            status=Order.STATUS_DRAFT,
        )
        foreign_doc = DeliveryDocument.objects.create(
            company=other_co,
            order=foreign_o,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 5, 1),
        )
        r = self.client.get(
            reverse("delivery-document-detail", kwargs={"pk": str(foreign_doc.id)})
        )
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_create_rejects_order_from_other_company(self):
        self.client.force_authenticate(user=self.user)
        other_co = Company.objects.create(name="Foreign")
        foreign_c = Customer.objects.create(name="F", company=other_co)
        foreign_o = Order.objects.create(
            user=self.user,
            customer=foreign_c,
            company=other_co,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 8, 1),
            status=Order.STATUS_DRAFT,
        )
        r = self.client.post(
            reverse("delivery-document-list"),
            data={
                "order_id": str(foreign_o.id),
                "document_type": DeliveryDocument.DOC_TYPE_WZ,
                "issue_date": "2026-04-01",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("order_id", r.data)

    def test_patch_updates_fields_and_sets_user(self):
        self.client.force_authenticate(user=self.user)
        d = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
        )
        other = get_user_model().objects.create_user(
            username="delivery-editor",
            email="editor@test.com",
            password="x",
        )
        CompanyMembership.objects.create(
            user=other, company=self.co, role="admin", is_active=True
        )
        other.current_company = self.co
        other.save(update_fields=["current_company"])
        self.client.force_authenticate(user=other)
        r = self.client.patch(
            reverse("delivery-document-detail", kwargs={"pk": str(d.id)}),
            data={"driver_name": "Jan K."},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], DeliveryDocument.STATUS_DRAFT)
        self.assertEqual(r.data["driver_name"], "Jan K.")
        d.refresh_from_db()
        self.assertEqual(d.user_id, other.id)

    def test_create_uses_issue_date_year_in_document_number(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.post(
            reverse("delivery-document-list"),
            data={
                "order_id": str(self.order.id),
                "document_type": DeliveryDocument.DOC_TYPE_WZ,
                "issue_date": "2025-12-01",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["document_number"], "WZ/2025/0001")

    def _url_save(self, doc_id):
        return reverse("delivery-document-save", kwargs={"pk": str(doc_id)})

    def _url_start_delivery(self, doc_id):
        return reverse("delivery-document-start-delivery", kwargs={"pk": str(doc_id)})

    def _url_complete(self, doc_id):
        return reverse("delivery-document-complete", kwargs={"pk": str(doc_id)})

    def _url_generate(self, order_id):
        return reverse(
            "delivery-document-generate-for-order",
            kwargs={"order_id": str(order_id)},
        )

    def _reserve_stock_for_order(self, order: Order, warehouse: Warehouse) -> None:
        """Mirror post-confirm stock: one ProductStock row per product with reservation."""
        pool = Decimal("100.00")
        by_product = {}
        for line in order.items.all():
            by_product[line.product_id] = by_product.get(line.product_id, Decimal("0")) + line.quantity
        for pid, reserved in by_product.items():
            ProductStock.objects.update_or_create(
                company_id=order.company_id,
                product_id=pid,
                warehouse=warehouse,
                defaults={
                    "quantity_available": pool - reserved,
                    "quantity_reserved": reserved,
                    "quantity_total": pool,
                },
            )

    def _confirmed_order_with_line(self, qty_delivered=Decimal("0.00")):
        o = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 5, 1),
            delivery_date=date(2026, 5, 15),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=o,
            product=self.product,
            quantity=Decimal("4.00"),
            quantity_delivered=qty_delivered,
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            discount_percent=Decimal("0.00"),
        )
        self._reserve_stock_for_order(o, self.wh)
        return o

    def _confirmed_order_two_lines_same_product(self):
        o = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 5, 1),
            delivery_date=date(2026, 5, 15),
            status=Order.STATUS_CONFIRMED,
        )
        for qty in (Decimal("2.00"), Decimal("3.00")):
            OrderItem.objects.create(
                order=o,
                product=self.product,
                quantity=qty,
                unit_price_net=Decimal("10.00"),
                unit_price_gross=Decimal("12.30"),
                vat_rate=Decimal("23.00"),
                discount_percent=Decimal("0.00"),
            )
        self._reserve_stock_for_order(o, self.wh)
        return o

    def _confirmed_order_two_products(self, qty_a=Decimal("2.00"), qty_b=Decimal("3.00")):
        o = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 5, 1),
            delivery_date=date(2026, 5, 15),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=o,
            product=self.product,
            quantity=qty_a,
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            discount_percent=Decimal("0.00"),
        )
        OrderItem.objects.create(
            order=o,
            product=self.product_b,
            quantity=qty_b,
            unit_price_net=Decimal("5.00"),
            unit_price_gross=Decimal("6.00"),
            vat_rate=Decimal("23.00"),
            discount_percent=Decimal("0.00"),
        )
        self._reserve_stock_for_order(o, self.wh)
        return o

    def test_filter_by_order_status_issue_date_and_type(self):
        self.client.force_authenticate(user=self.user)
        d1 = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 6, 1),
            status=DeliveryDocument.STATUS_DRAFT,
        )
        DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_MM,
            issue_date=date(2026, 1, 1),
            status=DeliveryDocument.STATUS_SAVED,
        )
        r = self.client.get(
            reverse("delivery-document-list"),
            {
                "order": str(self.order.id),
                "status": DeliveryDocument.STATUS_DRAFT,
                "document_type": DeliveryDocument.DOC_TYPE_WZ,
                "issue_date_after": "2026-05-01",
                "issue_date_before": "2026-06-30",
            },
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in r.data["results"]}
        self.assertEqual(ids, {str(d1.id)})

    def test_post_save_and_start_delivery_transitions(self):
        self.client.force_authenticate(user=self.user)
        d = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
            status=DeliveryDocument.STATUS_DRAFT,
        )
        r1 = self.client.post(self._url_save(d.id))
        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        self.assertEqual(r1.data["status"], DeliveryDocument.STATUS_SAVED)
        r2 = self.client.post(self._url_start_delivery(d.id))
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertEqual(r2.data["status"], DeliveryDocument.STATUS_IN_TRANSIT)

    def test_post_save_wrong_status_returns_400(self):
        self.client.force_authenticate(user=self.user)
        d = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
            status=DeliveryDocument.STATUS_SAVED,
        )
        r = self.client.post(self._url_save(d.id))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_get_generate_for_order_creates_wz_with_lines(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        r = self.client.get(self._url_generate(o.id))
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["document_type"], DeliveryDocument.DOC_TYPE_WZ)
        self.assertEqual(r.data["status"], DeliveryDocument.STATUS_DRAFT)
        self.assertEqual(str(r.data["from_warehouse_id"]), str(self.wh.id))
        self.assertEqual(len(r.data["items"]), 1)
        self.assertEqual(r.data["items"][0]["quantity_planned"], "4.00")
        doc = DeliveryDocument.objects.get(id=r.data["id"])
        self.assertEqual(doc.order_id, o.id)
        self.assertEqual(doc.to_customer_id, o.customer_id)

    def test_generate_for_order_requires_confirmed(self):
        self.client.force_authenticate(user=self.user)
        self.order.status = Order.STATUS_DRAFT
        self.order.save(update_fields=["status"])
        OrderItem.objects.create(
            order=self.order,
            product=self.product,
            quantity=Decimal("2.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        r = self.client.get(self._url_generate(self.order.id))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_for_order_uses_remaining_quantity(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line(qty_delivered=Decimal("1.50"))
        r = self.client.get(self._url_generate(o.id))
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["items"][0]["quantity_planned"], "2.50")

    def test_post_complete_updates_lines_and_order(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        self.assertEqual(gen.status_code, status.HTTP_201_CREATED)
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "3.00",
                        "quantity_returned": "1.00",
                        "return_reason": "Damaged",
                    }
                ],
                "receiver_name": "Client",
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], DeliveryDocument.STATUS_DELIVERED)
        self.assertTrue(r.data["has_returns"])
        item = DeliveryItem.objects.get(pk=line_id)
        self.assertEqual(item.quantity_actual, Decimal("3.00"))
        self.assertEqual(item.quantity_returned, Decimal("1.00"))
        oi = OrderItem.objects.get(order=o)
        self.assertEqual(oi.quantity_delivered, Decimal("2.00"))
        self.assertEqual(oi.quantity_returned, Decimal("1.00"))
        o.refresh_from_db()
        self.assertEqual(
            o.status,
            Order.STATUS_CONFIRMED,
            "Partial delivery must not mark the order as delivered.",
        )
        stock = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock.quantity_reserved, Decimal("1.00"))
        self.assertEqual(stock.quantity_available, Decimal("97.00"))
        self.assertEqual(stock.quantity_total, Decimal("98.00"))
        movements = StockMovement.objects.filter(reference_id=r.data["id"]).order_by(
            "movement_type"
        )
        self.assertEqual(movements.count(), 2)
        sale = movements.filter(movement_type=StockMovement.MovementType.SALE).get()
        self.assertEqual(sale.quantity, Decimal("-3"))
        self.assertEqual(sale.reference_type, "delivery")
        ret_m = movements.filter(movement_type=StockMovement.MovementType.RETURN).get()
        self.assertEqual(ret_m.quantity, Decimal("1"))
        self.assertEqual(ret_m.reference_type, "delivery")

    def test_post_complete_marks_order_delivered_when_fully_delivered(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        self.assertEqual(gen.status_code, status.HTTP_201_CREATED, gen.data)
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "4.00",
                        "quantity_returned": "0",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        o.refresh_from_db()
        self.assertEqual(o.status, Order.STATUS_DELIVERED)

    def test_post_start_delivery_wrong_status_returns_400(self):
        self.client.force_authenticate(user=self.user)
        d = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
            status=DeliveryDocument.STATUS_DRAFT,
        )
        r = self.client.post(self._url_start_delivery(d.id))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_complete_wrong_status_returns_400(self):
        self.client.force_authenticate(user=self.user)
        d = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 1),
            status=DeliveryDocument.STATUS_DRAFT,
        )
        r = self.client.post(self._url_complete(d.id), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_complete_twice_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        self.client.post(
            self._url_complete(doc_id),
            data={"items": [{"id": line_id, "quantity_actual": "2.00", "quantity_returned": "0"}]},
            format="json",
        )
        r2 = self.client.post(self._url_complete(doc_id), data={}, format="json")
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_complete_unknown_item_id_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={"items": [{"id": str(uuid.uuid4()), "quantity_actual": "1.00"}]},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", r.data)

    def test_post_complete_returns_exceed_actual_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {"id": line_id, "quantity_actual": "2.00", "quantity_returned": "3.00"}
                ]
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_complete_exceeds_ordered_quantity_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [{"id": line_id, "quantity_actual": "5.00", "quantity_returned": "0"}]
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_complete_insufficient_reserved_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        ProductStock.objects.filter(
            product=self.product, warehouse=self.wh
        ).update(quantity_reserved=Decimal("1.00"), quantity_available=Decimal("99.00"))
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "4.00",
                        "quantity_returned": "0",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("stock", r.data)
        doc = DeliveryDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DeliveryDocument.STATUS_IN_TRANSIT)

    def test_post_complete_sale_only_one_sale_movement_and_stock(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "4.00",
                        "quantity_returned": "0",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        stock = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock.quantity_reserved, Decimal("0"))
        self.assertEqual(stock.quantity_available, Decimal("96.00"))
        self.assertEqual(stock.quantity_total, Decimal("96.00"))
        mov = StockMovement.objects.filter(reference_id=r.data["id"])
        self.assertEqual(mov.count(), 1)
        m = mov.get()
        self.assertEqual(m.movement_type, StockMovement.MovementType.SALE)
        self.assertEqual(m.quantity, Decimal("-4"))
        self.assertEqual(m.quantity_before, Decimal("96"))
        self.assertEqual(m.quantity_after, Decimal("96"))

    def test_post_complete_missing_productstock_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        ProductStock.objects.filter(
            product=self.product, warehouse=self.wh
        ).delete()
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "2.00",
                        "quantity_returned": "0",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("stock", r.data)
        doc = DeliveryDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DeliveryDocument.STATUS_IN_TRANSIT)

    def test_post_complete_without_from_warehouse_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        DeliveryDocument.objects.filter(pk=doc_id).update(from_warehouse=None)
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_id,
                        "quantity_actual": "1.00",
                        "quantity_returned": "0",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("from_warehouse", r.data)
        doc = DeliveryDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DeliveryDocument.STATUS_IN_TRANSIT)

    def test_post_complete_two_lines_same_product_two_sale_movements(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_two_lines_same_product()
        gen = self.client.get(self._url_generate(o.id))
        self.assertEqual(gen.status_code, status.HTTP_201_CREATED, gen.data)
        self.assertEqual(len(gen.data["items"]), 2)
        doc_id = gen.data["id"]
        ids = [row["id"] for row in gen.data["items"]]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {"id": ids[0], "quantity_actual": "2.00", "quantity_returned": "0"},
                    {"id": ids[1], "quantity_actual": "3.00", "quantity_returned": "0"},
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        stock = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock.quantity_reserved, Decimal("0"))
        self.assertEqual(stock.quantity_total, Decimal("95.00"))
        sales = StockMovement.objects.filter(
            reference_id=r.data["id"],
            movement_type=StockMovement.MovementType.SALE,
        )
        self.assertEqual(sales.count(), 2)
        self.assertEqual(
            {m.quantity for m in sales},
            {Decimal("-2"), Decimal("-3")},
        )

    def test_post_complete_two_distinct_products_updates_both_stocks(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_two_products()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_by_product = {
            str(row["product_id"]): row["id"] for row in gen.data["items"]
        }
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_by_product[str(self.product.id)],
                        "quantity_actual": "2.00",
                        "quantity_returned": "0",
                    },
                    {
                        "id": line_by_product[str(self.product_b.id)],
                        "quantity_actual": "3.00",
                        "quantity_returned": "0",
                    },
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        sa = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        sb = ProductStock.objects.get(product=self.product_b, warehouse=self.wh)
        self.assertEqual(sa.quantity_reserved, Decimal("0"))
        self.assertEqual(sa.quantity_total, Decimal("98.00"))
        self.assertEqual(sb.quantity_reserved, Decimal("0"))
        self.assertEqual(sb.quantity_total, Decimal("97.00"))
        self.assertEqual(
            StockMovement.objects.filter(
                reference_id=r.data["id"],
                movement_type=StockMovement.MovementType.SALE,
            ).count(),
            2,
        )

    def test_post_complete_two_products_one_short_rolls_back_all(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_two_products(Decimal("2.00"), Decimal("3.00"))
        ProductStock.objects.filter(product=self.product_b, warehouse=self.wh).update(
            quantity_reserved=Decimal("1.00"),
            quantity_available=Decimal("99.00"),
        )
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_by_product = {
            str(row["product_id"]): row["id"] for row in gen.data["items"]
        }
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {
                        "id": line_by_product[str(self.product.id)],
                        "quantity_actual": "2.00",
                        "quantity_returned": "0",
                    },
                    {
                        "id": line_by_product[str(self.product_b.id)],
                        "quantity_actual": "3.00",
                        "quantity_returned": "0",
                    },
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("stock", r.data)
        doc = DeliveryDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DeliveryDocument.STATUS_IN_TRANSIT)
        sa = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        sb = ProductStock.objects.get(product=self.product_b, warehouse=self.wh)
        self.assertEqual(sa.quantity_reserved, Decimal("2.00"))
        self.assertEqual(sb.quantity_reserved, Decimal("1.00"))
        self.assertFalse(
            StockMovement.objects.filter(reference_id=doc_id).exists()
        )

    def test_post_complete_second_wz_consumes_remaining_reserved(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen1 = self.client.get(self._url_generate(o.id))
        d1 = gen1.data["id"]
        l1 = gen1.data["items"][0]["id"]
        self.client.post(self._url_save(d1))
        self.client.post(self._url_start_delivery(d1))
        r1 = self.client.post(
            self._url_complete(d1),
            data={"items": [{"id": l1, "quantity_actual": "2.00", "quantity_returned": "0"}]},
            format="json",
        )
        self.assertEqual(r1.status_code, status.HTTP_200_OK, r1.data)
        stock_mid = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock_mid.quantity_reserved, Decimal("2.00"))
        gen2 = self.client.get(self._url_generate(o.id))
        self.assertEqual(gen2.status_code, status.HTTP_201_CREATED, gen2.data)
        d2 = gen2.data["id"]
        l2 = gen2.data["items"][0]["id"]
        self.client.post(self._url_save(d2))
        self.client.post(self._url_start_delivery(d2))
        r2 = self.client.post(
            self._url_complete(d2),
            data={"items": [{"id": l2, "quantity_actual": "2.00", "quantity_returned": "0"}]},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        stock_final = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock_final.quantity_reserved, Decimal("0"))
        self.assertEqual(stock_final.quantity_total, Decimal("96.00"))

    def test_post_complete_two_lines_same_product_insufficient_reserved_aggregate(
        self,
    ):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_two_lines_same_product()
        ProductStock.objects.filter(product=self.product, warehouse=self.wh).update(
            quantity_reserved=Decimal("2.00"),
            quantity_available=Decimal("98.00"),
        )
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        ids = [row["id"] for row in gen.data["items"]]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(
            self._url_complete(doc_id),
            data={
                "items": [
                    {"id": ids[0], "quantity_actual": "2.00", "quantity_returned": "0"},
                    {"id": ids[1], "quantity_actual": "3.00", "quantity_returned": "0"},
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("stock", r.data)
        self.assertEqual(
            DeliveryDocument.objects.get(pk=doc_id).status,
            DeliveryDocument.STATUS_IN_TRANSIT,
        )

    def test_post_complete_empty_items_uses_planned_quantities_for_stock(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        self.client.post(self._url_save(doc_id))
        self.client.post(self._url_start_delivery(doc_id))
        r = self.client.post(self._url_complete(doc_id), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        stock = ProductStock.objects.get(product=self.product, warehouse=self.wh)
        self.assertEqual(stock.quantity_reserved, Decimal("0"))
        self.assertEqual(stock.quantity_total, Decimal("96.00"))
        self.assertEqual(
            StockMovement.objects.filter(
                reference_id=r.data["id"],
                movement_type=StockMovement.MovementType.SALE,
            ).count(),
            1,
        )

    def test_generate_no_remaining_quantity_returns_400(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line(qty_delivered=Decimal("4.00"))
        r = self.client.get(self._url_generate(o.id))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_for_foreign_order_returns_404(self):
        self.client.force_authenticate(user=self.user)
        other_co = Company.objects.create(name="OutsiderCo")
        foreign_c = Customer.objects.create(name="Ext", company=other_co)
        foreign_p = Product.objects.create(
            name="Foreign SKU",
            company=other_co,
            price_net=Decimal("1.00"),
            price_gross=Decimal("1.00"),
        )
        foreign_o = Order.objects.create(
            user=self.user,
            customer=foreign_c,
            company=other_co,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 2, 1),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=foreign_o,
            product=foreign_p,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        r = self.client.get(self._url_generate(foreign_o.id))
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_includes_nested_items(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        r = self.client.get(
            reverse("delivery-document-detail", kwargs={"pk": str(doc_id)})
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data["items"]), 1)
        self.assertIn("quantity_planned", r.data["items"][0])
        self.assertEqual(r.data["order_number"], o.order_number)
        self.assertEqual(r.data["customer_name"], self.customer.name)

    def test_delete_document_allowed_and_removes_items(self):
        self.client.force_authenticate(user=self.user)
        o = self._confirmed_order_with_line()
        gen = self.client.get(self._url_generate(o.id))
        doc_id = gen.data["id"]
        line_id = gen.data["items"][0]["id"]
        r = self.client.delete(
            reverse("delivery-document-detail", kwargs={"pk": str(doc_id)})
        )
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(DeliveryItem.objects.filter(pk=line_id).exists())


class GenerateDeliveryFromOrderTests(TestCase):
    """``generate_delivery_from_order()`` — WZ from confirmed order (full line quantities)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="gen-from-order-user",
            email="gen-from-order@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Gen Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.company,
            role="admin",
            is_active=True,
        )
        self.customer = Customer.objects.create(name="Buyer", company=self.company)
        self.p1 = Product.objects.create(
            name="A",
            company=self.company,
            price_net=Decimal("1.00"),
            price_gross=Decimal("1.00"),
        )
        self.p2 = Product.objects.create(
            name="B",
            company=self.company,
            price_net=Decimal("2.00"),
            price_gross=Decimal("2.00"),
        )

    def test_creates_wz_linked_to_order_and_sets_user(self):
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=order,
            product=self.p1,
            quantity=Decimal("4.00"),
            quantity_delivered=Decimal("1.50"),
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
            discount_percent=Decimal("0.00"),
        )
        doc = generate_delivery_from_order(order, user=self.user)
        self.assertIsInstance(doc, DeliveryDocument)
        self.assertEqual(doc.document_type, DeliveryDocument.DOC_TYPE_WZ)
        self.assertEqual(doc.status, DeliveryDocument.STATUS_DRAFT)
        self.assertEqual(doc.order_id, order.id)
        self.assertEqual(doc.company_id, order.company_id)
        self.assertEqual(doc.user_id, self.user.id)
        self.assertEqual(doc.to_customer_id, order.customer_id)
        self.assertTrue(doc.document_number.startswith("WZ/"))
        line = doc.items.get()
        self.assertEqual(line.quantity_planned, Decimal("4.00"))
        self.assertEqual(line.order_item.product_id, self.p1.id)

    def test_one_delivery_item_per_order_item_full_quantity(self):
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=order,
            product=self.p1,
            quantity=Decimal("2.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        OrderItem.objects.create(
            order=order,
            product=self.p2,
            quantity=Decimal("3.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        doc = generate_delivery_from_order(order)
        self.assertEqual(doc.items.count(), 2)
        planned = sorted(doc.items.values_list("quantity_planned", flat=True))
        self.assertEqual(planned, [Decimal("2.00"), Decimal("3.00")])

    def test_requires_confirmed_order(self):
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_DRAFT,
        )
        OrderItem.objects.create(
            order=order,
            product=self.p1,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        with self.assertRaises(ValueError):
            generate_delivery_from_order(order)

    def test_sets_from_warehouse_when_main_warehouse_exists(self):
        wh = Warehouse.objects.create(
            user=self.user,
            company=self.company,
            code="MG",
            name="Main",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=order,
            product=self.p1,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        doc = generate_delivery_from_order(order)
        self.assertEqual(doc.from_warehouse_id, wh.id)

    def test_from_warehouse_none_when_no_main_warehouse(self):
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(
            order=order,
            product=self.p1,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("1.00"),
            unit_price_gross=Decimal("1.00"),
            vat_rate=Decimal("0.00"),
            discount_percent=Decimal("0.00"),
        )
        doc = generate_delivery_from_order(order)
        self.assertIsNone(doc.from_warehouse_id)

    def test_empty_order_creates_document_without_items(self):
        order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 7, 1),
            delivery_date=date(2026, 7, 10),
            status=Order.STATUS_CONFIRMED,
        )
        doc = generate_delivery_from_order(order)
        self.assertEqual(doc.items.count(), 0)
