import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from apps.users.models import Company, CompanyMembership, CompanyModule, CompanyRole, CompanyWorkflowSettings
from apps.users.permissions import IsCompanyAdmin, IsCompanyMember


class CompanyCreateAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="co-create",
            email="co-create@test.com",
            password="test12345",
        )

    def test_create_creates_admin_membership(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("company-create"),
            {
                "name": "NewCo",
                "nip": "0987654321",
                "address": "ul. Test 1",
                "city": "Warszawa",
                "postal_code": "00-001",
                "email": "new@co.test",
                "phone": "+48111222333",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        cid = response.data["id"]
        co = Company.objects.get(uuid=cid)
        self.assertEqual(co.name, "NewCo")
        self.assertEqual(co.city, "Warszawa")
        self.assertEqual(co.postal_code, "00-001")
        self.assertIn("created_at", response.data)
        m = CompanyMembership.objects.get(user=self.user, company=co)
        self.assertEqual(m.role, "admin")

    def test_anonymous_forbidden(self):
        response = self.client.post(
            reverse("company-create"),
            {"name": "X"},
            format="json",
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class CompanyMeListAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="me-list-u",
            email="me-list@test.com",
            password="test12345",
        )
        self.c1 = Company.objects.create(name="Alpha")
        self.c2 = Company.objects.create(name="Beta")
        CompanyMembership.objects.create(
            user=self.user, company=self.c1, role="viewer", is_active=True
        )
        CompanyMembership.objects.create(
            user=self.user, company=self.c2, role="admin", is_active=True
        )

    def test_me_returns_only_member_companies(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("company-me-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {row["name"] for row in response.data}
        self.assertEqual(names, {"Alpha", "Beta"})

    def test_me_excludes_other_users_companies(self):
        outsider = get_user_model().objects.create_user(
            username="other",
            email="other@test.com",
            password="x",
        )
        alone = Company.objects.create(name="Secret")
        CompanyMembership.objects.create(
            user=outsider, company=alone, role="admin", is_active=True
        )
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("company-me-list"))
        names = {row["name"] for row in response.data}
        self.assertNotIn("Secret", names)


class CompanyDetailAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="detail-user",
            email="detail@test.com",
            password="test12345",
        )
        self.other = User.objects.create_user(
            username="detail-other",
            email="detail-o@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(
            name="StartName",
            nip="",
            address="A 1",
            city="Gdańsk",
            postal_code="80-000",
        )
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="viewer", is_active=True
        )

    def _url(self, pk=None):
        return reverse("company-detail", kwargs={"pk": pk or self.company.uuid})

    def test_get_member_200(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["name"], "StartName")
        self.assertEqual(r.data["city"], "Gdańsk")

    def test_get_non_member_404(self):
        self.client.force_authenticate(user=self.other)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_anonymous_401(self):
        r = self.client.get(self._url())
        self.assertIn(
            r.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
        )

    def test_patch_member_updates(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.patch(
            self._url(),
            {"name": "NewName", "city": "Sopot", "postal_code": "81-001"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["name"], "NewName")
        self.company.refresh_from_db()
        self.assertEqual(self.company.name, "NewName")
        self.assertEqual(self.company.city, "Sopot")

    def test_patch_non_member_404(self):
        self.client.force_authenticate(user=self.other)
        r = self.client.patch(
            self._url(),
            {"name": "Hacked"},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)


class CompanyModulesAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="mod-admin",
            email="mod-a@test.com",
            password="test12345",
        )
        self.manager = User.objects.create_user(
            username="mod-mgr",
            email="mod-m@test.com",
            password="test12345",
        )
        self.viewer = User.objects.create_user(
            username="mod-view",
            email="mod-v@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="ModCo")
        CompanyMembership.objects.create(
            user=self.admin,
            company=self.company,
            role="admin",
            is_active=True,
        )
        CompanyMembership.objects.create(
            user=self.manager,
            company=self.company,
            role="manager",
            is_active=True,
        )
        CompanyMembership.objects.create(
            user=self.viewer,
            company=self.company,
            role="viewer",
            is_active=True,
        )

    def _modules_url(self):
        return reverse(
            "company-modules-list",
            kwargs={"company_id": self.company.uuid},
        )

    def _module_patch_url(self, module_key: str):
        return reverse(
            "company-module-enable",
            kwargs={"company_id": self.company.uuid, "module_key": module_key},
        )

    def test_list_seeds_modules(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(self._modules_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), len(CompanyModule.MODULE_CHOICES))
        modules = {row["module"] for row in response.data}
        self.assertEqual(modules, {k for k, _ in CompanyModule.MODULE_CHOICES})

    def test_list_forbidden_non_member(self):
        outsider = get_user_model().objects.create_user(
            username="mod-out",
            email="mod-o@test.com",
            password="test12345",
        )
        self.client.force_authenticate(user=outsider)
        response = self.client.get(self._modules_url())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_patch_admin_sets_enabled(self):
        self.client.force_authenticate(user=self.admin)
        self.client.get(self._modules_url())
        response = self.client.patch(
            self._module_patch_url("products"),
            {"is_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_enabled"])
        row = CompanyModule.objects.get(company=self.company, module="products")
        self.assertTrue(row.is_enabled)
        self.assertIsNotNone(row.enabled_at)

    def test_patch_disable_clears_enabled_at(self):
        self.client.force_authenticate(user=self.admin)
        self.client.get(self._modules_url())
        self.client.patch(
            self._module_patch_url("orders"),
            {"is_enabled": True},
            format="json",
        )
        response = self.client.patch(
            self._module_patch_url("orders"),
            {"is_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = CompanyModule.objects.get(company=self.company, module="orders")
        self.assertFalse(row.is_enabled)
        self.assertIsNone(row.enabled_at)

    def test_patch_manager_allowed(self):
        self.client.force_authenticate(user=self.manager)
        self.client.get(self._modules_url())
        response = self.client.patch(
            self._module_patch_url("customers"),
            {"is_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_patch_viewer_forbidden(self):
        self.client.force_authenticate(user=self.admin)
        self.client.get(self._modules_url())
        self.client.force_authenticate(user=self.viewer)
        response = self.client.patch(
            self._module_patch_url("ksef"),
            {"is_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_patch_unknown_module_bad_request(self):
        self.client.force_authenticate(user=self.admin)
        self.client.get(self._modules_url())
        response = self.client.patch(
            reverse(
                "company-module-enable",
                kwargs={
                    "company_id": self.company.uuid,
                    "module_key": "not-a-module",
                },
            ),
            {"is_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_missing_is_enabled(self):
        self.client.force_authenticate(user=self.admin)
        self.client.get(self._modules_url())
        response = self.client.patch(
            self._module_patch_url("invoicing"),
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class SwitchCompanyViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="switch-u",
            email="switch-u@test.com",
            password="test12345",
        )
        self.co_a = Company.objects.create(name="Co A")
        self.co_b = Company.objects.create(name="Co B")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co_a,
            role="viewer",
            is_active=True,
        )
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co_b,
            role="admin",
            is_active=True,
        )

    def test_switch_sets_current_company(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("company-switch"),
            {"company": str(self.co_b.uuid)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["current_company"], str(self.co_b.uuid))
        self.user.refresh_from_db()
        self.assertEqual(self.user.current_company_id, self.co_b.pk)

    def test_switch_forbidden_not_member(self):
        self.client.force_authenticate(user=self.user)
        foreign = Company.objects.create(name="Foreign")
        response = self.client.post(
            reverse("company-switch"),
            {"company": str(foreign.uuid)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_switch_404_unknown_company(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("company-switch"),
            {"company": str(uuid.uuid4())},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class CurrentUserIncludesCurrentCompanyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="me-user",
            email="me-user@test.com",
            password="test12345",
        )
        self.co = Company.objects.create(name="MeCo")
        CompanyMembership.objects.create(
            user=self.user,
            company=self.co,
            role="admin",
            is_active=True,
        )
        self.user.current_company = self.co
        self.user.save(update_fields=["current_company"])

    def test_me_returns_current_company_uuid(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("current_user"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["current_company"], str(self.co.uuid))
        self.assertEqual(response.data["user"]["current_company_role"], "admin")

    def test_me_returns_null_current_company_role_without_current_company(self):
        self.user.current_company = None
        self.user.save(update_fields=["current_company"])
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("current_user"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["user"]["current_company"])
        self.assertIsNone(response.data["user"]["current_company_role"])


class CompanyPermissionTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="perm-user",
            email="perm@test.com",
            password="test12345",
        )
        self.company = Company.objects.create(name="PermCo")

    def _request(self, user):
        request = self.factory.get("/")
        request.user = user
        return request

    def test_is_company_member_anonymous_denied(self):
        self.assertFalse(
            IsCompanyMember().has_permission(self._request(AnonymousUser()), None)
        )

    def test_is_company_member_no_current_company_denied(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="viewer", is_active=True
        )
        self.assertFalse(IsCompanyMember().has_permission(self._request(self.user), None))

    def test_is_company_member_active_membership_allowed(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="viewer", is_active=True
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.assertTrue(IsCompanyMember().has_permission(self._request(self.user), None))

    def test_is_company_member_inactive_membership_denied(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="viewer", is_active=False
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.assertFalse(IsCompanyMember().has_permission(self._request(self.user), None))

    def test_is_company_member_wrong_company_denied(self):
        other = Company.objects.create(name="Other")
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="viewer", is_active=True
        )
        self.user.current_company = other
        self.user.save(update_fields=["current_company"])
        self.assertFalse(IsCompanyMember().has_permission(self._request(self.user), None))

    def test_is_company_admin_requires_member(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.assertFalse(IsCompanyAdmin().has_permission(self._request(self.user), None))

    def test_is_company_admin_allowed(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="admin", is_active=True
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.assertTrue(IsCompanyAdmin().has_permission(self._request(self.user), None))

    def test_is_company_admin_manager_denied(self):
        CompanyMembership.objects.create(
            user=self.user, company=self.company, role="manager", is_active=True
        )
        self.user.current_company = self.company
        self.user.save(update_fields=["current_company"])
        self.assertFalse(IsCompanyAdmin().has_permission(self._request(self.user), None))


class FCMTokenAPITests(TestCase):
    """Tests for POST/DELETE /api/auth/fcm-token/"""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="fcm-user",
            email="fcm@test.com",
            password="test12345",
        )
        self.url = reverse("fcm_token")

    def test_register_token_creates_record(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(self.url, {"token": "abc123", "device_name": "iPhone 14"})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["registered"])
        self.assertTrue(response.data["created"])

    def test_register_same_token_returns_200(self):
        self.client.force_authenticate(user=self.user)
        self.client.post(self.url, {"token": "dup-token"})
        response = self.client.post(self.url, {"token": "dup-token"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["created"])

    def test_register_token_without_auth_returns_401(self):
        response = self.client.post(self.url, {"token": "abc"})
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_register_missing_token_returns_400(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(self.url, {})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_token_removes_record(self):
        from apps.users.models import FCMDeviceToken
        self.client.force_authenticate(user=self.user)
        self.client.post(self.url, {"token": "del-token"})
        self.assertEqual(FCMDeviceToken.objects.filter(token="del-token").count(), 1)
        response = self.client.delete(self.url, {"token": "del-token"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["unregistered"])
        self.assertEqual(FCMDeviceToken.objects.filter(token="del-token").count(), 0)

    def test_delete_nonexistent_token_returns_false(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.delete(self.url, {"token": "never-existed"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["unregistered"])


class WebPushSubscriptionAPITests(TestCase):
    """Tests for POST/DELETE /api/auth/push-subscription/ and GET /api/auth/push-public-key/"""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="push-user",
            email="push@test.com",
            password="test12345",
        )
        self.sub_url = reverse("push_subscription")
        self.key_url = reverse("push_public_key")
        self.valid_sub = {
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtZ5MZwEMlGBnB7nzTcq5F0tJ9kpLweb4NHgEiO6mFRWFlq8DM_q9iBCKGOd4Q",
            "auth": "tBHItJI5svbpez7KI4CCXg",
        }

    def test_register_subscription_creates_record(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(self.sub_url, self.valid_sub)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["registered"])
        self.assertTrue(response.data["created"])

    def test_register_same_endpoint_returns_200(self):
        self.client.force_authenticate(user=self.user)
        self.client.post(self.sub_url, self.valid_sub)
        response = self.client.post(self.sub_url, self.valid_sub)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["created"])

    def test_register_without_auth_returns_401(self):
        response = self.client.post(self.sub_url, self.valid_sub)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_register_missing_fields_returns_400(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(self.sub_url, {"endpoint": "https://example.com"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_subscription_removes_record(self):
        from apps.users.models import WebPushSubscription
        self.client.force_authenticate(user=self.user)
        self.client.post(self.sub_url, self.valid_sub)
        self.assertEqual(WebPushSubscription.objects.filter(user=self.user).count(), 1)
        response = self.client.delete(self.sub_url, {"endpoint": self.valid_sub["endpoint"]})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["unregistered"])
        self.assertEqual(WebPushSubscription.objects.filter(user=self.user).count(), 0)

    def test_delete_nonexistent_returns_false(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.delete(self.sub_url, {"endpoint": "https://never.existed"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["unregistered"])

    def test_public_key_returns_vapid_key(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(self.key_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("public_key", response.data)
        self.assertTrue(len(response.data["public_key"]) > 10)


# ---------------------------------------------------------------------------
# Team management: CompanyRole + Members
# ---------------------------------------------------------------------------

def _make_company_with_admin(username, email="admin@test.com", company_name=None, nip=None):
    """Create a company with an admin user and the Administrator role."""
    User = get_user_model()
    admin = User.objects.create_user(username=username, email=email, password="test12345")
    company = Company.objects.create(name=company_name or f"{username}_co", nip=nip)
    admin_role = CompanyRole.objects.create(company=company, name="Administrator", is_admin=True)
    CompanyMembership.objects.create(
        user=admin, company=company, role="admin", company_role=admin_role, is_active=True
    )
    admin.current_company = company
    admin.save(update_fields=["current_company"])
    return admin, company, admin_role


class CompanyRolesAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, self.admin_role = _make_company_with_admin(
            "role-admin", "role-admin@test.com"
        )
        User = get_user_model()
        self.viewer_user = User.objects.create_user(
            username="role-viewer", email="role-viewer@test.com", password="test12345"
        )
        self.viewer_role = CompanyRole.objects.create(
            company=self.company, name="Pracownik", is_admin=False, can_see_prices=False
        )
        CompanyMembership.objects.create(
            user=self.viewer_user, company=self.company, role="viewer",
            company_role=self.viewer_role, is_active=True
        )
        self.viewer_user.current_company = self.company
        self.viewer_user.save(update_fields=["current_company"])

    def _list_url(self):
        return reverse("company-roles-list", kwargs={"company_id": self.company.uuid})

    def _detail_url(self, role_id):
        return reverse("company-role-detail", kwargs={"company_id": self.company.uuid, "role_id": role_id})

    def test_list_returns_all_roles(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self._list_url())
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        names = {row["name"] for row in r.data}
        self.assertIn("Administrator", names)
        self.assertIn("Pracownik", names)

    def test_list_allowed_for_any_member(self):
        self.client.force_authenticate(user=self.viewer_user)
        r = self.client.get(self._list_url())
        self.assertEqual(r.status_code, status.HTTP_200_OK)

    def test_create_role_by_admin(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(
            self._list_url(),
            {"name": "Kierowca", "can_access_routes": True, "can_manage_delivery": True, "can_see_prices": False},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["name"], "Kierowca")
        self.assertFalse(r.data["can_see_prices"])
        self.assertTrue(r.data["can_access_routes"])

    def test_create_role_forbidden_for_non_admin(self):
        self.client.force_authenticate(user=self.viewer_user)
        r = self.client.post(self._list_url(), {"name": "X"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_duplicate_name_rejected(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self._list_url(), {"name": "Pracownik"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_role_permissions(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(
            self._detail_url(self.viewer_role.pk),
            {"can_see_prices": True, "can_manage_orders": True},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["can_see_prices"])
        self.viewer_role.refresh_from_db()
        self.assertTrue(self.viewer_role.can_see_prices)

    def test_patch_admin_role_rejected(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(
            self._detail_url(self.admin_role.pk),
            {"can_see_prices": False},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_role_with_no_members(self):
        empty_role = CompanyRole.objects.create(company=self.company, name="Empty")
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(self._detail_url(empty_role.pk))
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(CompanyRole.objects.filter(pk=empty_role.pk).exists())

    def test_delete_role_with_members_rejected(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(self._detail_url(self.viewer_role.pk))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_admin_role_rejected(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(self._detail_url(self.admin_role.pk))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


class CompanyMembersAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, self.admin_role = _make_company_with_admin(
            "mem-admin", "mem-admin@test.com"
        )
        self.worker_role = CompanyRole.objects.create(
            company=self.company, name="Pracownik",
            can_manage_delivery=True, can_see_prices=False,
        )

    def _list_url(self):
        return reverse("company-members-list", kwargs={"company_id": self.company.uuid})

    def _detail_url(self, m_id):
        return reverse("company-member-detail", kwargs={"company_id": self.company.uuid, "membership_id": m_id})

    def test_list_members_by_admin(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self._list_url())
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(len(r.data), 1)  # just admin

    def test_list_members_forbidden_for_non_admin(self):
        User = get_user_model()
        viewer = User.objects.create_user(username="mem-viewer", email="mem-v@test.com", password="x")
        CompanyMembership.objects.create(
            user=viewer, company=self.company, role="viewer", company_role=self.worker_role, is_active=True
        )
        viewer.current_company = self.company
        viewer.save(update_fields=["current_company"])
        self.client.force_authenticate(user=viewer)
        r = self.client.get(self._list_url())
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_add_member_creates_user_and_membership(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(
            self._list_url(),
            {
                "username": "jan.kowalski",
                "email": "jan@firma.pl",
                "first_name": "Jan",
                "last_name": "Kowalski",
                "password": "haslo12345",
                "company_role_id": str(self.worker_role.pk),
            },
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data["user"]["username"], "jan.kowalski")
        self.assertEqual(r.data["company_role"]["name"], "Pracownik")
        self.assertTrue(get_user_model().objects.filter(username="jan.kowalski").exists())

    def test_add_member_duplicate_username_rejected(self):
        self.client.force_authenticate(user=self.admin)
        # Add once
        self.client.post(self._list_url(), {
            "username": "dup-user", "email": "dup@co.pl",
            "first_name": "D", "last_name": "U", "password": "haslo12345",
            "company_role_id": str(self.worker_role.pk),
        }, format="json")
        # Try again with same username
        r = self.client.post(self._list_url(), {
            "username": "dup-user", "email": "dup2@co.pl",
            "first_name": "D", "last_name": "U", "password": "haslo12345",
            "company_role_id": str(self.worker_role.pk),
        }, format="json")
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_member_role(self):
        User = get_user_model()
        worker = User.objects.create_user(username="mem-w2", email="w2@co.pl", password="x")
        m = CompanyMembership.objects.create(
            user=worker, company=self.company, role="viewer", company_role=self.worker_role, is_active=True
        )
        new_role = CompanyRole.objects.create(company=self.company, name="Magazynier", can_manage_products=True)
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(
            self._detail_url(m.uuid),
            {"company_role_id": str(new_role.pk)},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertEqual(r.data["company_role"]["name"], "Magazynier")

    def test_remove_member_deactivates(self):
        User = get_user_model()
        worker = User.objects.create_user(username="mem-del", email="del@co.pl", password="x")
        m = CompanyMembership.objects.create(
            user=worker, company=self.company, role="viewer", company_role=self.worker_role, is_active=True
        )
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(self._detail_url(m.uuid))
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)
        m.refresh_from_db()
        self.assertFalse(m.is_active)

    def test_cannot_remove_self(self):
        admin_m = CompanyMembership.objects.get(user=self.admin, company=self.company)
        self.client.force_authenticate(user=self.admin)
        r = self.client.delete(self._detail_url(admin_m.uuid))
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)


class UserPermissionsInSerializerTests(TestCase):
    """Verify /auth/me/ returns is_company_admin and permissions fields."""

    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, _ = _make_company_with_admin(
            "perm-ser-admin", "perm-ser@test.com"
        )
        worker_role = CompanyRole.objects.create(
            company=self.company, name="Pracownik",
            can_see_prices=False, can_manage_delivery=True,
        )
        User = get_user_model()
        self.worker = User.objects.create_user(
            username="perm-worker", email="perm-w@test.com", password="test12345"
        )
        CompanyMembership.objects.create(
            user=self.worker, company=self.company, role="viewer",
            company_role=worker_role, is_active=True,
        )
        self.worker.current_company = self.company
        self.worker.save(update_fields=["current_company"])

    def test_admin_is_company_admin_true(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["user"]["is_company_admin"])
        self.assertTrue(r.data["user"]["permissions"]["can_manage_team"])
        self.assertTrue(r.data["user"]["permissions"]["can_see_prices"])

    def test_worker_is_company_admin_false(self):
        self.client.force_authenticate(user=self.worker)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(r.data["user"]["is_company_admin"])
        self.assertFalse(r.data["user"]["permissions"]["can_see_prices"])
        self.assertTrue(r.data["user"]["permissions"]["can_manage_delivery"])

    def test_company_create_creates_administrator_role(self):
        User = get_user_model()
        u = User.objects.create_user(username="role-create-test", email="rct@test.com", password="test12345")
        self.client.force_authenticate(user=u)
        r = self.client.post(reverse("company-create"), {"name": "NewCo2"}, format="json")
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        cid = r.data["id"]
        self.assertTrue(CompanyRole.objects.filter(company__uuid=cid, is_admin=True, name="Administrator").exists())

    def test_new_permission_flags_present_in_serializer(self):
        """can_access_ksef_inbox and can_manage_stock_moves appear in permissions dict."""
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, 200)
        perms = r.data["user"]["permissions"]
        self.assertIn("can_access_ksef_inbox", perms)
        self.assertIn("can_manage_stock_moves", perms)
        # Admin role has all permissions True
        self.assertTrue(perms["can_access_ksef_inbox"])
        self.assertTrue(perms["can_manage_stock_moves"])

    def test_worker_new_flags_default_false(self):
        """New flags default to False for non-admin roles."""
        self.client.force_authenticate(user=self.worker)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, 200)
        perms = r.data["user"]["permissions"]
        self.assertFalse(perms["can_access_ksef_inbox"])


# ---------------------------------------------------------------------------
# Account deletion tests
# ---------------------------------------------------------------------------

User = get_user_model()


class CompanyDeleteAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, self.admin_role = _make_company_with_admin(
            "del-admin", "del-admin@test.com", "Alpha Corp", "9990000001"
        )
        self.non_admin = User.objects.create_user(
            username="del-viewer", email="del-viewer@test.com", password="pass1234"
        )
        viewer_role = CompanyRole.objects.create(
            company=self.company, name="Viewer", is_admin=False
        )
        CompanyMembership.objects.create(
            user=self.non_admin, company=self.company, role="viewer",
            company_role=viewer_role, is_active=True
        )

    def _url(self):
        return reverse("company-delete", kwargs={"company_id": self.company.uuid})

    def test_admin_can_delete_with_correct_name(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(
            self._url(), {"confirm_name": "Alpha Corp"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.company.refresh_from_db()
        self.assertIsNotNone(self.company.deleted_at)
        self.assertFalse(self.company.is_active)
        self.assertFalse(
            CompanyMembership.objects.filter(company=self.company).exists()
        )

    def test_wrong_confirm_name_rejected(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(
            self._url(), {"confirm_name": "Wrong Name"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.company.refresh_from_db()
        self.assertIsNone(self.company.deleted_at)

    def test_non_admin_cannot_delete(self):
        self.client.force_authenticate(user=self.non_admin)
        response = self.client.delete(
            self._url(), {"confirm_name": "Alpha Corp"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.company.refresh_from_db()
        self.assertIsNone(self.company.deleted_at)

    def test_anonymous_cannot_delete(self):
        response = self.client.delete(
            self._url(), {"confirm_name": "Alpha Corp"}, format="json"
        )
        self.assertIn(response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_ksef_certificate_deleted(self):
        from apps.users.models import KSeFCertificate
        KSeFCertificate.objects.create(
            company=self.company,
            uploaded_by=self.admin,
            certificate_pem="FAKEPEM",
            encrypted_key="FAKEKEY",
        )
        self.client.force_authenticate(user=self.admin)
        self.client.delete(self._url(), {"confirm_name": "Alpha Corp"}, format="json")
        self.assertFalse(KSeFCertificate.objects.filter(company=self.company).exists())

    def test_admin_user_anonymized_after_deletion(self):
        """Admin who has no other company memberships gets anonymized."""
        self.client.force_authenticate(user=self.admin)
        self.client.delete(self._url(), {"confirm_name": "Alpha Corp"}, format="json")
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_active)
        self.assertIn("deleted_", self.admin.username)

    def test_deleted_company_not_in_me_list(self):
        self.client.force_authenticate(user=self.admin)
        self.client.delete(self._url(), {"confirm_name": "Alpha Corp"}, format="json")
        # Create a fresh user with a second company to test the list
        user2, company2, _ = _make_company_with_admin(
            "del-list-u", "del-list@test.com", "Beta Corp", "9990000002"
        )
        self.client.force_authenticate(user=user2)
        r = self.client.get(reverse("company-me-list"))
        ids = [str(c["id"]) for c in r.data]
        self.assertNotIn(str(self.company.uuid), ids)
        self.assertIn(str(company2.uuid), ids)


class CompanyLeaveAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, self.admin_role = _make_company_with_admin(
            "leave-admin", "leave-admin@test.com", "LeaveCorp", "9990000003"
        )
        self.member = User.objects.create_user(
            username="leave-member", email="leave-member@test.com", password="pass1234"
        )
        member_role = CompanyRole.objects.create(
            company=self.company, name="Pracownik", is_admin=False
        )
        CompanyMembership.objects.create(
            user=self.member, company=self.company, role="viewer",
            company_role=member_role, is_active=True
        )

    def _url(self):
        return reverse("company-leave", kwargs={"company_id": self.company.uuid})

    def test_member_can_leave(self):
        self.client.force_authenticate(user=self.member)
        response = self.client.delete(self._url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(
            CompanyMembership.objects.filter(user=self.member, company=self.company).exists()
        )

    def test_sole_admin_cannot_leave(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self._url())
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            CompanyMembership.objects.filter(user=self.admin, company=self.company).exists()
        )

    def test_second_admin_can_leave(self):
        second_admin = User.objects.create_user(
            username="leave-admin2", email="leave-admin2@test.com", password="pass1234"
        )
        CompanyMembership.objects.create(
            user=second_admin, company=self.company, role="admin",
            company_role=self.admin_role, is_active=True
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self._url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(
            CompanyMembership.objects.filter(user=self.admin, company=self.company).exists()
        )

    def test_nonmember_cannot_leave(self):
        outsider = User.objects.create_user(
            username="leave-out", email="leave-out@test.com", password="pass1234"
        )
        self.client.force_authenticate(user=outsider)
        response = self.client.delete(self._url())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_member_anonymized_if_no_other_memberships(self):
        """Member with no other companies gets anonymized after leaving."""
        self.client.force_authenticate(user=self.member)
        self.client.delete(self._url())
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)
        self.assertIn("deleted_", self.member.username)


class WorkflowSettingsAPITests(TestCase):
    """GET + PATCH /api/companies/{id}/workflow-settings/ — auto_wz_on_order field."""

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="wf-admin", email="wf-admin@test.com", password="test12345",
        )
        self.member = User.objects.create_user(
            username="wf-member", email="wf-member@test.com", password="test12345",
        )
        self.co = Company.objects.create(name="WF Test Co")
        CompanyMembership.objects.create(user=self.admin, company=self.co, role="admin", is_active=True)
        CompanyMembership.objects.create(user=self.member, company=self.co, role="member", is_active=True)
        self.admin.current_company = self.co
        self.admin.save(update_fields=["current_company"])
        self.member.current_company = self.co
        self.member.save(update_fields=["current_company"])
        self.url = reverse("company-workflow-settings", kwargs={"company_id": str(self.co.uuid)})

    def test_get_returns_auto_wz_on_order_field(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("auto_wz_on_order", r.data)
        self.assertFalse(r.data["auto_wz_on_order"])  # default is False

    def test_patch_auto_wz_on_order_true(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(self.url, {"auto_wz_on_order": True}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["auto_wz_on_order"])
        self.assertTrue(CompanyWorkflowSettings.objects.get(company=self.co).auto_wz_on_order)

    def test_patch_auto_wz_on_order_false(self):
        CompanyWorkflowSettings.objects.update_or_create(
            company=self.co, defaults={"auto_wz_on_order": True},
        )
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(self.url, {"auto_wz_on_order": False}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(r.data["auto_wz_on_order"])

    def test_non_admin_cannot_patch(self):
        self.client.force_authenticate(user=self.member)
        r = self.client.patch(self.url, {"auto_wz_on_order": True}, format="json")
        self.assertIn(r.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    # ------------------------------------------------------------------
    # auto_deliver_wz tests
    # ------------------------------------------------------------------

    def test_get_returns_auto_deliver_wz_field(self):
        """Response includes auto_deliver_wz defaulting to False."""
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertIn("auto_deliver_wz", r.data)
        self.assertFalse(r.data["auto_deliver_wz"])

    def test_patch_auto_deliver_wz_true(self):
        """PATCH auto_deliver_wz=True persists the value."""
        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(self.url, {"auto_deliver_wz": True}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["auto_deliver_wz"])
        self.assertTrue(CompanyWorkflowSettings.objects.get(company=self.co).auto_deliver_wz)

    def test_enabling_auto_deliver_wz_closes_open_wz_documents(self):
        """When auto_deliver_wz is switched on all saved/in_transit WZ become delivered."""
        from datetime import date as _date
        from apps.customers.models import Customer
        from apps.delivery.models import DeliveryDocument
        from apps.products.models import Warehouse

        customer = Customer.objects.create(name="Test Customer", company=self.co)
        wh = Warehouse.objects.create(
            user=self.admin,
            company=self.co,
            code="MG",
            name="Main",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        wz_saved = DeliveryDocument.objects.create(
            company=self.co,
            user=self.admin,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            from_warehouse=wh,
            to_customer=customer,
            issue_date=_date(2026, 10, 1),
            status=DeliveryDocument.STATUS_SAVED,
        )
        wz_transit = DeliveryDocument.objects.create(
            company=self.co,
            user=self.admin,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            from_warehouse=wh,
            to_customer=customer,
            issue_date=_date(2026, 10, 1),
            status=DeliveryDocument.STATUS_IN_TRANSIT,
        )
        wz_draft = DeliveryDocument.objects.create(
            company=self.co,
            user=self.admin,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            from_warehouse=wh,
            to_customer=customer,
            issue_date=_date(2026, 10, 1),
            status=DeliveryDocument.STATUS_DRAFT,
        )

        self.client.force_authenticate(user=self.admin)
        r = self.client.patch(self.url, {"auto_deliver_wz": True}, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK)

        wz_saved.refresh_from_db()
        wz_transit.refresh_from_db()
        wz_draft.refresh_from_db()

        self.assertEqual(wz_saved.status, DeliveryDocument.STATUS_DELIVERED)
        self.assertEqual(wz_transit.status, DeliveryDocument.STATUS_DELIVERED)
        # Draft WZ should NOT be auto-closed
        self.assertEqual(wz_draft.status, DeliveryDocument.STATUS_DRAFT)

    def test_enabling_auto_deliver_wz_does_not_close_already_delivered(self):
        """Already delivered WZ are untouched when toggling auto_deliver_wz."""
        from datetime import date as _date
        from apps.customers.models import Customer
        from apps.delivery.models import DeliveryDocument
        from apps.products.models import Warehouse
        from django.utils import timezone

        customer = Customer.objects.create(name="Test Customer2", company=self.co)
        wh = Warehouse.objects.create(
            user=self.admin,
            company=self.co,
            code="MGX",
            name="MainX",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        original_dt = timezone.now()
        wz_delivered = DeliveryDocument.objects.create(
            company=self.co,
            user=self.admin,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            from_warehouse=wh,
            to_customer=customer,
            issue_date=_date(2026, 10, 1),
            status=DeliveryDocument.STATUS_DELIVERED,
            delivered_at=original_dt,
        )

        self.client.force_authenticate(user=self.admin)
        self.client.patch(self.url, {"auto_deliver_wz": True}, format="json")

        wz_delivered.refresh_from_db()
        self.assertEqual(wz_delivered.status, DeliveryDocument.STATUS_DELIVERED)
        # delivered_at should not have changed
        self.assertEqual(wz_delivered.delivered_at, original_dt)

    def test_disabling_auto_deliver_wz_does_not_reopen_documents(self):
        """Turning auto_deliver_wz off after it was on should not change any WZ status."""
        from datetime import date as _date
        from apps.customers.models import Customer
        from apps.delivery.models import DeliveryDocument
        from apps.products.models import Warehouse

        CompanyWorkflowSettings.objects.update_or_create(
            company=self.co, defaults={"auto_deliver_wz": True}
        )
        customer = Customer.objects.create(name="Test Customer3", company=self.co)
        wh = Warehouse.objects.create(
            user=self.admin,
            company=self.co,
            code="MGY",
            name="MainY",
            warehouse_type=Warehouse.WarehouseType.MAIN,
        )
        wz_saved = DeliveryDocument.objects.create(
            company=self.co,
            user=self.admin,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            from_warehouse=wh,
            to_customer=customer,
            issue_date=_date(2026, 10, 1),
            status=DeliveryDocument.STATUS_SAVED,
        )

        self.client.force_authenticate(user=self.admin)
        self.client.patch(self.url, {"auto_deliver_wz": False}, format="json")

        wz_saved.refresh_from_db()
        # Turning OFF must not alter any document status
        self.assertEqual(wz_saved.status, DeliveryDocument.STATUS_SAVED)


# ---------------------------------------------------------------------------
# KSeF environment tests
# ---------------------------------------------------------------------------

class KsefEnvironmentTests(TestCase):
    """Tests for ksef_environment field on Company model and API."""

    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, _ = _make_company_with_admin(
            "ksef-env-admin", "ksef-env@test.com"
        )

    def test_default_environment_is_demo(self):
        self.assertEqual(self.company.ksef_environment, "demo")

    def test_current_user_returns_ksef_environment(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["ksef_environment"], "demo")

    def test_current_user_returns_is_staff(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(reverse("current_user"))
        self.assertEqual(r.status_code, 200)
        self.assertIn("is_staff", r.data["user"])

    def test_patch_environment_to_production(self):
        self.client.force_authenticate(user=self.admin)
        url = reverse("company-detail", kwargs={"pk": str(self.company.uuid)})
        r = self.client.patch(url, {"ksef_environment": "production"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.ksef_environment, "production")

    def test_patch_environment_to_test(self):
        self.client.force_authenticate(user=self.admin)
        url = reverse("company-detail", kwargs={"pk": str(self.company.uuid)})
        r = self.client.patch(url, {"ksef_environment": "test"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.ksef_environment, "test")


class KsefGetHostTests(TestCase):
    """Tests for ssapi_client._get_ksef_host resolves correct API host."""

    def setUp(self):
        _, self.company, _ = _make_company_with_admin(
            "ksef-host-admin", "ksef-host@test.com"
        )

    def test_demo_host(self):
        from apps.ksef.ssapi_client import _get_ksef_host
        from apps.ksef.crypto import KSEF_ENV_HOSTS
        self.company.ksef_environment = "demo"
        self.company.save(update_fields=["ksef_environment"])
        self.assertEqual(_get_ksef_host(self.company.pk), KSEF_ENV_HOSTS["demo"])

    def test_production_host(self):
        from apps.ksef.ssapi_client import _get_ksef_host
        from apps.ksef.crypto import KSEF_ENV_HOSTS
        self.company.ksef_environment = "production"
        self.company.save(update_fields=["ksef_environment"])
        self.assertEqual(_get_ksef_host(self.company.pk), KSEF_ENV_HOSTS["production"])

    def test_test_host(self):
        from apps.ksef.ssapi_client import _get_ksef_host
        from apps.ksef.crypto import KSEF_ENV_HOSTS
        self.company.ksef_environment = "test"
        self.company.save(update_fields=["ksef_environment"])
        self.assertEqual(_get_ksef_host(self.company.pk), KSEF_ENV_HOSTS["test"])

    def test_unknown_company_returns_default(self):
        from apps.ksef.ssapi_client import _get_ksef_host
        from apps.ksef.crypto import KSEF_DEFAULT_HOST
        self.assertEqual(_get_ksef_host(999999), KSEF_DEFAULT_HOST)


class KSeFCertificateFilenameTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin, self.company, _ = _make_company_with_admin(
            "cert-name-admin", "cert-name@test.com", "Cert Co", "9990000099"
        )

    def test_status_returns_stored_filenames(self):
        from apps.users.models import KSeFCertificate

        KSeFCertificate.objects.create(
            company=self.company,
            uploaded_by=self.admin,
            certificate_pem="FAKEPEM",
            encrypted_key="FAKEKEY",
            certificate_filename="firma.pem",
            key_filename="klucz.key",
            environment="demo",
        )
        self.client.force_authenticate(user=self.admin)
        url = reverse("company-ksef-certificate-status", kwargs={"company_id": self.company.uuid})
        response = self.client.get(url, {"environment": "demo"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["certificate_filename"], "firma.pem")
        self.assertEqual(response.data["key_filename"], "klucz.key")

    def test_upload_stores_basename_only(self):
        from datetime import date
        from types import SimpleNamespace
        from unittest.mock import patch

        from django.core.files.uploadedfile import SimpleUploadedFile

        parsed = SimpleNamespace(
            certificate_pem="PEM",
            private_key_pem="KEY",
            subject_name="CN=Test",
            valid_from=date(2026, 2, 16),
            valid_until=date(2028, 2, 16),
        )
        self.client.force_authenticate(user=self.admin)
        url = reverse("company-ksef-certificate", kwargs={"company_id": self.company.uuid})
        cert = SimpleUploadedFile("folder/firma.pem", b"cert-bytes")
        key = SimpleUploadedFile("..\\klucz.key", b"key-bytes")
        with patch("apps.users.certificate_views.parse_certificate_and_key", return_value=parsed), patch(
            "apps.users.certificate_views.encrypt_private_key_pem", return_value="ENC"
        ):
            response = self.client.post(
                url,
                {"certificate_file": cert, "key_file": key, "environment": "demo"},
                format="multipart",
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["certificate_filename"], "firma.pem")
        self.assertEqual(response.data["key_filename"], "klucz.key")
