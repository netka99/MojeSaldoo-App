from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.orders.models import Order
from apps.users.models import Company, CompanyMembership


class OrderApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="order-api-user",
            email="order-api@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="Buyer tenant")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])
        self.customer = Customer.objects.create(name="Buyer Co", company=self.co)
        Order.objects.create(
            customer=self.customer,
            company=self.co,
            order_date=date(2026, 4, 1),
            delivery_date=date(2026, 4, 10),
            status="draft",
            total=Decimal("100.00"),
        )

    def test_order_list_url_resolves(self):
        self.assertEqual(reverse("order-list"), "/api/orders/")

    def test_order_list_requires_authentication(self):
        response = self.client.get(reverse("order-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_order_list_authenticated_returns_results(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("order-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)
        self.assertGreaterEqual(response.data["count"], 1)
