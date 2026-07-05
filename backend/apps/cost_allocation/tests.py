from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from apps.users.models import Company, CompanyMembership, CompanyModule, User
from apps.ksef.models import ReceivedKSeFInvoice, ReceivedKSeFInvoiceLine

from .models import CostProject, InvoiceAnnotation, InvoiceLineAnnotation


def _make_company(name="TestCo", nip="1234567890"):
    return Company.objects.create(name=name, nip=nip)


def _make_user(company, username="testuser", role="admin"):
    user = User.objects.create_user(username=username, password="pass", email=f"{username}@test.com")
    user.current_company = company
    user.save()
    CompanyMembership.objects.create(user=user, company=company, role=role, is_active=True)
    return user


def _enable_module(company, module="cost_allocation"):
    CompanyModule.objects.get_or_create(company=company, module=module, defaults={"is_enabled": True})
    CompanyModule.objects.filter(company=company, module=module).update(is_enabled=True)


def _make_received_invoice(company, ksef_number="KSEF-001"):
    return ReceivedKSeFInvoice.objects.create(
        company=company,
        ksef_number=ksef_number,
        invoice_number="FV/2026/001",
        issue_date=date(2026, 6, 1),
        seller_nip="9876543210",
        seller_name="Dostawca Sp. z o.o.",
    )


def _make_line(invoice, position=0, name="Produkt A"):
    return ReceivedKSeFInvoiceLine.objects.create(
        invoice=invoice,
        position=position,
        name=name,
        unit="szt",
        quantity=2,
        unit_net_price="50.00",
        vat_rate="23",
        line_net="100.00",
    )


class CostProjectModelTest(TestCase):
    def setUp(self):
        self.company = _make_company()

    def test_str_with_code(self):
        p = CostProject(company=self.company, name="Projekt A", code="PA")
        self.assertEqual(str(p), "PA – Projekt A")

    def test_str_without_code(self):
        p = CostProject(company=self.company, name="Projekt B")
        self.assertEqual(str(p), "Projekt B")

    def test_default_is_active(self):
        p = CostProject.objects.create(company=self.company, name="X")
        self.assertTrue(p.is_active)


class InvoiceAnnotationModelTest(TestCase):
    def setUp(self):
        self.company = _make_company()
        self.invoice = _make_received_invoice(self.company)

    def test_create_annotation(self):
        ann = InvoiceAnnotation.objects.create(invoice=self.invoice)
        self.assertEqual(ann.accounting_status, "pending")
        self.assertEqual(ann.accounting_notes, "")

    def test_str(self):
        ann = InvoiceAnnotation.objects.create(invoice=self.invoice)
        self.assertIn("pending", str(ann))

    def test_one_annotation_per_invoice(self):
        InvoiceAnnotation.objects.create(invoice=self.invoice)
        with self.assertRaises(Exception):
            InvoiceAnnotation.objects.create(invoice=self.invoice)


class InvoiceLineAnnotationModelTest(TestCase):
    def setUp(self):
        self.company = _make_company()
        self.invoice = _make_received_invoice(self.company)
        self.line = _make_line(self.invoice)

    def test_create_line_annotation(self):
        la = InvoiceLineAnnotation.objects.create(line=self.line, is_private=True, note="Test")
        self.assertTrue(la.is_private)
        self.assertEqual(la.note, "Test")
        self.assertIsNone(la.project)

    def test_project_assignment(self):
        project = CostProject.objects.create(company=self.company, name="Projekt X")
        la = InvoiceLineAnnotation.objects.create(line=self.line, project=project)
        self.assertEqual(la.project, project)


class CostProjectAPITest(TestCase):
    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        _enable_module(self.company)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_projects_empty(self):
        resp = self.client.get("/api/cost-allocation/projects/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_create_project(self):
        resp = self.client.post("/api/cost-allocation/projects/", {
            "name": "Projekt Alpha",
            "code": "PA",
            "color": "#3B82F6",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["name"], "Projekt Alpha")
        self.assertEqual(resp.data["code"], "PA")

    def test_list_returns_only_active(self):
        CostProject.objects.create(company=self.company, name="Aktywny")
        CostProject.objects.create(company=self.company, name="Nieaktywny", is_active=False)
        resp = self.client.get("/api/cost-allocation/projects/")
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["name"], "Aktywny")

    def test_patch_project(self):
        project = CostProject.objects.create(company=self.company, name="Stary")
        resp = self.client.patch(f"/api/cost-allocation/projects/{project.uuid}/", {"name": "Nowy"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["name"], "Nowy")

    def test_delete_project_soft(self):
        project = CostProject.objects.create(company=self.company, name="DoUsunięcia")
        resp = self.client.delete(f"/api/cost-allocation/projects/{project.uuid}/")
        self.assertEqual(resp.status_code, 204)
        project.refresh_from_db()
        self.assertFalse(project.is_active)

    def test_module_required_returns_403_when_disabled(self):
        CompanyModule.objects.filter(company=self.company, module="cost_allocation").update(is_enabled=False)
        resp = self.client.get("/api/cost-allocation/projects/")
        self.assertEqual(resp.status_code, 403)

    def test_cannot_access_other_company_project(self):
        other_company = _make_company(name="Other", nip="0000000001")
        other_project = CostProject.objects.create(company=other_company, name="OtherProject")
        resp = self.client.patch(f"/api/cost-allocation/projects/{other_project.uuid}/", {"name": "Hacked"}, format="json")
        self.assertEqual(resp.status_code, 404)


class InvoiceAnnotationAPITest(TestCase):
    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        _enable_module(self.company)
        self.invoice = _make_received_invoice(self.company)
        self.line0 = _make_line(self.invoice, position=0, name="Produkt A")
        self.line1 = _make_line(self.invoice, position=1, name="Produkt B")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f"/api/cost-allocation/invoices/{self.invoice.ksef_number}/annotation/"

    def test_get_returns_empty_when_no_annotation(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {})

    def test_patch_creates_annotation(self):
        resp = self.client.patch(self.url, {
            "accountingStatus": "annotated",
            "accountingNotes": "Do weryfikacji",
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["accounting_status"], "annotated")
        self.assertEqual(resp.data["accounting_notes"], "Do weryfikacji")

    def test_patch_with_line_annotations(self):
        project = CostProject.objects.create(company=self.company, name="Projekt X")
        resp = self.client.patch(self.url, {
            "accountingStatus": "annotated",
            "lineAnnotations": {
                "0": {
                    "isPrivate": False,
                    "note": "Materiały",
                    "splits": [{"project": str(project.uuid), "percentage": 100}],
                },
                "1": {"isPrivate": True, "note": "Prywatne"},
            },
        }, format="json")
        self.assertEqual(resp.status_code, 200)

        la0 = InvoiceLineAnnotation.objects.get(line=self.line0)
        split0 = la0.splits.get()
        self.assertEqual(split0.project, project)
        self.assertFalse(la0.is_private)
        self.assertEqual(la0.note, "Materiały")

        la1 = InvoiceLineAnnotation.objects.get(line=self.line1)
        self.assertEqual(la1.splits.count(), 0)
        self.assertTrue(la1.is_private)

    def test_get_after_patch_includes_line_annotations(self):
        project = CostProject.objects.create(company=self.company, name="Projekt Y")
        self.client.patch(self.url, {
            "lineAnnotations": {
                "0": {"splits": [{"project": str(project.uuid), "percentage": 100}]},
            },
        }, format="json")

        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        line_anns = resp.data["line_annotations"]
        self.assertEqual(line_anns["0"]["splits"][0]["projectName"], "Projekt Y")

    def test_patch_ignores_project_from_other_company(self):
        other_company = _make_company(name="Other", nip="0000000002")
        other_project = CostProject.objects.create(company=other_company, name="Foreign")
        resp = self.client.patch(self.url, {
            "lineAnnotations": {
                "0": {"splits": [{"project": str(other_project.uuid), "percentage": 100}]},
            },
        }, format="json")
        # Should succeed but silently skip the split referencing the foreign project.
        self.assertEqual(resp.status_code, 200)
        la = InvoiceLineAnnotation.objects.filter(line=self.line0).first()
        self.assertIsNotNone(la)
        self.assertEqual(la.splits.count(), 0)

    def test_get_returns_404_for_unknown_invoice(self):
        resp = self.client.get("/api/cost-allocation/invoices/NONEXISTENT/annotation/")
        self.assertEqual(resp.status_code, 404)


class CostAllocationExportTest(TestCase):
    def setUp(self):
        self.company = _make_company()
        self.user = _make_user(self.company)
        _enable_module(self.company)
        self.invoice = _make_received_invoice(self.company)
        _make_line(self.invoice, position=0, name="Produkt A")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_export_returns_csv(self):
        resp = self.client.get("/api/cost-allocation/export/?fmt=csv")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/csv", resp["Content-Type"])

    def test_export_contains_invoice_data(self):
        resp = self.client.get("/api/cost-allocation/export/?fmt=csv")
        content = b"".join(resp.streaming_content).decode("utf-8-sig") if hasattr(resp, "streaming_content") else resp.content.decode("utf-8-sig")
        self.assertIn("FV/2026/001", content)
        self.assertIn("Dostawca Sp. z o.o.", content)
        self.assertIn("Produkt A", content)

    def test_export_marks_invoice_as_exported(self):
        self.client.get("/api/cost-allocation/export/")
        ann = InvoiceAnnotation.objects.get(invoice=self.invoice)
        self.assertEqual(ann.accounting_status, "exported")
        self.assertIsNotNone(ann.exported_at)

    def test_export_does_not_overwrite_booked_status(self):
        InvoiceAnnotation.objects.create(
            invoice=self.invoice, accounting_status="booked"
        )
        self.client.get("/api/cost-allocation/export/")
        ann = InvoiceAnnotation.objects.get(invoice=self.invoice)
        self.assertEqual(ann.accounting_status, "booked")
