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
from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.services import (
    billable_quantity,
    build_invoice_preview_data,
    generate_invoice_from_order,
    generate_invoice_from_orders,
    get_period_preview_from_orders,
    get_period_preview_from_wz,
    recalculate_invoice_totals,
)
from apps.orders.models import Order, OrderItem
from apps.products.models import Product
from apps.users.models import Company, CompanyMembership, CompanyModule


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

    def test_new_invoice_has_no_number_by_default(self):
        # Draft invoices created via save() no longer auto-assign a number.
        inv = self._make_invoice()
        self.assertIsNone(inv.invoice_number)

    def test_next_invoice_number_sequential_per_company(self):
        # _next_invoice_number classmethod produces sequential numbers.
        i1 = self._make_invoice(invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 4, 1)))
        order2 = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 2),
            delivery_date=date(2026, 4, 11),
            status=Order.STATUS_DELIVERED,
        )
        i2 = self._make_invoice(order=order2, invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 4, 1)))
        self.assertEqual(i1.invoice_number, "FV/2026/0001")
        self.assertEqual(i2.invoice_number, "FV/2026/0002")

    def test_different_companies_may_reuse_number_pattern(self):
        a = self._make_invoice(invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 4, 1)))
        b = self._make_invoice(
            company=self.company_b,
            order=self.order_b,
            customer=self.customer_b,
            invoice_number=Invoice._next_invoice_number(self.company_b.pk, date(2026, 4, 1)),
        )
        self.assertEqual(a.invoice_number, "FV/2026/0001")
        self.assertEqual(b.invoice_number, "FV/2026/0001")

    def test_year_is_taken_from_issue_date(self):
        num = Invoice._next_invoice_number(self.company.pk, date(2025, 6, 15))
        self.assertEqual(num, "FV/2025/0001")

    def test_explicit_invoice_number_is_preserved(self):
        inv = self._make_invoice(invoice_number="MANUAL-FV-1")
        self.assertEqual(inv.invoice_number, "MANUAL-FV-1")

    def test_duplicate_invoice_number_per_company_fails(self):
        with self.assertRaises(IntegrityError):
            Invoice.objects.create(
                company=self.company,
                user=self.user,
                order=self.order,
                customer=self.customer,
                issue_date=date(2026, 4, 1),
                sale_date=date(2026, 4, 1),
                due_date=date(2026, 4, 30),
                invoice_number="FV/2026/0001",
            )
            Invoice.objects.create(
                company=self.company,
                user=self.user,
                order=self.order,
                customer=self.customer,
                issue_date=date(2026, 4, 1),
                sale_date=date(2026, 4, 1),
                due_date=date(2026, 4, 30),
                invoice_number="FV/2026/0001",
            )

    def test_multiple_unnumbered_drafts_allowed(self):
        # Two drafts without a number for the same company are allowed.
        i1 = self._make_invoice()
        order2 = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 4, 2),
            delivery_date=date(2026, 4, 11),
            status=Order.STATUS_DELIVERED,
        )
        i2 = self._make_invoice(order=order2)
        self.assertIsNone(i1.invoice_number)
        self.assertIsNone(i2.invoice_number)

    def test_id_is_uuid(self):
        inv = self._make_invoice()
        self.assertEqual(len(str(inv.uuid)), 36)

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
        CompanyModule.objects.get_or_create(company=co, module="invoicing", defaults={"is_enabled": True})
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("invoice-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)

    def test_invoice_preview_requires_authentication(self):
        r = self.client.get(
            reverse("invoice-preview", kwargs={"uuid": str(uuid.uuid4())}),
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
        CompanyModule.objects.get_or_create(company=self.co, module="invoicing", defaults={"is_enabled": True})
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
        self.assertEqual(r.data["results"][0]["id"], str(mine.uuid))

    def test_create_sets_company_user_and_customer_from_order(self):
        # Draft invoices now have no number until explicitly issued.
        self.client.force_authenticate(user=self.user)
        body = {
            "order_id": str(self.order.uuid),
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
        self.assertIsNone(r.data["invoice_number"])
        self.assertEqual(r.data["status"], "draft")
        self.assertEqual(str(r.data["company"]), str(self.co.uuid))
        self.assertEqual(str(r.data["user"]), str(self.user.uuid))
        self.assertEqual(str(r.data["order"]["id"]), str(self.order.uuid))
        row = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(row.customer_id, self.customer.id)
        self.assertEqual(row.company_id, self.co.id)

    def test_create_with_explicit_customer_id(self):
        second_customer = Customer.objects.create(name="Alt buyer", company=self.co)
        self.client.force_authenticate(user=self.user)
        body = {
            "order_id": str(self.order.uuid),
            "customer_id": str(second_customer.uuid),
            "issue_date": "2026-04-20",
            "sale_date": "2026-04-20",
            "due_date": "2026-05-04",
        }
        r = self.client.post(reverse("invoice-list"), data=body, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        row = Invoice.objects.get(uuid=r.data["id"])
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
        CompanyModule.objects.get_or_create(company=self.co, module="invoicing", defaults={"is_enabled": True})
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
        # A delivered WZ is required by default (wz_required_before_invoice=True).
        DeliveryDocument.objects.create(
            company=self.co,
            order=self.order,
            user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 10),
            status=DeliveryDocument.STATUS_DELIVERED,
        )
        self.client.force_authenticate(user=self.user)

    def _gen_url(self):
        return reverse(
            "invoice-generate-from-order",
            kwargs={"order_id": str(self.order.uuid)},
        )

    def test_generate_from_order_creates_draft_with_lines_and_totals(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_DRAFT)
        self.assertEqual(len(r.data["items"]), 1)
        inv = Invoice.objects.get(uuid=r.data["id"])
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
        inv = Invoice.objects.get(uuid=r.data["id"])
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
        inv = Invoice.objects.get(uuid=r.data["id"])
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
            kwargs={"order_id": str(foreign.uuid)},
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
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertIsNotNone(inv.delivery_document_id)
        self.assertEqual(inv.delivery_document.document_number, "WZ/2026/0099")

    def test_issue_transitions_draft_to_issued(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        self.assertEqual(r2.data["status"], Invoice.STATUS_ISSUED)
        row = Invoice.objects.get(uuid=inv_id)
        self.assertEqual(row.status, Invoice.STATUS_ISSUED)

    def test_issue_fails_when_not_draft(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mark_paid_from_issued(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r3 = self.client.post(
            reverse("invoice-mark-paid", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r3.status_code, status.HTTP_200_OK, r3.data)
        self.assertEqual(r3.data["status"], Invoice.STATUS_PAID)
        row = Invoice.objects.get(uuid=inv_id)
        self.assertIsNotNone(row.paid_at)

    def test_mark_paid_fails_from_draft(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.post(
            reverse("invoice-mark-paid", kwargs={"uuid": inv_id}),
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
            reverse("invoice-mark-paid", kwargs={"uuid": str(inv.uuid)}),
            data={},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_PAID)

    def test_mark_unpaid_from_paid(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.client.post(
            reverse("invoice-mark-paid", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r_unpaid = self.client.post(
            reverse("invoice-mark-unpaid", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r_unpaid.status_code, status.HTTP_200_OK, r_unpaid.data)
        self.assertEqual(r_unpaid.data["status"], Invoice.STATUS_ISSUED)
        row = Invoice.objects.get(uuid=inv_id)
        self.assertIsNone(row.paid_at)

    def test_mark_unpaid_fails_from_issued(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.post(
            reverse("invoice-mark-unpaid", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_returns_html_ready_payload(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        r2 = self.client.get(reverse("invoice-preview", kwargs={"uuid": inv_id}))
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
            reverse("invoice-preview", kwargs={"uuid": str(foreign_inv.uuid)}),
        )
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_patch_issued_invoice_rejected(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.patch(
            reverse("invoice-detail", kwargs={"uuid": inv_id}),
            data={"notes": "x"},
            format="json",
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_issued_invoice_rejected(self):
        r = self.client.post(self._gen_url(), data={}, format="json")
        inv_id = r.data["id"]
        self.client.post(
            reverse("invoice-issue", kwargs={"uuid": inv_id}),
            data={},
            format="json",
        )
        r2 = self.client.delete(reverse("invoice-detail", kwargs={"uuid": inv_id}))
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
        self.assertIn(str(inv_draft.uuid), ids)
        self.assertNotIn(str(inv_issued.uuid), ids)

        r2 = self.client.get(reverse("invoice-list"), {"customer": str(other_c.uuid)})
        ids2 = {row["id"] for row in r2.data["results"]}
        self.assertNotIn(str(inv_draft.uuid), ids2)
        self.assertIn(str(inv_issued.uuid), ids2)

        r3 = self.client.get(
            reverse("invoice-list"),
            {"issue_date_after": "2026-04-15", "issue_date_before": "2026-05-15"},
        )
        ids3 = {row["id"] for row in r3.data["results"]}
        self.assertNotIn(str(inv_draft.uuid), ids3)
        self.assertIn(str(inv_issued.uuid), ids3)

        r4 = self.client.get(reverse("invoice-list"), {"ksef_status": "pending"})
        ids4 = {row["id"] for row in r4.data["results"]}
        self.assertIn(str(inv_issued.uuid), ids4)


class InvoiceNextNumberAndIssueTests(TestCase):
    """Tests for GET /api/invoices/next-number/ and issue-with-number behaviour."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="next-num-user",
            email="next-num@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Next Num Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.co, role="admin", is_active=True
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.co, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="Buyer", company=self.co)
        self.order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.co,
            order_date=date(2026, 4, 1), delivery_date=date(2026, 4, 10),
            status=Order.STATUS_DELIVERED,
        )
        DeliveryDocument.objects.create(
            company=self.co, order=self.order, user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 4, 10), status=DeliveryDocument.STATUS_DELIVERED,
        )
        self.client.force_authenticate(user=self.user)

    def test_next_number_returns_first_number(self):
        r = self.client.get(reverse("invoice-next-number"), {"issue_date": "2026-04-01"})
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["next_number"], "FV/2026/0001")

    def test_next_number_increments_after_issued_invoice(self):
        # Issue one invoice first
        inv = Invoice.objects.create(
            company=self.co, user=self.user, order=self.order, customer=self.customer,
            issue_date=date(2026, 4, 1), sale_date=date(2026, 4, 1), due_date=date(2026, 4, 30),
            invoice_number="FV/2026/0001",
        )
        r = self.client.get(reverse("invoice-next-number"), {"issue_date": "2026-04-01"})
        self.assertEqual(r.data["next_number"], "FV/2026/0002")

    def test_issue_assigns_number_to_unnumbered_draft(self):
        inv = Invoice.objects.create(
            company=self.co, user=self.user, order=self.order, customer=self.customer,
            issue_date=date(2026, 4, 1), sale_date=date(2026, 4, 1), due_date=date(2026, 4, 30),
        )
        self.assertIsNone(inv.invoice_number)
        r = self.client.post(reverse("invoice-issue", kwargs={"uuid": str(inv.uuid)}), {}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_ISSUED)
        self.assertEqual(r.data["invoice_number"], "FV/2026/0001")

    def test_delete_draft_without_number_succeeds(self):
        inv = Invoice.objects.create(
            company=self.co, user=self.user, order=self.order, customer=self.customer,
            issue_date=date(2026, 4, 1), sale_date=date(2026, 4, 1), due_date=date(2026, 4, 30),
        )
        r = self.client.delete(reverse("invoice-detail", kwargs={"uuid": str(inv.uuid)}))
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_draft_with_number_rejected(self):
        inv = Invoice.objects.create(
            company=self.co, user=self.user, order=self.order, customer=self.customer,
            issue_date=date(2026, 4, 1), sale_date=date(2026, 4, 1), due_date=date(2026, 4, 30),
            invoice_number="FV/2026/0001",
        )
        r = self.client.delete(reverse("invoice-detail", kwargs={"uuid": str(inv.uuid)}))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


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
        self.assertEqual(inv["company"], str(self.co.uuid))
        self.assertEqual(inv["order"], str(self.order.uuid))
        self.assertEqual(inv["customer"], str(self.customer.uuid))
        self.assertIsNone(inv["delivery_document"])
        self.assertEqual(inv["payment_method_label"], "Przelew bankowy")
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
        self.assertEqual(data["invoice"]["delivery_document"], str(doc.uuid))
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

    def test_invoice_item_gets_pkwiu_from_product(self):
        self.product.pkwiu = "62.01.11.0"
        self.product.save(update_fields=["pkwiu"])
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        line = inv.items.first()
        self.assertEqual(line.pkwiu, "62.01.11.0")

    def test_invoice_item_pkwiu_empty_when_product_has_no_pkwiu(self):
        self.product.pkwiu = ""
        self.product.save(update_fields=["pkwiu"])
        inv = generate_invoice_from_order(
            order=self.order,
            company=self.co,
            user=self.user,
        )
        line = inv.items.first()
        self.assertEqual(line.pkwiu, "")


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
        self.assertEqual(len(str(line.uuid)), 36)

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


class InvoiceIssueLevel2GuardTests(TestCase):
    """Issue action: Level 2 guard — can't invoice more than delivered."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="inv-l2-guard-user",
            email="inv-l2-guard@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="L2 Guard Co")
        CompanyMembership.objects.create(user=self.user, company=self.co, role="admin", is_active=True)
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.co, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="B", company=self.co, payment_terms=14)
        self.product = Product.objects.create(
            name="Widget L2",
            company=self.co,
            unit="szt.",
            price_net=Decimal("10.00"),
            price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"),
        )
        # Order: 5 ordered, 3 delivered
        self.order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.co,
            order_date=date(2026, 6, 1), delivery_date=date(2026, 6, 4),
            status=Order.STATUS_DELIVERED,
        )
        self.order_item = OrderItem.objects.create(
            order=self.order, product=self.product,
            quantity=Decimal("5.00"), quantity_delivered=Decimal("3.00"),
            unit_price_net=Decimal("10.00"), unit_price_gross=Decimal("12.30"),
            vat_rate=Decimal("23.00"), discount_percent=Decimal("0.00"),
        )
        # Delivered WZ required by the wz_required_before_invoice check
        DeliveryDocument.objects.create(
            company=self.co, order=self.order, user=self.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=date(2026, 6, 4),
            status=DeliveryDocument.STATUS_DELIVERED,
        )
        # Ensure wz_required_before_invoice = True
        from apps.users.models import CompanyWorkflowSettings
        CompanyWorkflowSettings.objects.update_or_create(
            company=self.co,
            defaults={"wz_required_before_invoice": True, "orders_required": False},
        )
        self.client.force_authenticate(user=self.user)

    def _gen_url(self):
        return reverse("invoice-generate-from-order", kwargs={"order_id": str(self.order.uuid)})

    def _issue_url(self, inv_id):
        return reverse("invoice-issue", kwargs={"uuid": str(inv_id)})

    def _create_invoice_with_qty(self, qty):
        """Generate a draft invoice, then override the item quantity to test the guard."""
        r = self.client.post(self._gen_url(), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        inv = Invoice.objects.get(uuid=r.data["id"])
        item = inv.items.first()
        item.quantity = qty
        item.save(update_fields=["quantity"])
        return inv

    def test_issue_blocked_when_invoice_qty_exceeds_delivered(self):
        inv = self._create_invoice_with_qty(Decimal("4.00"))  # delivered=3, trying 4
        r = self.client.post(self._issue_url(inv.uuid), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST, r.data)
        self.assertIn("przekracza", r.data["detail"])

    def test_issue_allowed_when_invoice_qty_equals_delivered(self):
        inv = self._create_invoice_with_qty(Decimal("3.00"))
        r = self.client.post(self._issue_url(inv.uuid), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)
        self.assertEqual(r.data["status"], Invoice.STATUS_ISSUED)

    def test_issue_allowed_when_invoice_qty_below_delivered(self):
        inv = self._create_invoice_with_qty(Decimal("2.00"))
        r = self.client.post(self._issue_url(inv.uuid), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)

    def test_level2_guard_skipped_when_wz_not_required(self):
        """When wz_required_before_invoice=False the quantity guard is also skipped."""
        from apps.users.models import CompanyWorkflowSettings
        CompanyWorkflowSettings.objects.filter(company=self.co).update(
            wz_required_before_invoice=False
        )
        inv = self._create_invoice_with_qty(Decimal("10.00"))  # far exceeds delivered
        r = self.client.post(self._issue_url(inv.uuid), data={}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.data)


# ---------------------------------------------------------------------------
# FV-KOR — Invoice correction tests
# ---------------------------------------------------------------------------


class InvoiceCorrectionNumberingTests(TestCase):
    """FV-KOR numbering via _next_invoice_number classmethod."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="kor-num-user", email="kor-num@test.com", password="pass"
        )
        self.company = Company.objects.create(name="KOR Co")
        self.customer = Customer.objects.create(name="KOR Cust", company=self.company)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 6, 1),
            delivery_date=date(2026, 6, 10),
            status=Order.STATUS_DELIVERED,
        )

    def _make_invoice(self, order=None, **kwargs):
        """Create an invoice; caller is responsible for setting invoice_number if needed."""
        return Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=order or self.order,
            customer=self.customer,
            issue_date=kwargs.pop("issue_date", date(2026, 6, 1)),
            sale_date=kwargs.pop("sale_date", date(2026, 6, 1)),
            due_date=kwargs.pop("due_date", date(2026, 6, 30)),
            **kwargs,
        )

    def test_correction_next_number_uses_fv_kor_prefix(self):
        num = Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1), is_correction=True)
        self.assertTrue(num.startswith("FV-KOR/2026/"))

    def test_correction_numbering_is_sequential(self):
        original = self._make_invoice()
        # Assign numbers explicitly using the classmethod (as the service does)
        num1 = Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1), is_correction=True)
        kor1 = self._make_invoice(
            is_correction=True, corrects_invoice=original, correction_reason="R1",
            invoice_number=num1,
        )
        num2 = Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1), is_correction=True)
        kor2 = self._make_invoice(
            is_correction=True, corrects_invoice=original, correction_reason="R2",
            invoice_number=num2,
        )
        self.assertEqual(kor1.invoice_number, "FV-KOR/2026/0001")
        self.assertEqual(kor2.invoice_number, "FV-KOR/2026/0002")

    def test_fv_and_fv_kor_sequences_are_independent(self):
        order2 = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 6, 2),
            delivery_date=date(2026, 6, 11),
            status=Order.STATUS_DELIVERED,
        )
        inv1 = self._make_invoice(
            invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1))
        )
        inv2 = self._make_invoice(
            order=order2,
            invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1)),
        )
        kor = self._make_invoice(
            is_correction=True, corrects_invoice=inv1, correction_reason="R",
            invoice_number=Invoice._next_invoice_number(self.company.pk, date(2026, 6, 1), is_correction=True),
        )
        self.assertEqual(inv2.invoice_number, "FV/2026/0002")
        self.assertEqual(kor.invoice_number, "FV-KOR/2026/0001")


class CreateInvoiceCorrectionServiceTests(TestCase):
    """Unit tests for create_invoice_correction service."""

    def setUp(self):
        from apps.invoices.services import create_invoice_correction

        self.service = create_invoice_correction

        User = get_user_model()
        self.user = User.objects.create_user(
            username="kor-svc-user", email="kor-svc@test.com", password="pass"
        )
        self.company = Company.objects.create(name="KOR Svc Co")
        self.customer = Customer.objects.create(name="Cust", company=self.company)
        self.product = Product.objects.create(
            company=self.company, name="Bread", unit="szt", price_gross="5.00"
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 6, 1),
            delivery_date=date(2026, 6, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.order_item = OrderItem.objects.create(
            order=self.order,
            product=self.product,
            product_name="Bread",
            product_unit="szt",
            quantity=Decimal("10"),
            quantity_delivered=Decimal("10"),
            unit_price_net=Decimal("4.07"),
            unit_price_gross=Decimal("5.00"),
            vat_rate=Decimal("23"),
            line_total_net=Decimal("40.70"),
            line_total_gross=Decimal("50.00"),
        )
        self.invoice = Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 6, 1),
            sale_date=date(2026, 6, 1),
            due_date=date(2026, 6, 30),
            status=Invoice.STATUS_ISSUED,
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            product=self.product,
            product_name="Bread",
            product_unit="szt",
            quantity=Decimal("10"),
            unit_price_net=Decimal("4.07"),
            vat_rate=Decimal("23"),
        )

    def test_creates_correction_for_issued_invoice(self):
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Błędna ilość",
            items_data=[],
        )
        self.assertTrue(kor.is_correction)
        self.assertEqual(kor.corrects_invoice, self.invoice)
        self.assertEqual(kor.correction_reason, "Błędna ilość")
        self.assertEqual(kor.status, Invoice.STATUS_DRAFT)
        self.assertTrue(kor.invoice_number.startswith("FV-KOR/"))

    def test_creates_correction_for_paid_invoice(self):
        self.invoice.status = Invoice.STATUS_PAID
        self.invoice.save(update_fields=["status"])
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Zwrot",
            items_data=[],
        )
        self.assertIsNotNone(kor.id)

    def test_raises_for_draft_invoice(self):
        self.invoice.status = Invoice.STATUS_DRAFT
        self.invoice.save(update_fields=["status"])
        with self.assertRaises(Exception):
            self.service(
                original_invoice=self.invoice,
                company=self.company,
                user=self.user,
                correction_reason="R",
                items_data=[],
            )

    def test_raises_when_correction_reason_is_empty(self):
        with self.assertRaises(Exception):
            self.service(
                original_invoice=self.invoice,
                company=self.company,
                user=self.user,
                correction_reason="",
                items_data=[],
            )

    def test_items_copied_from_original_when_no_overrides(self):
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Korekta",
            items_data=[],
        )
        kor_items = list(kor.items.all())
        self.assertEqual(len(kor_items), 1)
        self.assertEqual(kor_items[0].quantity, Decimal("10"))
        self.assertEqual(kor_items[0].unit_price_net, Decimal("4.07"))

    def test_item_override_quantity_and_price(self):
        orig_item = self.invoice.items.first()
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Korekta ceny",
            items_data=[{"item_id": str(orig_item.id), "quantity": "8", "unit_price_net": "3.00"}],
        )
        kor_item = kor.items.first()
        self.assertEqual(kor_item.quantity, Decimal("8"))
        self.assertEqual(kor_item.unit_price_net, Decimal("3.00"))

    def test_totals_recalculated_on_correction(self):
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Korekta",
            items_data=[],
        )
        self.assertGreater(kor.total_gross, Decimal("0"))

    def test_removed_line_is_marked_is_removed(self):
        orig_item = self.invoice.items.first()
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Usunięcie pozycji",
            items_data=[{"item_id": str(orig_item.id), "remove": True}],
        )
        kor_item = kor.items.first()
        self.assertTrue(kor_item.is_removed)
        # Removed item totals should be zeroed
        self.assertEqual(kor_item.line_net, Decimal("0.00"))
        self.assertEqual(kor_item.line_gross, Decimal("0.00"))

    def test_removed_line_emits_only_stan_przed_in_xml(self):
        from apps.ksef.xml_generator import generate_fa3_xml

        orig_item = self.invoice.items.first()
        self.invoice.ksef_number = "KSeF/123"
        self.invoice.save(update_fields=["ksef_number"])

        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Usunięcie",
            items_data=[{"item_id": str(orig_item.id), "remove": True}],
        )
        xml = generate_fa3_xml(kor)
        # StanPrzed tag present (original value row)
        self.assertIn("<StanPrzed>1</StanPrzed>", xml)
        # Only ONE FaWiersz block (no "after" row for removed item)
        self.assertEqual(xml.count("<FaWiersz>"), 1)

    def test_added_line_emits_only_after_in_xml(self):
        from apps.ksef.xml_generator import generate_fa3_xml

        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Dodanie pozycji",
            items_data=[
                {
                    "product_name": "Nowy chleb",
                    "quantity": "5",
                    "unit_price_net": "3.00",
                    "vat_rate": "5",
                    "product_unit": "szt",
                }
            ],
        )
        xml = generate_fa3_xml(kor)
        # Orig line pair (StanPrzed + after) + 1 added line = 3 FaWiersz blocks
        self.assertEqual(xml.count("<FaWiersz>"), 3)
        # New line has no StanPrzed (it has 1 StanPrzed from the orig item pair)
        self.assertEqual(xml.count("<StanPrzed>1</StanPrzed>"), 1)
        self.assertIn("Nowy chleb", xml)

    def test_vat_rate_override_applied(self):
        orig_item = self.invoice.items.first()
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Zmiana stawki VAT",
            items_data=[{"item_id": str(orig_item.id), "vat_rate": "8"}],
        )
        kor_item = kor.items.first()
        self.assertEqual(kor_item.vat_rate, Decimal("8"))

    def test_header_due_date_override(self):
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Korekta",
            items_data=[],
            due_date=date(2026, 12, 31),
        )
        self.assertEqual(kor.due_date, date(2026, 12, 31))

    def test_header_payment_method_override(self):
        kor = self.service(
            original_invoice=self.invoice,
            company=self.company,
            user=self.user,
            correction_reason="Korekta",
            items_data=[],
            payment_method="cash",
        )
        self.assertEqual(kor.payment_method, "cash")


class InvoiceCorrectionAPITests(TestCase):
    """POST /api/invoices/{id}/create-correction/ endpoint."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="kor-api-user", email="kor-api@test.com", password="pass"
        )
        self.company = Company.objects.create(name="KOR API Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.user.current_company = self.company
        self.user.save()
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="API Cust", company=self.company)
        self.product = Product.objects.create(
            company=self.company, name="Milk", unit="l", price_gross="2.00"
        )
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 6, 1),
            delivery_date=date(2026, 6, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.invoice = Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 6, 1),
            sale_date=date(2026, 6, 1),
            due_date=date(2026, 6, 30),
            status=Invoice.STATUS_ISSUED,
        )
        self.order_item = OrderItem.objects.create(
            order=self.order,
            product=self.product,
            product_name="Milk",
            product_unit="l",
            quantity=Decimal("5"),
            unit_price_net=Decimal("1.63"),
            unit_price_gross=Decimal("2.00"),
            vat_rate=Decimal("23"),
            line_total_net=Decimal("8.15"),
            line_total_gross=Decimal("10.00"),
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            order_item=self.order_item,
            product=self.product,
            product_name="Milk",
            product_unit="l",
            quantity=Decimal("5"),
            unit_price_net=Decimal("1.63"),
            vat_rate=Decimal("23"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _url(self, invoice_id):
        return reverse("invoice-create-correction", kwargs={"uuid": str(invoice_id)})

    def test_returns_201_with_correction_data(self):
        r = self.client.post(
            self._url(self.invoice.uuid),
            data={"correction_reason": "Błędna ilość"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertTrue(r.data["is_correction"])
        self.assertEqual(r.data["corrects_invoice_number"], self.invoice.invoice_number)

    def test_returns_400_for_draft_invoice(self):
        self.invoice.status = Invoice.STATUS_DRAFT
        self.invoice.save(update_fields=["status"])
        r = self.client.post(
            self._url(self.invoice.uuid),
            data={"correction_reason": "Test"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_returns_400_when_reason_missing(self):
        r = self.client.post(
            self._url(self.invoice.uuid),
            data={},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


class InvoiceCorrectionFilterTests(TestCase):
    """GET /api/invoices/?is_correction=true/false filter."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="kor-filter-user", email="kor-filter@test.com", password="pass"
        )
        self.company = Company.objects.create(name="KOR Filter Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.user.current_company = self.company
        self.user.save()
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="Cust", company=self.company)
        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 6, 1),
            delivery_date=date(2026, 6, 10),
            status=Order.STATUS_DELIVERED,
        )
        self.invoice = Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 6, 1),
            sale_date=date(2026, 6, 1),
            due_date=date(2026, 6, 30),
            status=Invoice.STATUS_ISSUED,
        )
        self.correction = Invoice.objects.create(
            company=self.company,
            user=self.user,
            order=self.order,
            customer=self.customer,
            issue_date=date(2026, 6, 2),
            sale_date=date(2026, 6, 2),
            due_date=date(2026, 6, 30),
            status=Invoice.STATUS_DRAFT,
            is_correction=True,
            corrects_invoice=self.invoice,
            correction_reason="Test",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _list_url(self, **params):
        from django.urls import reverse as rev
        url = rev("invoice-list")
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{url}?{qs}"
        return url

    def test_filter_is_correction_true_returns_only_corrections(self):
        r = self.client.get(self._list_url(is_correction="true"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in r.data["results"]]
        self.assertIn(str(self.correction.uuid), ids)
        self.assertNotIn(str(self.invoice.uuid), ids)

    def test_filter_is_correction_false_returns_only_regular_invoices(self):
        r = self.client.get(self._list_url(is_correction="false"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in r.data["results"]]
        self.assertIn(str(self.invoice.uuid), ids)
        self.assertNotIn(str(self.correction.uuid), ids)

    def test_no_filter_returns_both(self):
        r = self.client.get(self._list_url())
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in r.data["results"]]
        self.assertIn(str(self.invoice.uuid), ids)
        self.assertIn(str(self.correction.uuid), ids)


# ---------------------------------------------------------------------------
# billable_quantity with returns_mode
# ---------------------------------------------------------------------------

class BillableQuantityTests(TestCase):
    """Unit tests for billable_quantity() with different returns modes."""

    def _make_item(self, quantity="10.00", quantity_delivered=None, quantity_returned="0.00"):
        User = get_user_model()
        user = User.objects.create_user(
            username=f"bq-user-{uuid.uuid4().hex[:8]}",
            email=f"bq-{uuid.uuid4().hex[:8]}@test.com",
            password="test",
        )
        company = Company.objects.create(name=f"BQ Co {uuid.uuid4().hex[:4]}")
        customer = Customer.objects.create(name="Cust", company=company)
        order = Order.objects.create(
            user=user,
            customer=customer,
            company=company,
            order_date=date(2026, 9, 1),
            delivery_date=date(2026, 9, 10),
            status=Order.STATUS_DELIVERED,
        )
        product = Product.objects.create(name="Bread", company=company, user=user, price_net=Decimal("2.00"))
        oi = OrderItem.objects.create(
            order=order,
            product=product,
            product_name="Bread",
            product_unit="szt",
            quantity=Decimal(quantity),
            unit_price_net=Decimal("2.00"),
            vat_rate=Decimal("8"),
        )
        if quantity_delivered is not None:
            oi.quantity_delivered = Decimal(quantity_delivered)
        if quantity_returned is not None:
            oi.quantity_returned = Decimal(quantity_returned)
        oi.save()
        return oi

    def test_no_delivery_returns_ordered_quantity(self):
        oi = self._make_item(quantity="5.00")
        self.assertEqual(billable_quantity(oi, "fv_kor"), Decimal("5.00"))

    def test_fv_kor_uses_delivered_ignores_returns(self):
        oi = self._make_item(quantity="10.00", quantity_delivered="8.00", quantity_returned="2.00")
        self.assertEqual(billable_quantity(oi, "fv_kor"), Decimal("8.00"))

    def test_net_qty_subtracts_returns_from_delivered(self):
        oi = self._make_item(quantity="10.00", quantity_delivered="8.00", quantity_returned="3.00")
        self.assertEqual(billable_quantity(oi, "net_qty"), Decimal("5.00"))

    def test_net_qty_clamps_to_zero_when_returns_exceed_delivered(self):
        oi = self._make_item(quantity="10.00", quantity_delivered="2.00", quantity_returned="5.00")
        self.assertEqual(billable_quantity(oi, "net_qty"), Decimal("0.00"))

    def test_lines_mode_uses_delivered_like_fv_kor(self):
        oi = self._make_item(quantity="10.00", quantity_delivered="7.00", quantity_returned="1.00")
        self.assertEqual(billable_quantity(oi, "lines"), Decimal("7.00"))

    def test_default_mode_is_fv_kor(self):
        oi = self._make_item(quantity="10.00", quantity_delivered="6.00", quantity_returned="3.00")
        self.assertEqual(billable_quantity(oi), Decimal("6.00"))


# ---------------------------------------------------------------------------
# generate_invoice_from_orders with order_item_ids (partial selection)
# ---------------------------------------------------------------------------

class GenerateFromOrdersTests(TestCase):
    """Tests for generate_invoice_from_orders() including order_item_ids filtering."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="gfo-user",
            email="gfo@test.com",
            password="test",
        )
        self.company = Company.objects.create(name="GFO Co")
        CompanyMembership.objects.create(user=self.user, company=self.company, role="admin", is_active=True)
        self.customer = Customer.objects.create(name="GFO Customer", company=self.company)

        self.order = Order.objects.create(
            user=self.user,
            customer=self.customer,
            company=self.company,
            order_date=date(2026, 9, 1),
            delivery_date=date(2026, 9, 10),
            status=Order.STATUS_DELIVERED,
        )
        product = Product.objects.create(name="Bread", company=self.company, user=self.user, price_net=Decimal("2.00"))
        product2 = Product.objects.create(name="Roll", company=self.company, user=self.user, price_net=Decimal("1.00"))

        self.item1 = OrderItem.objects.create(
            order=self.order, product=product, product_name="Bread",
            product_unit="szt", quantity=Decimal("10"), unit_price_net=Decimal("2.00"), vat_rate=Decimal("8"),
        )
        self.item2 = OrderItem.objects.create(
            order=self.order, product=product2, product_name="Roll",
            product_unit="szt", quantity=Decimal("20"), unit_price_net=Decimal("1.00"), vat_rate=Decimal("8"),
        )

    def test_generates_invoice_for_all_items_when_no_filter(self):
        inv = generate_invoice_from_orders(
            order_ids=[str(self.order.uuid)],
            company=self.company,
            user=self.user,
            issue_date=date(2026, 9, 15),
            sale_date=date(2026, 9, 10),
            due_date=date(2026, 9, 29),
        )
        self.assertEqual(inv.items.count(), 2)
        self.assertEqual(inv.customer, self.customer)

    def test_item_quantities_override_billed_qty(self):
        inv = generate_invoice_from_orders(
            order_ids=[str(self.order.uuid)],
            order_item_ids=[str(self.item1.uuid)],
            item_quantities={str(self.item1.uuid): "3"},
            company=self.company,
            user=self.user,
            issue_date=date(2026, 9, 15),
            sale_date=date(2026, 9, 10),
            due_date=date(2026, 9, 29),
        )
        line = inv.items.get()
        self.assertEqual(line.quantity, Decimal("3"))
        self.assertEqual(line.product_name, "Bread")

    def test_generates_invoice_for_selected_items_only(self):
        inv = generate_invoice_from_orders(
            order_ids=[str(self.order.uuid)],
            order_item_ids=[str(self.item1.uuid)],
            company=self.company,
            user=self.user,
            issue_date=date(2026, 9, 15),
            sale_date=date(2026, 9, 10),
            due_date=date(2026, 9, 29),
        )
        self.assertEqual(inv.items.count(), 1)
        self.assertEqual(inv.items.first().product_name, "Bread")

    def test_empty_item_ids_list_raises_validation_error(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        with self.assertRaises(DRFValidationError):
            generate_invoice_from_orders(
                order_ids=[str(self.order.uuid)],
                order_item_ids=[],  # all items filtered out → nothing to bill
                company=self.company,
                user=self.user,
                issue_date=date(2026, 9, 15),
                sale_date=date(2026, 9, 10),
                due_date=date(2026, 9, 29),
            )

    def test_net_qty_returns_mode_subtracts_returned(self):
        self.company.invoice_returns_mode = "net_qty"
        self.company.save()
        self.item1.quantity_delivered = Decimal("10")
        self.item1.quantity_returned = Decimal("4")
        self.item1.save()

        inv = generate_invoice_from_orders(
            order_ids=[str(self.order.uuid)],
            order_item_ids=[str(self.item1.uuid)],
            company=self.company,
            user=self.user,
            issue_date=date(2026, 9, 15),
            sale_date=date(2026, 9, 10),
            due_date=date(2026, 9, 29),
        )
        line = inv.items.get(product_name="Bread")
        self.assertEqual(line.quantity, Decimal("6.00"))


# ---------------------------------------------------------------------------
# get_period_preview_from_orders
# ---------------------------------------------------------------------------

class PeriodPreviewOrdersTests(TestCase):
    """Tests for get_period_preview_from_orders() service function."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ppo-user",
            email="ppo@test.com",
            password="test",
        )
        self.company = Company.objects.create(name="PPO Co")
        self.customer = Customer.objects.create(name="PPO Customer", company=self.company)
        self.product = Product.objects.create(
            name="Bread", company=self.company, user=self.user,
            price_net=Decimal("2.00"), vat_rate=Decimal("8"),
        )

    def _make_order(self, delivery_date, quantity="10.00", quantity_delivered=None, status=Order.STATUS_DELIVERED):
        order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.company,
            order_date=date(2026, 9, 1), delivery_date=delivery_date, status=status,
        )
        oi = OrderItem.objects.create(
            order=order, product=self.product, product_name="Bread",
            product_unit="szt", quantity=Decimal(quantity),
            unit_price_net=Decimal("2.00"), vat_rate=Decimal("8"),
        )
        if quantity_delivered is not None:
            oi.quantity_delivered = Decimal(quantity_delivered)
            oi.save()
        return order, oi

    def test_aggregates_items_within_date_range(self):
        self._make_order(date(2026, 9, 5), quantity="10.00")
        self._make_order(date(2026, 9, 10), quantity="5.00")
        self._make_order(date(2026, 9, 20), quantity="8.00")  # outside range

        result = get_period_preview_from_orders(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["product_name"], "Bread")
        self.assertEqual(Decimal(result[0]["qty"]), Decimal("15.00"))

    def test_excludes_orders_outside_date_range(self):
        self._make_order(date(2026, 8, 31), quantity="5.00")  # before range
        self._make_order(date(2026, 9, 16), quantity="5.00")  # after range

        result = get_period_preview_from_orders(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(len(result), 0)

    def test_net_qty_mode_subtracts_returns(self):
        self.company.invoice_returns_mode = "net_qty"
        self.company.save()
        self._make_order(date(2026, 9, 5), quantity="10.00", quantity_delivered="10.00")
        # Manually set quantity_returned
        oi = OrderItem.objects.filter(order__customer=self.customer).first()
        oi.quantity_returned = Decimal("3.00")
        oi.save()

        result = get_period_preview_from_orders(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(Decimal(result[0]["qty"]), Decimal("7.00"))

    def test_returns_empty_list_when_no_orders(self):
        result = get_period_preview_from_orders(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(result, [])

    def test_result_contains_required_keys(self):
        self._make_order(date(2026, 9, 5))
        result = get_period_preview_from_orders(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        row = result[0]
        for key in ("product_id", "product_name", "product_unit", "qty", "unit_price_net", "vat_rate"):
            self.assertIn(key, row)
        # All values should be strings (JSON-serializable)
        self.assertIsInstance(row["qty"], str)
        self.assertIsInstance(row["unit_price_net"], str)
        self.assertIsInstance(row["vat_rate"], str)


# ---------------------------------------------------------------------------
# get_period_preview_from_wz
# ---------------------------------------------------------------------------

class PeriodPreviewWzTests(TestCase):
    """Tests for get_period_preview_from_wz() service function."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ppwz-user",
            email="ppwz@test.com",
            password="test",
        )
        self.company = Company.objects.create(name="PPWZ Co")
        self.customer = Customer.objects.create(name="PPWZ Customer", company=self.company)
        self.product = Product.objects.create(
            name="Roll", company=self.company, user=self.user,
            price_net=Decimal("1.50"), vat_rate=Decimal("8"),
        )
        self.order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.company,
            order_date=date(2026, 9, 1), delivery_date=date(2026, 9, 5),
            status=Order.STATUS_DELIVERED,
        )

    def _make_wz(self, issue_date, quantity_actual="10.00", quantity_returned="0.00", unit_cost=None):
        wz = DeliveryDocument.objects.create(
            company=self.company,
            order=self.order,
            user=self.user,
            to_customer=self.customer,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status=DeliveryDocument.STATUS_DELIVERED,
            issue_date=issue_date,
        )
        DeliveryItem.objects.create(
            delivery_document=wz,
            product=self.product,
            quantity_planned=Decimal(quantity_actual),
            quantity_actual=Decimal(quantity_actual),
            quantity_returned=Decimal(quantity_returned),
            unit_cost=Decimal(unit_cost) if unit_cost else None,
        )
        return wz

    def test_aggregates_wz_items_within_date_range(self):
        self._make_wz(date(2026, 9, 5), quantity_actual="10.00")
        self._make_wz(date(2026, 9, 10), quantity_actual="5.00")
        self._make_wz(date(2026, 9, 20), quantity_actual="8.00")  # outside range

        result = get_period_preview_from_wz(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["product_name"], "Roll")
        self.assertEqual(Decimal(result[0]["qty"]), Decimal("15.00"))

    def test_subtracts_returned_quantity(self):
        self._make_wz(date(2026, 9, 5), quantity_actual="10.00", quantity_returned="3.00")

        result = get_period_preview_from_wz(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(Decimal(result[0]["qty"]), Decimal("7.00"))

    def test_excludes_fully_returned_items(self):
        self._make_wz(date(2026, 9, 5), quantity_actual="5.00", quantity_returned="5.00")

        result = get_period_preview_from_wz(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(result, [])

    def test_excludes_non_delivered_wz(self):
        wz = DeliveryDocument.objects.create(
            company=self.company, order=self.order, user=self.user,
            to_customer=self.customer, document_type=DeliveryDocument.DOC_TYPE_WZ,
            status=DeliveryDocument.STATUS_IN_TRANSIT,
            issue_date=date(2026, 9, 5),
        )
        DeliveryItem.objects.create(
            delivery_document=wz, product=self.product,
            quantity_planned=Decimal("10"), quantity_actual=Decimal("10"),
        )
        result = get_period_preview_from_wz(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(result, [])

    def test_returns_empty_list_when_no_wz(self):
        result = get_period_preview_from_wz(
            customer=self.customer, company=self.company,
            date_from=date(2026, 9, 1), date_to=date(2026, 9, 15),
        )
        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# Period-preview API endpoints
# ---------------------------------------------------------------------------

class PeriodPreviewApiTests(TestCase):
    """API tests for GET /api/invoices/period-preview/orders/ and /wz/."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ppapi-user",
            email="ppapi@test.com",
            password="test",
        )
        self.company = Company.objects.create(name="PPAPI Co")
        CompanyMembership.objects.create(user=self.user, company=self.company, role="admin", is_active=True)
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})

        self.customer = Customer.objects.create(name="PPAPI Customer", company=self.company)
        self.product = Product.objects.create(
            name="Rye", company=self.company, user=self.user, price_net=Decimal("3.00"), vat_rate=Decimal("8"),
        )
        self.order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.company,
            order_date=date(2026, 9, 1), delivery_date=date(2026, 9, 10),
            status=Order.STATUS_DELIVERED,
        )
        OrderItem.objects.create(
            order=self.order, product=self.product, product_name="Rye",
            product_unit="szt", quantity=Decimal("12"),
            unit_price_net=Decimal("3.00"), vat_rate=Decimal("8"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.orders_url = reverse("invoice-period-preview-orders")
        self.wz_url = reverse("invoice-period-preview-wz")

    def test_orders_preview_returns_aggregated_items(self):
        r = self.client.get(self.orders_url, {
            "customer_id": str(self.customer.uuid),
            "date_from": "2026-09-01",
            "date_to": "2026-09-15",
        })
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["product_name"], "Rye")
        self.assertEqual(Decimal(r.data[0]["qty"]), Decimal("12.00"))

    def test_orders_preview_missing_params_returns_400(self):
        r = self.client.get(self.orders_url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_orders_preview_invalid_customer_returns_404(self):
        r = self.client.get(self.orders_url, {
            "customer_id": str(uuid.uuid4()),
            "date_from": "2026-09-01",
            "date_to": "2026-09-15",
        })
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_wz_preview_returns_empty_when_no_wz(self):
        r = self.client.get(self.wz_url, {
            "customer_id": str(self.customer.uuid),
            "date_from": "2026-09-01",
            "date_to": "2026-09-15",
        })
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data, [])

    def test_wz_preview_missing_params_returns_400(self):
        r = self.client.get(self.wz_url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_returns_401(self):
        client = APIClient()
        r = client.get(self.orders_url, {
            "customer_id": str(self.customer.uuid),
            "date_from": "2026-09-01",
            "date_to": "2026-09-15",
        })
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)


# ---------------------------------------------------------------------------
# generate-from-orders API endpoint with order_item_ids
# ---------------------------------------------------------------------------

class GenerateFromOrdersApiTests(TestCase):
    """API tests for POST /api/invoices/generate-from-orders/ with order_item_ids."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="gfoa-user",
            email="gfoa@test.com",
            password="test",
        )
        self.company = Company.objects.create(name="GFOA Co")
        CompanyMembership.objects.create(user=self.user, company=self.company, role="admin", is_active=True)
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})

        self.customer = Customer.objects.create(name="GFOA Customer", company=self.company)
        product = Product.objects.create(
            name="Wheat", company=self.company, user=self.user, price_net=Decimal("5.00"),
        )
        product2 = Product.objects.create(
            name="Oat", company=self.company, user=self.user, price_net=Decimal("4.00"),
        )
        self.order = Order.objects.create(
            user=self.user, customer=self.customer, company=self.company,
            order_date=date(2026, 9, 1), delivery_date=date(2026, 9, 10),
            status=Order.STATUS_CONFIRMED,
        )
        self.item1 = OrderItem.objects.create(
            order=self.order, product=product, product_name="Wheat",
            product_unit="kg", quantity=Decimal("100"),
            unit_price_net=Decimal("5.00"), vat_rate=Decimal("8"),
        )
        self.item2 = OrderItem.objects.create(
            order=self.order, product=product2, product_name="Oat",
            product_unit="kg", quantity=Decimal("50"),
            unit_price_net=Decimal("4.00"), vat_rate=Decimal("8"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = reverse("invoice-generate-from-orders-action")

    def test_partial_selection_creates_invoice_with_only_selected_items(self):
        r = self.client.post(self.url, {
            "order_ids": [str(self.order.uuid)],
            "order_item_ids": [str(self.item1.uuid)],
            "issue_date": "2026-09-15",
            "sale_date": "2026-09-10",
            "due_date": "2026-09-29",
            "payment_method": "transfer",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(inv.items.count(), 1)
        self.assertEqual(inv.items.first().product_name, "Wheat")

    def test_all_items_included_when_no_order_item_ids(self):
        r = self.client.post(self.url, {
            "order_ids": [str(self.order.uuid)],
            "issue_date": "2026-09-15",
            "sale_date": "2026-09-10",
            "due_date": "2026-09-29",
            "payment_method": "transfer",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(inv.items.count(), 2)

    def test_invalid_order_item_ids_type_returns_400(self):
        r = self.client.post(self.url, {
            "order_ids": [str(self.order.uuid)],
            "order_item_ids": "not-a-list",
            "issue_date": "2026-09-15",
            "sale_date": "2026-09-10",
            "due_date": "2026-09-29",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


# ─────────────────────────────────────────────────────────────────────────────
# ZAL / ROZ (advance / settlement) invoice tests
# ─────────────────────────────────────────────────────────────────────────────

class ZalRozServiceTests(TestCase):
    """Unit tests for create_manual_invoice with ksef_invoice_type ZAL / ROZ."""

    def setUp(self):
        from apps.invoices.services import create_manual_invoice
        self._create = create_manual_invoice

        User = get_user_model()
        self.user = User.objects.create_user(
            username="zalroz-svc-user",
            email="zalroz-svc@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="ZAL Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.customer = Customer.objects.create(name="ZAL Cust", company=self.company)

    def _item(self, name="Svc", price="100.00", vat="23", qty="1"):
        return {
            "product_name": name,
            "product_unit": "szt",
            "quantity": qty,
            "unit_price_net": price,
            "vat_rate": vat,
        }

    def _make_zal(self, gross="100.00"):
        """Helper: create and issue a ZAL invoice so it appears in available-ZAL."""
        inv = self._create(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item(price=gross, vat="0")],
            ksef_invoice_type="ZAL",
        )
        inv.status = Invoice.STATUS_ISSUED
        inv.save(update_fields=["status"])
        return inv

    # ── ZAL creation ────────────────────────────────────────────────────────

    def test_create_zal_sets_ksef_type(self):
        inv = self._create(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item()],
            ksef_invoice_type="ZAL",
        )
        self.assertEqual(inv.ksef_invoice_type, Invoice.KSEF_TYPE_ZAL)
        self.assertEqual(inv.status, Invoice.STATUS_DRAFT)

    def test_create_vat_default_type(self):
        inv = self._create(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item()],
        )
        self.assertEqual(inv.ksef_invoice_type, Invoice.KSEF_TYPE_VAT)

    def test_invalid_ksef_type_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        with self.assertRaises(DRFValidationError):
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item()],
                ksef_invoice_type="BOGUS",
            )

    # ── ROZ creation ────────────────────────────────────────────────────────

    def test_create_roz_links_advance_invoices(self):
        from apps.invoices.models import InvoiceAdvance
        zal = self._make_zal(gross="200.00")

        roz = self._create(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item(price="150.00", vat="0")],
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        self.assertEqual(roz.ksef_invoice_type, Invoice.KSEF_TYPE_ROZ)
        links = InvoiceAdvance.objects.filter(roz_invoice=roz)
        self.assertEqual(links.count(), 1)
        self.assertEqual(links.first().zal_invoice_id, zal.id)
        self.assertEqual(links.first().deduction_amount, zal.total_gross)

    def test_roz_without_advance_ids_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        with self.assertRaises(DRFValidationError):
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item()],
                ksef_invoice_type="ROZ",
                advance_invoice_ids=None,
            )

    def test_roz_with_empty_advance_ids_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        with self.assertRaises(DRFValidationError):
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item()],
                ksef_invoice_type="ROZ",
                advance_invoice_ids=[],
            )

    def test_roz_total_exceeds_zal_sum_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        zal = self._make_zal(gross="50.00")
        with self.assertRaises(DRFValidationError) as ctx:
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item(price="200.00", vat="0")],
                ksef_invoice_type="ROZ",
                advance_invoice_ids=[str(zal.uuid)],
            )
        self.assertIn("advance_invoice_ids", str(ctx.exception.detail))

    def test_roz_with_wrong_customer_zal_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        other_customer = Customer.objects.create(name="Other Cust", company=self.company)
        zal = self._create(
            customer=other_customer,
            company=self.company,
            user=self.user,
            items_data=[self._item(price="300.00", vat="0")],
            ksef_invoice_type="ZAL",
        )
        zal.status = Invoice.STATUS_ISSUED
        zal.save(update_fields=["status"])
        with self.assertRaises(DRFValidationError):
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item(price="100.00", vat="0")],
                ksef_invoice_type="ROZ",
                advance_invoice_ids=[str(zal.uuid)],
            )

    def test_roz_with_nonexistent_zal_uuid_raises(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        fake_uuid = str(uuid.uuid4())
        with self.assertRaises(DRFValidationError):
            self._create(
                customer=self.customer,
                company=self.company,
                user=self.user,
                items_data=[self._item()],
                ksef_invoice_type="ROZ",
                advance_invoice_ids=[fake_uuid],
            )

    def test_roz_links_multiple_zal_invoices(self):
        from apps.invoices.models import InvoiceAdvance
        zal1 = self._make_zal(gross="100.00")
        zal2 = self._make_zal(gross="150.00")

        roz = self._create(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item(price="200.00", vat="0")],
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal1.uuid), str(zal2.uuid)],
        )
        self.assertEqual(InvoiceAdvance.objects.filter(roz_invoice=roz).count(), 2)


class ZalRozAvailableEndpointTests(TestCase):
    """API tests for GET /api/invoices/available-zal/."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="avail-zal-user",
            email="avail-zal@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="Avail ZAL Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="Avail Cust", company=self.company)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = "/api/invoices/available-zal/"

    def _make_zal(self, status=Invoice.STATUS_ISSUED, gross="100.00"):
        from apps.invoices.services import create_manual_invoice
        inv = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "Item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": gross,
                "vat_rate": "0",
            }],
            ksef_invoice_type="ZAL",
        )
        inv.status = status
        inv.save(update_fields=["status"])
        return inv

    def test_returns_available_zal_for_customer(self):
        zal = self._make_zal()
        r = self.client.get(self.url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["id"], str(zal.uuid))

    def test_draft_zal_not_included(self):
        self._make_zal(status=Invoice.STATUS_DRAFT)
        r = self.client.get(self.url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 0)

    def test_settled_zal_excluded(self):
        from apps.invoices.models import InvoiceAdvance
        from apps.invoices.services import create_manual_invoice
        zal = self._make_zal()
        roz = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "ROZ Item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "80.00",
                "vat_rate": "0",
            }],
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        r = self.client.get(self.url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 0)

    def test_missing_customer_id_returns_400(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_wrong_company_customer_returns_404(self):
        other_company = Company.objects.create(name="Other Co")
        other_customer = Customer.objects.create(name="Other Cust", company=other_company)
        r = self.client.get(self.url, {"customer_id": str(other_customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_response_fields(self):
        zal = self._make_zal(gross="123.00")
        r = self.client.get(self.url, {"customer_id": str(self.customer.uuid)})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        item = r.data[0]
        self.assertIn("id", item)
        self.assertIn("invoice_number", item)
        self.assertIn("issue_date", item)
        self.assertIn("total_gross", item)


class ZalRozCreateManualApiTests(TestCase):
    """API tests: POST /api/invoices/create-manual/ with ZAL and ROZ types."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="cm-zalroz-user",
            email="cm-zalroz@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="CM ZAL Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        CompanyModule.objects.get_or_create(company=self.company, module="invoicing", defaults={"is_enabled": True})
        self.customer = Customer.objects.create(name="CM Cust", company=self.company)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = "/api/invoices/create-manual/"

    def _item_payload(self, name="Prod", price="100.00", vat="0"):
        return {"product_name": name, "product_unit": "szt", "quantity": "1",
                "unit_price_net": price, "vat_rate": vat}

    def _base_payload(self, **overrides):
        payload = {
            "customer_id": str(self.customer.uuid),
            "items": [self._item_payload()],
            "issue_date": "2026-09-01",
            "sale_date": "2026-09-01",
            "due_date": "2026-09-15",
            "payment_method": "transfer",
        }
        payload.update(overrides)
        return payload

    def _create_zal_issued(self, gross="200.00"):
        from apps.invoices.services import create_manual_invoice
        inv = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[self._item_payload(price=gross)],
            ksef_invoice_type="ZAL",
        )
        inv.status = Invoice.STATUS_ISSUED
        inv.save(update_fields=["status"])
        return inv

    def test_create_zal_via_api(self):
        payload = self._base_payload(ksef_invoice_type="ZAL")
        r = self.client.post(self.url, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(inv.ksef_invoice_type, Invoice.KSEF_TYPE_ZAL)

    def test_create_roz_via_api(self):
        zal = self._create_zal_issued(gross="300.00")
        payload = self._base_payload(
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        r = self.client.post(self.url, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(inv.ksef_invoice_type, Invoice.KSEF_TYPE_ROZ)
        self.assertEqual(inv.advance_links.count(), 1)

    def test_roz_without_advance_ids_returns_400(self):
        payload = self._base_payload(ksef_invoice_type="ROZ")
        r = self.client.post(self.url, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_roz_total_over_zal_returns_400(self):
        zal = self._create_zal_issued(gross="50.00")
        payload = self._base_payload(
            ksef_invoice_type="ROZ",
            items=[self._item_payload(price="200.00")],
            advance_invoice_ids=[str(zal.uuid)],
        )
        r = self.client.post(self.url, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_advance_invoices_data_in_response(self):
        zal = self._create_zal_issued(gross="300.00")
        payload = self._base_payload(
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        r = self.client.post(self.url, payload, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        # Serializer should include advance_invoices_data on retrieval
        detail_r = self.client.get(f"/api/invoices/{r.data['id']}/")
        self.assertEqual(detail_r.status_code, status.HTTP_200_OK)
        self.assertIn("advance_invoices_data", detail_r.data)
        self.assertEqual(len(detail_r.data["advance_invoices_data"]), 1)
        self.assertEqual(detail_r.data["advance_invoices_data"][0]["id"], str(zal.uuid))


class ZalRozKsefValidatorTests(TestCase):
    """Tests for KSeF validator allowing ZAL and correctly blocking ROZ without links."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ksef-zalroz-user",
            email="ksef-zalroz@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="KSeF ZAL Co")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.customer = Customer.objects.create(
            name="KSeF Cust",
            company=self.company,
            nip="1234567890",
        )

    def _make_invoice(self, ksef_type="VAT"):
        from apps.invoices.services import create_manual_invoice
        inv = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "X",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "100.00",
                "vat_rate": "23",
            }],
            ksef_invoice_type=ksef_type,
        )
        inv.status = Invoice.STATUS_ISSUED
        inv.save(update_fields=["status"])
        return inv

    def test_zal_passes_validator(self):
        from apps.ksef.validators import validate_invoice_for_ksef
        inv = self._make_invoice("ZAL")
        errors, _warnings = validate_invoice_for_ksef(inv)
        # ZAL with customer NIP should not raise advance-link errors
        zal_errors = [e for e in errors if "zaliczkow" in e.lower() or "rozliczeniow" in e.lower()]
        self.assertEqual(zal_errors, [])

    def test_roz_without_links_fails_validator(self):
        from apps.ksef.validators import validate_invoice_for_ksef
        # Manually create ROZ without InvoiceAdvance links
        from apps.invoices.services import create_manual_invoice
        from apps.invoices.models import InvoiceAdvance
        # Create a ZAL first so ROZ can be created
        zal = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "ZAL item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "500.00",
                "vat_rate": "23",
            }],
            ksef_invoice_type="ZAL",
        )
        zal.status = Invoice.STATUS_ISSUED
        zal.save(update_fields=["status"])

        roz = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "ROZ item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "100.00",
                "vat_rate": "23",
            }],
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        # Delete the link to simulate ROZ without links
        InvoiceAdvance.objects.filter(roz_invoice=roz).delete()
        roz.status = Invoice.STATUS_ISSUED
        roz.save(update_fields=["status"])

        errors, _warnings = validate_invoice_for_ksef(roz)
        roz_errors = [e for e in errors if "ROZ" in e or "zaliczkow" in e.lower()]
        self.assertTrue(len(roz_errors) > 0, f"Expected ROZ error, got: {errors}")

    def test_roz_with_links_passes_validator(self):
        from apps.ksef.validators import validate_invoice_for_ksef
        from apps.invoices.services import create_manual_invoice
        zal = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "ZAL item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "500.00",
                "vat_rate": "23",
            }],
            ksef_invoice_type="ZAL",
        )
        zal.status = Invoice.STATUS_ISSUED
        zal.save(update_fields=["status"])

        roz = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "ROZ item",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "100.00",
                "vat_rate": "23",
            }],
            ksef_invoice_type="ROZ",
            advance_invoice_ids=[str(zal.uuid)],
        )
        roz.status = Invoice.STATUS_ISSUED
        roz.save(update_fields=["status"])

        errors, _warnings = validate_invoice_for_ksef(roz)
        roz_errors = [e for e in errors if "ROZ" in e and "zaliczkow" in e.lower()]
        self.assertEqual(roz_errors, [], f"Unexpected ROZ errors: {errors}")


# ─────────────────────────────────────────────────────────────────────────────
# P_IZ — payment received (informacja o zapłacie)
# ─────────────────────────────────────────────────────────────────────────────

class PaymentReceivedAtTests(TestCase):
    """Tests for payment_received_at → P_IZ / DataZaplaty in FA-3 XML."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="piz-user",
            email="piz@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(
            name="P_IZ Co",
            nip="9876543210",
            address="ul. Piekarska 1",
            city="Kraków",
            postal_code="31-000",
        )
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.customer = Customer.objects.create(
            name="P_IZ Cust",
            company=self.company,
            nip="1234567890",
        )

    def _make_invoice(self, payment_received_at=None, payment_method="cash"):
        from apps.invoices.services import create_manual_invoice
        inv = create_manual_invoice(
            customer=self.customer,
            company=self.company,
            user=self.user,
            items_data=[{
                "product_name": "Chleb",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "5.00",
                "vat_rate": "5",
            }],
            payment_method=payment_method,
            payment_received_at=payment_received_at,
        )
        inv.invoice_number = "FV/2026/0001"
        inv.status = Invoice.STATUS_ISSUED
        inv.save(update_fields=["invoice_number", "status"])
        return inv

    def test_no_p_iz_when_payment_received_at_not_set(self):
        from apps.ksef.xml_generator import generate_fa3_xml
        inv = self._make_invoice(payment_received_at=None, payment_method="transfer")
        xml = generate_fa3_xml(inv)
        self.assertNotIn("<P_IZ>", xml)
        self.assertNotIn("<DataZaplaty>", xml)

    def test_p_iz_present_when_payment_received_at_set(self):
        from apps.ksef.xml_generator import generate_fa3_xml
        inv = self._make_invoice(
            payment_received_at=date(2026, 9, 5),
            payment_method="cash",
        )
        xml = generate_fa3_xml(inv)
        self.assertIn("<P_IZ>1</P_IZ>", xml)
        self.assertIn("<DataZaplaty>2026-09-05</DataZaplaty>", xml)

    def test_p_iz_inside_platnosc_block(self):
        from apps.ksef.xml_generator import generate_fa3_xml
        inv = self._make_invoice(
            payment_received_at=date(2026, 9, 5),
            payment_method="cash",
        )
        xml = generate_fa3_xml(inv)
        platnosc_start = xml.index("<Platnosc>")
        platnosc_end = xml.index("</Platnosc>")
        platnosc_block = xml[platnosc_start:platnosc_end]
        self.assertIn("<P_IZ>1</P_IZ>", platnosc_block)
        self.assertIn("<DataZaplaty>2026-09-05</DataZaplaty>", platnosc_block)

    def test_create_manual_invoice_stores_payment_received_at(self):
        inv = self._make_invoice(
            payment_received_at=date(2026, 10, 1),
            payment_method="cash",
        )
        inv.refresh_from_db()
        self.assertEqual(inv.payment_received_at, date(2026, 10, 1))

    def test_create_manual_api_accepts_payment_received_at(self):
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        from apps.users.models import CompanyModule
        CompanyModule.objects.get_or_create(
            company=self.company, module="invoicing", defaults={"is_enabled": True}
        )
        client = APIClient()
        client.force_authenticate(user=self.user)
        r = client.post("/api/invoices/create-manual/", {
            "customer_id": str(self.customer.uuid),
            "items": [{
                "product_name": "Bułka",
                "product_unit": "szt",
                "quantity": "1",
                "unit_price_net": "1.50",
                "vat_rate": "5",
            }],
            "issue_date": "2026-09-10",
            "sale_date": "2026-09-10",
            "due_date": "2026-09-10",
            "payment_method": "cash",
            "payment_received_at": "2026-09-10",
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        inv = Invoice.objects.get(uuid=r.data["id"])
        self.assertEqual(str(inv.payment_received_at), "2026-09-10")
