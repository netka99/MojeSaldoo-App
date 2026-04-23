import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
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

        self.assertIsInstance(customer.id, uuid.UUID)
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

    def test_create_assigns_current_user(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("customer-list"),
            {"name": "New client API"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        row = Customer.objects.get(id=response.data["id"])
        self.assertEqual(row.user, self.user)
