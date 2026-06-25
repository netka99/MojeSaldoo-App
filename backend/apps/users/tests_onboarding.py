"""Tests for POST /api/auth/onboarding/complete/ and related model changes."""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import Company, CompanyMembership, CompanyModule

User = get_user_model()


def _make_user_with_company(username: str) -> tuple:
    user = User.objects.create_user(
        username=username, email=f"{username}@test.com", password="pass1234"
    )
    company = Company.objects.create(name=f"{username} Co")
    CompanyMembership.objects.create(user=user, company=company, role="admin", is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    # Seed all module rows (disabled by default).
    for key, _ in CompanyModule.MODULE_CHOICES:
        CompanyModule.objects.get_or_create(company=company, module=key, defaults={"is_enabled": False})
    return user, company


class OnboardingCompleteTests(APITestCase):
    URL = "/api/auth/onboarding/complete/"

    def setUp(self):
        self.user, self.company = _make_user_with_company("ob-user")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    # ------------------------------------------------------------------ helpers

    def _post(self, tiles, delivery=None):
        return self.client.post(
            self.URL,
            {"activity_tiles": tiles, "delivery_method": delivery},
            format="json",
        )

    def _enabled(self):
        return set(
            CompanyModule.objects.filter(
                company=self.company, is_enabled=True
            ).values_list("module", flat=True)
        )

    # ------------------------------------------------------------------ auth

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        r = self._post([])
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)

    # ------------------------------------------------------------------ van selling

    def test_van_seller_tiles_activate_correct_modules(self):
        r = self._post(["purchasing"], "van_routes")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        enabled = self._enabled()
        self.assertIn("purchasing", enabled)
        self.assertIn("van_routes", enabled)
        self.assertIn("delivery", enabled)
        self.assertIn("ksef_inbox", enabled)

    def test_van_seller_company_type(self):
        r = self._post(["purchasing"], "van_routes")
        self.assertEqual(r.data["company_type"], Company.COMPANY_TYPE_VAN)

    # ------------------------------------------------------------------ production

    def test_producer_tiles_activate_correct_modules(self):
        r = self._post(["production", "purchasing"], "delivery")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        enabled = self._enabled()
        self.assertIn("production", enabled)
        self.assertIn("warehouses", enabled)
        self.assertIn("products", enabled)
        self.assertIn("purchasing", enabled)
        self.assertIn("delivery", enabled)

    def test_producer_company_type(self):
        r = self._post(["production"], "delivery")
        self.assertEqual(r.data["company_type"], Company.COMPANY_TYPE_PRODUCTION)

    # ------------------------------------------------------------------ invoicing only

    def test_invoicing_only_no_warehouse_modules(self):
        r = self._post([], None)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        enabled = self._enabled()
        # Core modules always enabled.
        self.assertIn("invoicing", enabled)
        self.assertIn("ksef", enabled)
        # Warehouse/van modules NOT enabled.
        self.assertNotIn("van_routes", enabled)
        self.assertNotIn("warehouses", enabled)
        self.assertNotIn("production", enabled)

    def test_invoicing_only_company_type(self):
        r = self._post([], None)
        self.assertEqual(r.data["company_type"], Company.COMPANY_TYPE_INVOICING)

    # ------------------------------------------------------------------ cost annotation unlocks ksef_inbox

    def test_cost_annotation_unlocks_ksef_inbox(self):
        r = self._post(["cost_allocation"], None)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("ksef_inbox", self._enabled())
        self.assertIn("cost_allocation", self._enabled())

    # ------------------------------------------------------------------ warehouse

    def test_warehouse_tile_activates_warehouse_and_products(self):
        r = self._post(["warehouses"], "docs_only")
        enabled = self._enabled()
        self.assertIn("warehouses", enabled)
        self.assertIn("products", enabled)

    def test_warehouse_company_type(self):
        r = self._post(["purchasing", "warehouses"], "docs_only")
        self.assertEqual(r.data["company_type"], Company.COMPANY_TYPE_WAREHOUSE)

    # ------------------------------------------------------------------ onboarding_completed flag

    def test_onboarding_completed_flag_set(self):
        self._post(["purchasing"], "van_routes")
        self.company.refresh_from_db()
        self.assertTrue(self.company.onboarding_completed)

    def test_onboarding_completed_initially_false(self):
        self.assertFalse(self.company.onboarding_completed)

    # ------------------------------------------------------------------ response shape

    def test_response_contains_modules_dict(self):
        r = self._post(["purchasing"], "van_routes")
        self.assertIn("modules", r.data)
        self.assertIn("van_routes", r.data["modules"])
        self.assertTrue(r.data["modules"]["van_routes"])

    # ------------------------------------------------------------------ me endpoint returns new fields

    def test_me_endpoint_returns_onboarding_completed(self):
        self._post(["purchasing"], "van_routes")
        r = self.client.get("/api/auth/me/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("onboarding_completed", r.data["user"])
        self.assertTrue(r.data["user"]["onboarding_completed"])

    def test_me_endpoint_returns_company_type(self):
        self._post(["purchasing"], "van_routes")
        r = self.client.get("/api/auth/me/")
        self.assertEqual(r.data["user"]["company_type"], Company.COMPANY_TYPE_VAN)

    def test_me_endpoint_returns_modules_dict(self):
        self._post(["production"], None)
        r = self.client.get("/api/auth/me/")
        modules = r.data["user"]["modules"]
        self.assertIsInstance(modules, dict)
        self.assertTrue(modules.get("production"))
        self.assertFalse(modules.get("van_routes"))

    # ------------------------------------------------------------------ validation

    def test_invalid_tile_returns_400(self):
        r = self._post(["bogus_tile"], None)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_delivery_method_returns_400(self):
        r = self._post([], "teleport")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_current_company_returns_400(self):
        user2 = User.objects.create_user(username="no-co", email="noco@t.com", password="x")
        self.client.force_authenticate(user=user2)
        r = self._post([], None)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
