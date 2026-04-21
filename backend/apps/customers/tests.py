import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.customers.models import Customer


class CustomerModelTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="customer-test-user",
            email="customer@test.com",
            password="test12345",
        )

    def test_customer_creation_with_requested_fields(self):
        customer = Customer.objects.create(
            user=self.user,
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
        customer = Customer.objects.create(name="Default Customer")

        self.assertEqual(customer.country, "PL")
        self.assertEqual(customer.payment_terms, 14)
        self.assertEqual(customer.credit_limit, Decimal("0"))
        self.assertTrue(customer.is_active)
