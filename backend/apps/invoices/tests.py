from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


class InvoiceApiTests(TestCase):
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

    def test_invoice_list_authenticated_returns_results(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("invoice-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)
