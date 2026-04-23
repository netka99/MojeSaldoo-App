import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from apps.users.models import Company, CompanyMembership, CompanyModule
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
                "email": "new@co.test",
                "phone": "+48111222333",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        cid = response.data["id"]
        co = Company.objects.get(pk=cid)
        self.assertEqual(co.name, "NewCo")
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
            kwargs={"company_id": self.company.pk},
        )

    def _module_patch_url(self, module_key: str):
        return reverse(
            "company-module-enable",
            kwargs={"company_id": self.company.pk, "module_key": module_key},
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
                    "company_id": self.company.pk,
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
            {"company": str(self.co_b.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["user"]["current_company"], str(self.co_b.pk))
        self.user.refresh_from_db()
        self.assertEqual(self.user.current_company_id, self.co_b.pk)

    def test_switch_forbidden_not_member(self):
        self.client.force_authenticate(user=self.user)
        foreign = Company.objects.create(name="Foreign")
        response = self.client.post(
            reverse("company-switch"),
            {"company": str(foreign.pk)},
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
        self.assertEqual(response.data["user"]["current_company"], str(self.co.pk))


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
