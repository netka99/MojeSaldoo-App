import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument
from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.services import (
    build_invoice_preview_data,
    generate_invoice_from_order,
    recalculate_invoice_totals,
)
from apps.orders.models import Order, OrderItem
from apps.products.models import Product
from apps.users.models import Company, CompanyMembership


class InvoiceModelTests(TestCase):
    """Invoice numbering, defaults, uniqueness, and FK protection."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="invoice-model-user",
            email="invoice-model@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Inv Co A")
        self.company_b = Company.objects.create(name="Inv Co B")
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
            status=Order.STATUS_DELIVERED,
        )
        self.order_b = Order.objects.create(
            user=self.user,
            customer=self.customer_b,
            company=self.company_b,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )

    def _make_invoice(self, company=None, order=None, customer=None, **kwargs):
        co = company or self.company
        ord_ = order or self.order
        cust = customer or (ord_.customer if ord_ else self.customer)
        return Invoice.objects.create(
            company=co,
            user=self.user,
            order=ord_,
            customer=cust,
            issue_date=kwargs.pop("issue_date", date(2026, 4, 1)),
            sale_date=kwargs.pop("sale_date", date(2026, 4, 1)),
            due_date=kwargs.pop("due_date", date(2026, 4, 30)),
            **kwargs,
        )

    def test_new_invoice_receives_sequential_number_per_company(self):
        i1 = self._make_invoice()
        i2 = self._make_invoice()
        self.assertEqual(i1.invoice_number, "FV/2026/0001")
        self.assertEqual(i2.invoice_number, "FV/2026/0002")

    def test_different_companies_may_reuse_number_pattern(self):
        a = self._make_invoice()
        b = self._make_invoice(
            company=self.company_b,
            order=self.order_b,
            customer=self.customer_b,
        )
        self.assertEqual(a.invoice_number, "FV/2026/0001")
        self.assertEqual(b.invoice_number, "FV/2026/0001")

    def test_year_is_taken_from_issue_date(self):
        inv = self._make_invoice(issue_date=date(2025, 6, 15), sale_date=date(2025, 6, 15))
        self.assertEqual(inv.invoice_number, "FV/2025/0001")

    def test_explicit_invoice_number_is_not_replaced(self):
        inv = self._make_invoice(invoice_number="MANUAL-FV-1")
        self.assertEqual(inv.invoice_number, "MANUAL-FV-1")

    def test_duplicate_invoice_number_per_company_fails(self):
        first = self._make_invoice()
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(
                company=self.company,
                user=self.user,
                order=self.order,
                customer=self.customer,
                issue_date=date(2026, 4, 1),
                sale_date=date(2026, 4, 1),
                due_date=date(2026, 4, 30),
                invoice_number=first.invoice_number,
            )

    def test_id_is_uuid(self):
        inv = self._make_invoice()
        self.assertEqual(len(str(inv.id)), 36)

    def test_defaults_status_ksef_and_payment(self):
        inv = self._make_invoice()
        self.assertEqual(inv.status, "draft")
        self.assertEqual(inv.ksef_status, "not_sent")
        self.assertEqual(inv.payment_method, "transfer")

    def test_deleting_order_referenced_by_invoice_raises_protected(self):
        inv = self._make_invoice()
        with self.assertRaises(ProtectedError):
            inv.order.delete()

    def test_optional_delivery_document(self):
        doc = DeliveryDocument.objects.create(
            company=self.company,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 12),
        )
        inv = self._make_invoice(delivery_document=doc)
        self.assertEqual(inv.delivery_document_id, doc.id)


class InvoiceApiTests(TestCase):
    """Routing and authentication (no tenant setup required)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="invoice-api-user",
            email="invoice-api@test.com",
            password="test12345",
        )

    def test_invoice_list_url_resolves(self):
        self.assertEqual(reverse("invoice-list"), "/api/invoices/")

    def test_invoice_list_requires_authentication(self):
        response = self.client.get(reverse("invoice-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invoice_list_forbidden_without_current_company(self):
        co = Company.objects.create(name="Member Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=co,
            role="viewer",
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("invoice-list"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invoice_list_authenticated_with_company_returns_results(self):
        co = Company.objects.create(name="API Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=co,
            role="viewer",
            is_active=True,
        )
        self.user.current_company = co
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("invoice-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)

    def test_invoice_preview_requires_authentication(self):
        r = self.client.get(
            reverse("invoice-preview", kwargs={"pk": str(uuid.uuid4())}),
        )
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)


class InvoiceViewSetAPITests(TestCase):
    """Create and list with company scope (current_company set)."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="invoice-vs-user",
            email="invoice-vs@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Invoice API Co")
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
            status=Order.STATUS_DELIVERED,
        )

    def test_list_shows_only_current_company_invoices(self):
        other_co = Company.objects.create(name="Other invoice co")
        other_customer = Customer.objects.create(name="OC", company=other_co)
        other_order = Order.objects.create(
            user=self.user,
            customer=other_customer,
            company=other_co,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 2, 1),
            status=Order.STATUS_DELIVERED,
        )
        mine = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 24),
        )
        Invoice.objects.create(
            company=other_co,
            user=self.user,
            order=other_order,
            customer=other_customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 24),
        )
        self.client.force_authenticate(user=self.user)
        r = self.client.get(reverse("invoice-list"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(r.data["results"][0]["id"], str(mine.id))

    def test_create_sets_invoice_number_company_user_and_customer_from_order(self):
        self.client.force_authenticate(user=self.user)
        body = {
            "order_id": str(self.order.id),
            "issue_date": "2026-04-18",
            "sale_date": "2026-04-18",
            "due_date": "2026-05-02",
            "total_gross": "123.45",
            "subtotal_net": "100.00",
            "subtotal_gross": "123.45",
            "vat_amount": "23.45",
        }
        r = self.client.post(reverse("invoice-list"), data=body, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["invoice_number"], "FV/2026/0001")
        self.assertEqual(r.data["status"], "draft")
        self.assertEqual(str(r.data["company"]), str(self.co.id))
        self.assertEqual(str(r.data["user"]), str(self.user.id))
        self.assertEqual(str(r.data["order"]["id"]), str(self.order.id))
        row = Invoice.objects.get(id=r.data["id"])
        self.assertEqual(row.customer_id, self.customer.id)
        self.assertEqual(row.company_id, self.co.id)

    def test_create_with_explicit_customer_id(self):
        second_customer = Customer.objects.create(name="Alt buyer", company=self.co)
        self.client.force_authenticate(user=self.user)
        body = {
            "order_id": str(self.order.id),
            "customer_id": str(second_customer.id),
            "issue_date": "2026-04-20",
            "sale_date": "2026-04-20",
            "due_date": "2026-05-04",
        }
        r = self.client.post(reverse("invoice-list"), data=body, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        row = Invoice.objects.get(id=r.data["id"])
        self.assertEqual(row.customer_id, second_customer.id)


class InvoiceActionsAPITests(TestCase):
    """generate-from-order, issue, mark-paid, preview, locked edits."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="invoice-act-user",
            email="invoice-act@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Action Co")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.customer = Customer.objects.create(
            name="Buyer",
            company=self.co,
            payment_terms=7,
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.product = Product.objects.create(
            name="SKU-1",
            company=self.co,
            unit="szt.",
            price_net=Decimal("100.00"),
            price_gross=Decimal("123.00"),
            vat_rate=Decimal("23.00"),
        )
        OrderItem.objects.create(
            order=self.order,
            product=self.product,
            quantity=Decimal("2.00"),
            quantity_delivered=Decimal("2.00"),
            unit_price_net=Decimal("100.00"),
            unit_price_gross=Decimal("123.00"),
            vat_rate=Decimal("23.00"),
        )
        self.client.force_authenticate(user=self.user)

    def _gen_url(self):
        return reverse(
            "invoice-generate-from-order",
            kwargs={"order_id": str(self.order.id)},
        )

    def test_generate_from_order_creates_draft_with_lines_and_totals(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_DRAFT)
        self.assertEqual(len(r.data["items"]), 1)
        inv = Invoice.objects.get(id=r.data["id"])
        self.assertEqual(inv.subtotal_net, Decimal("200.00"))
        self.assertEqual(inv.vat_amount, Decimal("46.00"))
        self.assertEqual(inv.total_gross, Decimal("246.00"))
        self.assertEqual(inv.customer_id, self.customer.id)

    def test_generate_fails_when_order_draft(self):
        self.order.status = Order.STATUS_DRAFT
        self.order.save(update_fields=["status"])
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_succeeds_when_order_confirmed(self):
        self.order.status = Order.STATUS_CONFIRMED
        self.order.save(update_fields=["status"])
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(len(r.data["items"]), 1)

    def test_generate_succeeds_when_order_invoiced(self):
        self.order.status = Order.STATUS_INVOICED
        self.order.save(update_fields=["status"])
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(len(r.data["items"]), 1)

    def test_generate_due_date_uses_customer_payment_terms(self):
        self.assertEqual(self.customer.payment_terms, 7)
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        inv = Invoice.objects.get(id=r.data["id"])
        self.assertEqual(
            inv.due_date - inv.issue_date,
            timedelta(days=7),
        )

    def test_generate_accepts_explicit_dates_and_payment_method(self):
        body = {
            "issue_date": "2026-04-15",
            "sale_date": "2026-04-12",
            "due_date": "2026-05-01",
            "payment_method": "cash",
        }
        r = self.client.post(self._gen_url(), data=body, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        inv = Invoice.objects.get(id=r.data["id"])
        self.assertEqual(inv.issue_date, date(2026, 4, 15))
        self.assertEqual(inv.sale_date, date(2026, 4, 12))
        self.assertEqual(inv.due_date, date(2026, 5, 1))
        self.assertEqual(inv.payment_method, "cash")

    def test_generate_rejects_invalid_payment_method(self):
        r = self.client.post(
            self._gen_url(),
            data={"payment_method": "bitcoin"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_rejects_malformed_issue_date(self):
        r = self.client.post(
            self._gen_url(),
            data={"issue_date": "not-a-date"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_generate_404_when_order_other_company(self):
        other = Company.objects.create(name="X")
        oc = Customer.objects.create(name="OC", company=other)
        foreign = Order.objects.create(
            user=self.user,
            customer=oc,
            company=other,
            order_date=date(2026, 1, 1),
            delivery_date=date(2026, 2, 1),
            status=Order.STATUS_DELIVERED,
        )
        url = reverse(
            "invoice-generate-from-order",
            kwargs={"order_id": str(foreign.id)},
        )
        r = self.client.post(url, data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_generate_links_latest_delivered_wz_when_present(self):
        DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 11),
            status=DeliveryDocument.STATUS_DELIVERED,
            document_number="WZ/2026/0099",
        )
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        inv = Invoice.objects.get(id=r.data["id"])
        self.assertIsNotNone(inv.delivery_document_id)
        self.assertEqual(inv.delivery_document.document_number, "WZ/2026/0099")

    def test_issue_transitions_draft_to_issued(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        self.assertEqual(r2.data["status"], Invoice.STATUS_ISSUED)
        row = Invoice.objects.get(id=inv_id)
        self.assertEqual(row.status, Invoice.STATUS_ISSUED)

    def test_issue_fails_when_not_draft(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mark_paid_from_issued(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        r3 = self.client.post(
            reverse("invoice-mark-paid", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r3.status_code, status.HTTP_200_OK, r3.data)
        self.assertEqual(r3.data["status"], Invoice.STATUS_PAID)
        row = Invoice.objects.get(id=inv_id)
        self.assertIsNotNone(row.paid_at)

    def test_mark_paid_fails_from_draft(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.post(
            reverse("invoice-mark-paid", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mark_paid_allowed_from_sent(self):
        inv = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 24),
            status=Invoice.STATUS_SENT,
        )
        r = self.client.post(
            reverse("invoice-mark-paid", kwargs={"pk": str(inv.id)}),
            data={},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_PAID)

    def test_preview_returns_html_ready_payload(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.get(reverse("invoice-preview", kwargs={"pk": inv_id}))
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertIn("seller", r2.data)
        self.assertIn("buyer", r2.data)
        self.assertIn("invoice", r2.data)
        self.assertIn("totals", r2.data)
        self.assertIn("lines", r2.data)
        self.assertEqual(len(r2.data["lines"]), 1)
        self.assertEqual(r2.data["totals"]["total_gross"], "246.00")
        # Print/PDF-oriented blocks
        self.assertIn("company", r2.data)
        self.assertIn("customer", r2.data)
        self.assertIn("items", r2.data)
        self.assertEqual(len(r2.data["items"]), 1)
        self.assertIn("byVatRate", r2.data["totals"])
        self.assertEqual(len(r2.data["totals"]["byVatRate"]), 1)
        inv_block = r2.data["invoice"]
        self.assertIn("ksef_status", inv_block)
        self.assertIn("subtotal_net", inv_block)
        self.assertEqual(r2.data["items"][0]["unit"], r2.data["lines"][0]["product_unit"])

    def test_preview_returns_404_for_invoice_other_company(self):
        other_co = Company.objects.create(name="Other Preview Co")
        oc = Customer.objects.create(name="OC", company=other_co)
        other_order = Order.objects.create(
            user=self.user,
            customer=oc,
            company=other_co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        foreign_inv = Invoice.objects.create(
            company=other_co,
            user=self.user,
            order=other_order,
            customer=oc,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 24),
        )
        r = self.client.get(
            reverse("invoice-preview", kwargs={"pk": str(foreign_inv.id)}),
        )
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_patch_issued_invoice_rejected(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.patch(
            reverse("invoice-detail", kwargs={"pk": inv_id}),
            data={"notes": "x"},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_issued_invoice_rejected(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"pk": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.delete(reverse("invoice-detail", kwargs={"pk": inv_id}))
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_query_filters_status_customer_issue_date_ksef(self):
        inv_draft = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 10),
            sale_date=date(2026, 4, 10),
            due_date=date(2026, 4, 17),
            status=Invoice.STATUS_DRAFT,
            ksef_status="not_sent",
        )
        other_c = Customer.objects.create(name="Other buyer", company=self.co)
        other_order = Order.objects.create(
            user=self.user,
            customer=other_c,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        inv_issued = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=other_order,
            customer=other_c,
            issue_date=date(2026, 5, 1),
            sale_date=date(2026, 5, 1),
            due_date=date(2026, 5, 15),
            status=Invoice.STATUS_ISSUED,
            ksef_status="pending",
        )
        r = self.client.get(reverse("invoice-list"), {"status": Invoice.STATUS_DRAFT})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(str(inv_draft.id), ids)
        self.assertNotIn(str(inv_issued.id), ids)

        r2 = self.client.get(reverse("invoice-list"), {"customer": str(other_c.id)})
        ids2 = {row["id"] for row in r2.data["results"]}
        self.assertNotIn(str(inv_draft.id), ids2)
        self.assertIn(str(inv_issued.id), ids2)

        r3 = self.client.get(
            reverse("invoice-list"),
            {"issue_date_after": "2026-04-15", "issue_date_before": "2026-05-15"},
        )
        ids3 = {row["id"] for row in r3.data["results"]}
        self.assertNotIn(str(inv_draft.id), ids3)
        self.assertIn(str(inv_issued.id), ids3)

        r4 = self.client.get(reverse("invoice-list"), {"ksef_status": "pending"})
        ids4 = {row["id"] for row in r4.data["results"]}
        self.assertIn(str(inv_issued.id), ids4)


class BuildInvoicePreviewDataTests(TestCase):
    """Unit tests for `build_invoice_preview_data` (print/PDF payload)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="preview-build-user",
            email="preview-build@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(
            name="Seller Sp. z o.o.",
            nip="1234567890",
            address="ul. Przykładowa 1",
            city="Warszawa",
            postal_code="00-001",
            phone="+48 123 456 789",
            email="biuro@seller.test",
        )
        self.customer = Customer.objects.create(
            name="Jan Kowalski",
            company_name="Buyer Firma SA",
            nip="0987654321",
            street="ul. Klienta 2",
            city="Kraków",
            postal_code="30-001",
            company=self.co,
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.invoice = Invoice.objects.create(
            company=self.co,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 18),
            sale_date=date(2026, 4, 17),
            due_date=date(2026, 5, 2),
            payment_method="transfer",
            subtotal_net=Decimal("150.00"),
            subtotal_gross=Decimal("169.50"),
            vat_amount=Decimal("19.50"),
            total_gross=Decimal("169.50"),
            notes="Test note",
            ksef_status="pending",
        )

    def test_company_block_matches_company_model(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="Line",
            product_unit="szt.",
            pkwiu="12.34.56",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("150.00"),
            vat_rate=Decimal("13.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        co = data["company"]
        self.assertEqual(co["name"], "Seller Sp. z o.o.")
        self.assertEqual(co["nip"], "1234567890")
        self.assertEqual(co["address"], "ul. Przykładowa 1")
        self.assertEqual(co["city"], "Warszawa")
        self.assertEqual(co["postal_code"], "00-001")
        self.assertEqual(co["phone"], "+48 123 456 789")
        self.assertEqual(co["email"], "biuro@seller.test")

    def test_customer_block_uses_company_name_and_street_as_address(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="X",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        cu = data["customer"]
        self.assertEqual(cu["name"], "Buyer Firma SA")
        self.assertEqual(cu["nip"], "0987654321")
        self.assertEqual(cu["address"], "ul. Klienta 2")
        self.assertEqual(cu["city"], "Kraków")
        self.assertEqual(cu["postal_code"], "30-001")

    def test_invoice_block_contains_all_model_fields_and_derived_keys(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="X",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        inv = data["invoice"]
        expected_model_keys = {
            "id",
            "company",
            "user",
            "order",
            "customer",
            "delivery_document",
            "invoice_number",
            "issue_date",
            "sale_date",
            "due_date",
            "payment_method",
            "subtotal_net",
            "subtotal_gross",
            "vat_amount",
            "total_gross",
            "ksef_reference_number",
            "ksef_number",
            "ksef_status",
            "ksef_sent_at",
            "ksef_error_message",
            "invoice_hash",
            "upo_received",
            "status",
            "paid_at",
            "notes",
            "created_at",
            "updated_at",
        }
        self.assertTrue(expected_model_keys.issubset(inv.keys()))
        self.assertIn("order_number", inv)
        self.assertIn("payment_method_label", inv)
        self.assertIn("delivery_document_number", inv)
        self.assertEqual(inv["company"], str(self.co.id))
        self.assertEqual(inv["order"], str(self.order.id))
        self.assertEqual(inv["customer"], str(self.customer.id))
        self.assertIsNone(inv["delivery_document"])
        self.assertEqual(inv["payment_method_label"], "Przelew")
        self.assertEqual(inv["ksef_status"], "pending")
        self.assertIsNone(inv["ksef_sent_at"])
        self.assertIsNone(inv["paid_at"])
        self.assertEqual(inv["notes"], "Test note")

    def test_items_align_with_lines_and_include_unit_and_pkwiu(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="Towar A",
            product_unit="kg",
            pkwiu="10.20.30",
            quantity=Decimal("2.50"),
            unit_price_net=Decimal("40.00"),
            vat_rate=Decimal("23.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(len(data["lines"]), 1)
        item = data["items"][0]
        line = data["lines"][0]
        self.assertEqual(item["product_name"], "Towar A")
        self.assertEqual(item["pkwiu"], "10.20.30")
        self.assertEqual(item["quantity"], "2.50")
        self.assertEqual(item["unit"], "kg")
        self.assertEqual(item["unit"], line["product_unit"])
        self.assertEqual(item["line_net"], line["line_net"])
        self.assertEqual(item["line_vat"], line["line_vat"])
        self.assertEqual(item["line_gross"], line["line_gross"])

    def test_totals_by_vat_rate_multiple_rates_sorted_ascending(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="A",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("100.00"),
            vat_rate=Decimal("23.00"),
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="B",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("50.00"),
            vat_rate=Decimal("8.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        self.assertEqual(data["totals"]["subtotal_net"], "150.00")
        self.assertEqual(data["totals"]["vat_amount"], "27.00")
        self.assertEqual(data["totals"]["total_gross"], "177.00")
        bvr = data["totals"]["byVatRate"]
        self.assertEqual(len(bvr), 2)
        self.assertEqual(bvr[0]["vat_rate"], "8.00")
        self.assertEqual(bvr[0]["net"], "50.00")
        self.assertEqual(bvr[0]["vat"], "4.00")
        self.assertEqual(bvr[0]["gross"], "54.00")
        self.assertEqual(bvr[1]["vat_rate"], "23.00")
        self.assertEqual(bvr[1]["net"], "100.00")
        self.assertEqual(bvr[1]["vat"], "23.00")
        self.assertEqual(bvr[1]["gross"], "123.00")

    def test_totals_by_vat_rate_empty_when_no_lines(self):
        data = build_invoice_preview_data(self.invoice)
        self.assertEqual(data["items"], [])
        self.assertEqual(data["lines"], [])
        self.assertEqual(data["totals"]["byVatRate"], [])

    def test_delivery_document_number_on_invoice_block_when_linked(self):
        doc = DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 12),
            document_number="WZ/2026/0007",
        )
        self.invoice.delivery_document = doc
        self.invoice.save(update_fields=["delivery_document", "updated_at"])
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="X",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        self.assertEqual(data["invoice"]["delivery_document"], str(doc.id))
        self.assertEqual(data["invoice"]["delivery_document_number"], "WZ/2026/0007")

    def test_seller_buyer_meta_present_for_legacy_layout(self):
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product_name="X",
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        recalculate_invoice_totals(self.invoice)
        self.invoice.save(
            update_fields=[
                "subtotal_net",
                "subtotal_gross",
                "vat_amount",
                "total_gross",
                "updated_at",
            ]
        )
        data = build_invoice_preview_data(self.invoice)
        self.assertIn("meta", data)
        self.assertEqual(data["meta"]["currency"], "PLN")
        self.assertIn("seller", data)
        self.assertIn("buyer", data)
        self.assertEqual(data["seller"]["name"], self.co.name)
        self.assertEqual(data["buyer"]["name"], "Buyer Firma SA")
        self.assertIsInstance(data["seller"]["address_lines"], list)
        self.assertIsInstance(data["buyer"]["address_lines"], list)


class InvoiceGenerateFromOrderServiceTests(TestCase):
    """Unit tests for generate_invoice_from_order() helper (TASK 4)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="gen-svc-user",
            email="gen-svc@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Gen Svc Co")
        self.customer = Customer.objects.create(
            name="Buyer",
            company=self.co,
            payment_terms=21,
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.product = Product.objects.create(
            name="Original name",
            company=self.co,
            unit="szt.",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
        )
        OrderItem.objects.create(
            order=self.order,
            product=self.product,
            quantity=Decimal("1.00"),
            quantity_delivered=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
        )

    def test_rejects_non_invoiceable_status(self):
        self.order.status = Order.STATUS_DRAFT
        self.order.save(update_fields=["status"])
        with self.assertRaises(DRFValidationError) as ctx:
            generate_invoice_from_order(
                order=self.order,
                company=self.co,
                user=self.user,
            )
        self.assertIn(
            "confirmed, delivered, or invoiced",
            str(ctx.exception.detail),
        )

    def test_accepts_confirmed_order_status(self):
        self.order.status = Order.STATUS_CONFIRMED
        self.order.save(update_fields=["status"])
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        self.assertEqual(inv.status, Invoice.STATUS_DRAFT)
        self.assertEqual(inv.items.count(), 1)

    def test_creates_invoice_items_and_totals(self):
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        self.assertEqual(inv.items.count(), 1)
        self.assertEqual(inv.subtotal_net, Decimal("10.00"))
        self.assertEqual(inv.vat_amount, Decimal("2.30"))
        self.assertEqual(inv.total_gross, Decimal("12.30"))

    def test_due_date_is_issue_date_plus_payment_terms(self):
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        self.assertEqual(inv.issue_date, timezone.localdate())
        self.assertEqual(
            inv.due_date,
            inv.issue_date + timedelta(days=21),
        )

    def test_line_uses_order_item_snapshot_after_product_rename(self):
        self.product.name = "Renamed product"
        self.product.save(update_fields=["name"])
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        line = inv.items.first()
        self.assertEqual(line.product_name, "Original name")


class InvoiceItemModelTests(TestCase):
    """Line snapshots, computed amounts, and invoice cascade."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="inv-item-user",
            email="inv-item@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Item Co")
        self.customer = Customer.objects.create(name="C", company=self.company)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.invoice = Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 4, 15),
            sale_date=date(2026, 4, 15),
            due_date=date(2026, 4, 29),
        )
        self.product = Product.objects.create(
            name="Widget",
            company=self.company,
            unit="szt.",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
        )
        self.order_item = OrderItem.objects.create(
            order=self.order,
            product=self.product,
            quantity=Decimal("2.00"),
            unit_price_net=Decimal("10.00"),
            unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
        )

    def _make_line(self, **kwargs):
        defaults = {
            "invoice": self.invoice,
            "quantity": Decimal("1.00"),
            "unit_price_net": Decimal("10.00"),
            "vat_rate": Decimal("23.00"),
        }
        defaults.update(kwargs)
        return InvoiceItem.objects.create(**defaults)

    def test_line_net_vat_gross_recomputed_on_save(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            quantity=Decimal("3.00"),
            unit_price_net=Decimal("100.00"),
            vat_rate=Decimal("23.00"),
        )
        self.assertEqual(line.line_net, Decimal("300.00"))
        self.assertEqual(line.line_vat, Decimal("69.00"))
        self.assertEqual(line.line_gross, Decimal("369.00"))

    def test_product_snapshot_on_save(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        self.assertEqual(line.product_name, "Widget")
        self.assertEqual(line.product_unit, "szt.")

    def test_order_item_fills_snapshot_when_product_name_empty(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("0.00"),
        )
        self.assertEqual(line.product_name, self.order_item.product_name)

    def test_deleting_invoice_removes_items(self):
        line = self._make_line(product=self.product)
        pk = line.id
        self.invoice.delete()
        self.assertFalse(InvoiceItem.objects.filter(pk=pk).exists())

    def test_vat_rate_zero_yields_zero_vat_and_gross_equals_net(self):
        line = self._make_line(
            product=self.product,
            quantity=Decimal("2.00"),
            unit_price_net=Decimal("50.00"),
            vat_rate=Decimal("0.00"),
        )
        self.assertEqual(line.line_net, Decimal("100.00"))
        self.assertEqual(line.line_vat, Decimal("0.00"))
        self.assertEqual(line.line_gross, Decimal("100.00"))

    def test_amounts_recomputed_when_line_updated(self):
        line = self._make_line(
            product=self.product,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("100.00"),
            vat_rate=Decimal("23.00"),
        )
        self.assertEqual(line.line_net, Decimal("100.00"))
        line.quantity = Decimal("2.00")
        line.save()
        line.refresh_from_db()
        self.assertEqual(line.line_net, Decimal("200.00"))
        self.assertEqual(line.line_vat, Decimal("46.00"))
        self.assertEqual(line.line_gross, Decimal("246.00"))

    def test_deleting_product_nullifies_product_fk_keeps_line(self):
        solo_product = Product.objects.create(
            name="Solo",
            company=self.company,
            unit="kg",
            price_net=Decimal("1.00"),
            price_gross=Decimal("1.23"),
            vat_rate=Decimal("23.00"),
        )
        line = self._make_line(
            product=solo_product,
            unit_price_net=Decimal("1.00"),
            vat_rate=Decimal("23.00"),
        )
        solo_product.delete()
        line.refresh_from_db()
        self.assertIsNone(line.product_id)
        self.assertEqual(line.product_name, "Solo")
        self.assertEqual(line.line_gross, Decimal("1.23"))

    def test_deleting_order_item_nullifies_order_item_fk_keeps_line(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("0.00"),
        )
        line_pk = line.id
        self.order_item.delete()
        line.refresh_from_db()
        self.assertIsNone(line.order_item_id)
        self.assertEqual(line.product_name, self.order_item.product_name)
        self.assertTrue(InvoiceItem.objects.filter(pk=line_pk).exists())

    def test_pkwiu_persists(self):
        line = self._make_line(
            product=self.product,
            pkwiu="10.12.13.14",
        )
        self.assertEqual(line.pkwiu, "10.12.13.14")
        line.refresh_from_db()
        self.assertEqual(line.pkwiu, "10.12.13.14")

    def test_product_snapshot_takes_precedence_over_order_item(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            product=self.product,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        self.assertEqual(line.product_name, "Widget")
        self.assertEqual(line.product_unit, "szt.")

    def test_explicit_product_name_not_overwritten_from_order_item(self):
        custom = "Custom line label"
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            product_name=custom,
            quantity=Decimal("1.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("0.00"),
        )
        self.assertEqual(line.product_name, custom)

    def test_id_is_uuid(self):
        line = self._make_line(product=self.product)
        self.assertEqual(len(str(line.id)), 36)

    def test_default_ordering_is_created_at_ascending(self):
        first = self._make_line(product=self.product, quantity=Decimal("1.00"))
        second = self._make_line(product=self.product, quantity=Decimal("2.00"))
        rows = list(InvoiceItem.objects.filter(invoice=self.invoice))
        self.assertEqual(rows[0].id, first.id)
        self.assertEqual(rows[1].id, second.id)

    def test_str_uses_quantity_and_product_name(self):
        line = self._make_line(product=self.product)
        self.assertIn("1.00", str(line))
        self.assertIn("Widget", str(line))

    def test_quantity_below_minimum_raises_on_full_clean(self):
        line = InvoiceItem(
            invoice=self.invoice,
            product=self.product,
            quantity=Decimal("0.00"),
            unit_price_net=Decimal("10.00"),
            vat_rate=Decimal("23.00"),
        )
        with self.assertRaises(DjangoValidationError):
            line.full_clean()

    def test_invoice_fk_required_at_database_level(self):
        with self.assertRaises(IntegrityError):
            InvoiceItem.objects.create(
                product=self.product,
                quantity=Decimal("1.00"),
                unit_price_net=Decimal("10.00"),
                vat_rate=Decimal("23.00"),
            )

    def test_line_amounts_rounded_to_two_decimal_places(self):
        line = self._make_line(
            product=self.product,
            quantity=Decimal("3.00"),
            unit_price_net=Decimal("10.33"),
            vat_rate=Decimal("23.00"),
        )
        self.assertEqual(line.line_net, Decimal("30.99"))
        self.assertEqual(line.line_vat, Decimal("7.13"))
        self.assertEqual(line.line_gross, Decimal("38.12"))
