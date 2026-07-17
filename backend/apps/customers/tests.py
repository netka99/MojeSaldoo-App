import io
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from openpyxl import Workbook
from rest_framework import status
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.customers.serializers import CustomerSerializer
from apps.users.models import Company, CompanyMembership


def _company_with_user(user, name_suffix="org"):
    co = Company.objects.create(name=f"{user.username} {name_suffix}")
    CompanyMembership.objects.create(user=user, company=co, role="admin", is_active=True)
    return co


class CustomerModelTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="customer-test-user",
            email="customer@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)

    def test_customer_creation_with_requested_fields(self):
        customer = Customer.objects.create(
            user=self.user,
            company=self.company,
            name="Sklep ABC",
            company_name="ABC Sp. z o.o.",
            nip="1234567890",
            email="abc@shop.pl",
            phone="+48123456789",
            street="Testowa 1",
            city="Warszawa",
            postal_code="00-001",
            country="PL",
            distance_km=15,
            delivery_days="Mon,Wed,Fri",
            payment_terms=14,
            credit_limit=Decimal("5000.00"),
            is_active=True,
        )

        self.assertIsInstance(customer.uuid, uuid.UUID)
        self.assertEqual(customer.user, self.user)
        self.assertEqual(customer.credit_limit, Decimal("5000.00"))
        self.assertEqual(customer.country, "PL")
        self.assertIsNotNone(customer.created_at)
        self.assertIsNotNone(customer.updated_at)

    def test_customer_defaults(self):
        co = Company.objects.create(name="Default Co")
        customer = Customer.objects.create(name="Default Customer", company=co)

        self.assertEqual(customer.country, "PL")
        self.assertEqual(customer.payment_terms, 14)
        self.assertEqual(customer.credit_limit, Decimal("0"))
        self.assertTrue(customer.is_active)


class CustomerSerializerTests(TestCase):
    def test_credit_limit_accepts_string_and_stores_decimal(self):
        serializer = CustomerSerializer(
            data={
                "name": "Credit Co",
                "credit_limit": "9999.99",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        co = Company.objects.create(name="Serializer Co")
        customer = serializer.save(company=co)

        self.assertEqual(customer.credit_limit, Decimal("9999.99"))

    def test_negative_distance_km_invalid(self):
        serializer = CustomerSerializer(
            data={
                "name": "Far",
                "distance_km": -1,
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("distance_km", serializer.errors)

    def test_negative_credit_limit_invalid(self):
        serializer = CustomerSerializer(
            data={
                "name": "Debt",
                "credit_limit": "-0.01",
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("credit_limit", serializer.errors)


class CustomerViewSetAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="api-cust-owner",
            email="api-co@test.com",
            password="test12345",
        )
        self.other = User.objects.create_user(
            username="api-cust-other",
            email="api-ct@test.com",
            password="test12345",
        )
        self.co_user = _company_with_user(self.user)
        self.co_other = _company_with_user(self.other)
        Customer.objects.create(user=self.user, company=self.co_user, name="My client")
        Customer.objects.create(user=self.other, company=self.co_other, name="Their client")
        self.user.current_company = self.co_user
        self.user.save(update_fields=["current_company"])
        self.other.current_company = self.co_other
        self.other.save(update_fields=["current_company"])

    def test_list_scoped_to_owner(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("customer-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"My client"})

    def test_search_matches_city_and_company_name(self):
        Customer.objects.create(
            user=self.user,
            company=self.co_user,
            name="Sklep",
            company_name="Gdańsk Retail Sp. z o.o.",
            city="Gdańsk",
        )
        self.client.force_authenticate(user=self.user)
        r_city = self.client.get(reverse("customer-list"), {"search": "Gdań"})
        self.assertEqual(r_city.status_code, status.HTTP_200_OK)
        names_city = {row["name"] for row in r_city.data["results"]}
        self.assertIn("Sklep", names_city)

        r_legal = self.client.get(reverse("customer-list"), {"search": "Retail"})
        self.assertEqual(r_legal.status_code, status.HTTP_200_OK)
        names_legal = {row["name"] for row in r_legal.data["results"]}
        self.assertIn("Sklep", names_legal)

    def test_create_assigns_current_user(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("customer-list"),
            {"name": "New client API"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        row = Customer.objects.get(uuid=response.data["id"])
        self.assertEqual(row.user, self.user)


def _make_customer_xlsx(rows: list[dict]) -> io.BytesIO:
    """Build a minimal in-memory XLSX with customer import columns."""
    wb = Workbook()
    ws = wb.active
    headers = ["Nazwa", "Nazwa firmy", "NIP", "Telefon", "Email",
               "Ulica", "Miasto", "Kod pocztowy", "Termin płatności (dni)"]
    ws.append(headers)
    for row in rows:
        ws.append([row.get(h, "") for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class CustomerImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="import-cust-user",
            email="importcust@test.com",
            password="test12345",
        )
        self.company = _company_with_user(self.user)
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)

    def _upload(self, rows, dry_run="true", filename="klienci.xlsx"):
        buf = _make_customer_xlsx(rows)
        buf.name = filename
        return self.client.post(
            reverse("customer-import-customers"),
            {"file": buf, "dry_run": dry_run},
            format="multipart",
        )

    def test_dry_run_returns_preview(self):
        r = self._upload([
            {"Nazwa": "Jan Kowalski", "Termin płatności (dni)": 14},
            {"Nazwa": "Firma ABC", "Termin płatności (dni)": 30},
        ])
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["dry_run"])
        self.assertEqual(r.data["to_create"], 2)
        self.assertEqual(r.data["to_update"], 0)
        self.assertEqual(Customer.objects.filter(company=self.company).count(), 0)

    def test_commit_creates_customers(self):
        r = self._upload([
            {"Nazwa": "Jan Kowalski", "Miasto": "Warszawa", "Termin płatności (dni)": 14},
        ], dry_run="false")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["created"], 1)
        self.assertEqual(r.data["updated"], 0)
        c = Customer.objects.get(company=self.company, name="Jan Kowalski")
        self.assertEqual(c.city, "Warszawa")

    def test_dedup_by_name_updates_existing(self):
        Customer.objects.create(company=self.company, user=self.user, name="Jan Kowalski", city="Kraków")
        r = self._upload([
            {"Nazwa": "Jan Kowalski", "Miasto": "Warszawa", "Termin płatności (dni)": 14},
        ], dry_run="false")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["created"], 0)
        self.assertEqual(r.data["updated"], 1)
        c = Customer.objects.get(company=self.company, name="Jan Kowalski")
        self.assertEqual(c.city, "Warszawa")

    def test_missing_name_returns_error(self):
        r = self._upload([{"Nazwa": "", "Termin płatności (dni)": 14}])
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["error_count"], 1)
        self.assertEqual(r.data["errors"][0]["field"], "Nazwa")

    def test_invalid_payment_terms_returns_error(self):
        r = self._upload([{"Nazwa": "Test", "Termin płatności (dni)": "notanumber"}])
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["error_count"], 1)

    def test_template_download(self):
        r = self.client.get(reverse("customer-import-template"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(
            r["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def test_unauthenticated_blocked(self):
        self.client.force_authenticate(user=None)
        buf = _make_customer_xlsx([{"Nazwa": "X", "Termin płatności (dni)": 14}])
        buf.name = "test.xlsx"
        r = self.client.post(reverse("customer-import-customers"), {"file": buf, "dry_run": "true"}, format="multipart")
        self.assertIn(r.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])
