from django.test import TestCase
from django.contrib.auth import get_user_model

from apps.users.models import Company, CompanyMembership
from .models import ActivityLog
from .log import log_activity
from .error_codes import get_error_info
from .format import flatten_error_value
from .middleware import _match_action

User = get_user_model()


def _make_user_with_company(username="testuser"):
    company = Company.objects.create(name="Test Firma", is_active=True)
    user = User.objects.create_user(username=username, email=f"{username}@test.local", password="pass")
    CompanyMembership.objects.create(user=user, company=company, role="admin", is_active=True)
    user.current_company = company
    user.save(update_fields=["current_company"])
    # Refresh so current_company is the model instance
    user.refresh_from_db()
    user.current_company = company  # attach instance for log_activity
    return user, company


class LogActivityTests(TestCase):
    def test_creates_success_entry(self):
        user, company = _make_user_with_company()
        log_activity(user=user, action="ksef.send", status=ActivityLog.STATUS_SUCCESS, object_type="invoice", object_id="FV/1/2024")
        entry = ActivityLog.objects.get(company=company)
        self.assertEqual(entry.action, "ksef.send")
        self.assertEqual(entry.status, "success")
        self.assertEqual(entry.object_id, "FV/1/2024")

    def test_creates_error_entry_with_code(self):
        user, company = _make_user_with_company("erruser")
        log_activity(
            user=user,
            action="ksef.send",
            status=ActivityLog.STATUS_ERROR,
            object_type="invoice",
            object_id="FV/2/2024",
            error_code="KSEF_NO_SESSION",
            error_detail="KSeFSession.DoesNotExist",
        )
        entry = ActivityLog.objects.get(company=company)
        self.assertEqual(entry.error_code, "KSEF_NO_SESSION")
        self.assertEqual(entry.status, "error")

    def test_noop_when_no_company(self):
        user = User.objects.create_user(username="nocompany", password="pass")
        # user.current_company is None
        log_activity(user=user, action="ksef.send", status=ActivityLog.STATUS_ERROR)
        self.assertEqual(ActivityLog.objects.count(), 0)

    def test_error_detail_truncated(self):
        user, company = _make_user_with_company("truncuser")
        log_activity(
            user=user,
            action="ksef.send",
            status=ActivityLog.STATUS_ERROR,
            error_detail="x" * 2000,
        )
        entry = ActivityLog.objects.get(company=company)
        self.assertLessEqual(len(entry.error_detail), 1024)


class ErrorCodesTests(TestCase):
    def test_known_code_returns_title(self):
        info = get_error_info("KSEF_NO_SESSION")
        self.assertIn("title", info)
        self.assertIn("description", info)
        self.assertIn("action_hint", info)

    def test_unknown_code_returns_fallback(self):
        info = get_error_info("TOTALLY_UNKNOWN")
        self.assertEqual(info["title"], "Nieznany błąd")

    def test_unknown_code_uses_error_detail(self):
        info = get_error_info("TOTALLY_UNKNOWN", "FA-3: brak NIP")
        self.assertEqual(info["title"], "Nieznany błąd")
        self.assertIn("FA-3: brak NIP", info["description"])

    def test_known_code_appends_error_detail(self):
        info = get_error_info("KSEF_VALIDATION_FAILED", "Pole P_1 jest puste")
        self.assertEqual(info["title"], "Faktura nie przeszła walidacji FA-3")
        self.assertIn("Pole P_1 jest puste", info["description"])

    def test_empty_code_uses_operation_title(self):
        info = get_error_info("", "HTTP 400")
        self.assertEqual(info["title"], "Błąd operacji")
        self.assertEqual(info["description"], "HTTP 400")


class ActivityLogViewTests(TestCase):
    def setUp(self):
        self.user, self.company = _make_user_with_company("viewuser")
        self.client.login(username="viewuser", password="pass")

    def _auth_headers(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(self.user)
        return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}

    def test_returns_empty_list(self):
        resp = self.client.get("/api/activity/", **self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["total"], 0)

    def test_returns_own_logs(self):
        log_activity(user=self.user, action="ksef.auth", status=ActivityLog.STATUS_SUCCESS)
        resp = self.client.get("/api/activity/", **self._auth_headers())
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["results"][0]["action"], "ksef.auth")

    def test_status_filter(self):
        log_activity(user=self.user, action="ksef.auth", status=ActivityLog.STATUS_SUCCESS)
        log_activity(user=self.user, action="ksef.send", status=ActivityLog.STATUS_ERROR, error_code="KSEF_NO_SESSION")
        resp = self.client.get("/api/activity/?status=error", **self._auth_headers())
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["results"][0]["error_code"], "KSEF_NO_SESSION")

    def test_error_info_included(self):
        log_activity(user=self.user, action="ksef.send", status=ActivityLog.STATUS_ERROR, error_code="KSEF_REJECTED")
        resp = self.client.get("/api/activity/", **self._auth_headers())
        result = resp.json()["results"][0]
        self.assertIsNotNone(result["error_info"])
        self.assertEqual(result["error_info"]["title"], "Faktura odrzucona przez KSeF")

    def test_error_info_includes_detail_and_label(self):
        log_activity(
            user=self.user,
            action="delivery.complete",
            status=ActivityLog.STATUS_ERROR,
            error_code="STOCK_SHORTFALL",
            error_detail="Bułka: brakuje 20",
            object_id="WZ/1/2026",
        )
        resp = self.client.get("/api/activity/", **self._auth_headers())
        result = resp.json()["results"][0]
        self.assertEqual(result["action_label"], "Zakończenie dokumentu WZ/PZ")
        self.assertIn("Bułka: brakuje 20", result["error_info"]["description"])
        self.assertTrue(result["user_display"])

    def test_validation_failed_is_not_unknown(self):
        log_activity(
            user=self.user,
            action="ksef.send",
            status=ActivityLog.STATUS_ERROR,
            error_code="KSEF_VALIDATION_FAILED",
            error_detail="Brak P_1",
        )
        result = self.client.get("/api/activity/", **self._auth_headers()).json()["results"][0]
        self.assertEqual(result["error_info"]["title"], "Faktura nie przeszła walidacji FA-3")
        self.assertIn("Brak P_1", result["error_info"]["description"])

    def test_other_company_logs_not_visible(self):
        other_user, _ = _make_user_with_company("otheruser")
        log_activity(user=other_user, action="ksef.send", status=ActivityLog.STATUS_ERROR)
        resp = self.client.get("/api/activity/", **self._auth_headers())
        self.assertEqual(resp.json()["total"], 0)


class FlattenAndUrlTests(TestCase):
    def test_flattens_stock_shortfall(self):
        text = flatten_error_value({
            "stock": [
                {
                    "product_name": "Bułka",
                    "short_by": "20",
                    "quantity_available": "0",
                    "quantity_requested": "20",
                }
            ]
        })
        self.assertIn("Bułka", text)
        self.assertIn("brakuje 20", text)

    def test_match_delivery_complete(self):
        action, label = _match_action("/api/delivery/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/complete/")
        self.assertEqual(action, "delivery.complete")
        self.assertIn("Zakończenie", label)

    def test_match_cash_flow_not_api(self):
        action, _ = _match_action("/api/cash-flow/quick-expenses/")
        self.assertEqual(action, "cashflow.expense")

    def test_match_purchase_documents(self):
        action, _ = _match_action("/api/purchase-documents/")
        self.assertEqual(action, "purchase_document")
