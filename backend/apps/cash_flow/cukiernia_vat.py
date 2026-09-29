"""November 2024 confectionery VAT fixture — gold totals + intended rules.

The JSON reconstructs a real JPK_V7M month (anonymised). Intended VAT is what
the declaration should show. The live engine in services.py is compared against
that in tests.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.db import transaction

CENT = Decimal("0.01")
FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "cukiernia_2024_11.json"
SEED_PREFIX = "VAT11"
COMPANY_NIP = "5550000011"
COMPANY_NAME = "Cukiernia Testowa VAT-11"


def D(value) -> Decimal:
    return Decimal(str(value))


def q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def load_fixture() -> dict:
    with FIXTURE_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def gold(fixture: dict | None = None) -> dict[str, Decimal]:
    data = fixture or load_fixture()
    return {key: D(val) for key, val in data["gold"].items()}


def period_bounds(fixture: dict | None = None) -> tuple[date, date]:
    data = fixture or load_fixture()
    p = data["period"]
    return date.fromisoformat(p["start"]), date.fromisoformat(p["end"])


from apps.common.vat import deduction_share, deductible_vat


def intended_row_vat(row: dict) -> Decimal:
    """VAT that should be deducted for this purchase row (correct rules)."""
    is_private = bool(row.get("is_private") or row.get("private"))
    deduction = row.get("vat_deduction", "full")
    if row["source"] == "quick_expense":
        return deductible_vat(
            gross=D(row["gross"]),
            vat_rate=row.get("vat_rate"),
            vat_deduction=deduction,
            is_private=is_private,
        )
    return deductible_vat(
        stored_vat=D(row["vat"]),
        vat_deduction=deduction,
        is_private=is_private,
    )


def intended_row_net(row: dict) -> Decimal:
    """Net that belongs in the VAT-7 purchase box (not KPiR)."""
    if row.get("is_private") or row.get("private"):
        return Decimal("0.00")
    share = deduction_share(row.get("vat_deduction", "full"))
    return q(D(row["net"]) * share)


def intended_sales(fixture: dict | None = None) -> tuple[Decimal, Decimal]:
    data = fixture or load_fixture()
    net = Decimal("0.00")
    vat = Decimal("0.00")
    for inv in data["sales"]["invoices"]:
        net += D(inv["net"])
        vat += D(inv["vat"])
    for row in data["sales"]["b2c"]:
        gross = D(row["gross"])
        rate = D(row["vat_rate"])
        row_vat = q(gross * rate / (100 + rate))
        vat += row_vat
        net += q(gross - row_vat)
    return q(net), q(vat)


def intended_purchases(fixture: dict | None = None) -> tuple[Decimal, Decimal]:
    data = fixture or load_fixture()
    net = Decimal("0.00")
    vat = Decimal("0.00")
    for row in data["purchases"]:
        net += intended_row_net(row)
        vat += intended_row_vat(row)
    return q(net), q(vat)


def rows_by_id(fixture: dict | None = None) -> dict[str, dict]:
    data = fixture or load_fixture()
    return {row["id"]: row for row in data["purchases"]}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


@transaction.atomic
def reset_seeded_data(company) -> None:
    from apps.cash_flow.models import DailyB2CRevenue, QuickExpense
    from apps.invoices.models import Invoice
    from apps.ksef.models import ReceivedKSeFInvoice
    from apps.orders.models import Order
    from apps.purchase_documents.models import PurchaseDocument

    Invoice.objects.filter(company=company, invoice_number__startswith=f"{SEED_PREFIX}/").delete()
    Order.objects.filter(company=company, internal_notes__startswith=SEED_PREFIX).delete()
    PurchaseDocument.objects.filter(
        company=company, document_number__startswith=f"{SEED_PREFIX}/"
    ).delete()
    ReceivedKSeFInvoice.objects.filter(company=company, ksef_number__startswith=f"{SEED_PREFIX}-").delete()
    QuickExpense.objects.filter(company=company, document_number__startswith=f"{SEED_PREFIX}/").delete()
    DailyB2CRevenue.objects.filter(company=company, notes__startswith=SEED_PREFIX).delete()


@transaction.atomic
def seed_cukiernia_vat(company, *, reset: bool = True) -> dict:
    """Create November 2024 documents on `company`. Returns gold + intended totals."""
    from apps.cash_flow.models import CompanyTaxConfig, DailyB2CRevenue, QuickExpense
    from apps.customers.models import Customer
    from apps.invoices.models import Invoice
    from apps.ksef.models import ReceivedKSeFInvoice
    from apps.orders.models import Order
    from apps.purchase_documents.models import PurchaseDocument
    from apps.users.models import Company

    fixture = load_fixture()
    if reset:
        reset_seeded_data(company)

    company.taxation_form = Company.TAXATION_KPIR
    company.company_type = Company.COMPANY_TYPE_INVOICING
    company.is_vat_payer = True
    company.save(update_fields=["taxation_form", "company_type", "is_vat_payer"])

    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
    config.tax_form = CompanyTaxConfig.TAX_FORM_KPIR_LINEAR
    config.tax_rate = Decimal("19.00")
    config.vat_payer = True
    config.vat_method = CompanyTaxConfig.VAT_METHOD_MEMORIAŁOWA
    config.save()

    for inv in fixture["sales"]["invoices"]:
        issue = _parse_date(inv["date"])
        customer, _ = Customer.objects.get_or_create(
            company=company,
            name=inv["customer"],
            defaults={"country": "PL"},
        )
        order = Order.objects.create(
            company=company,
            customer=customer,
            order_date=issue,
            delivery_date=issue,
            status=Order.STATUS_DELIVERED,
            internal_notes=f"{SEED_PREFIX} {inv['number']}",
        )
        Invoice.objects.create(
            company=company,
            order=order,
            customer=customer,
            status=Invoice.STATUS_ISSUED,
            invoice_number=inv["number"],
            issue_date=issue,
            sale_date=issue,
            due_date=issue + timedelta(days=14),
            subtotal_net=D(inv["net"]),
            vat_amount=D(inv["vat"]),
            total_gross=D(inv["gross"]),
            subtotal_gross=D(inv["gross"]),
            payment_method="transfer",
        )

    for row in fixture["sales"]["b2c"]:
        DailyB2CRevenue.objects.create(
            company=company,
            date=_parse_date(row["date"]),
            amount=D(row["gross"]),
            vat_included=True,
            vat_rate=D(row["vat_rate"]),
            notes=row.get("notes") or f"{SEED_PREFIX} B2C",
        )

    for row in fixture["purchases"]:
        issue = _parse_date(row["date"])
        source = row["source"]
        opex = row.get("opex_category") or None
        notes = row.get("reason") or ""
        deduction = row.get("vat_deduction", "full")
        is_private = bool(row.get("is_private") or row.get("private"))

        if source == "purchase_document":
            PurchaseDocument.objects.create(
                company=company,
                doc_type=row["doc_type"],
                status=PurchaseDocument.STATUS_REGISTERED,
                supplier_name=row["supplier"],
                document_number=row["number"],
                issue_date=issue,
                total_net=D(row["net"]),
                total_vat=D(row["vat"]),
                total_gross=D(row["gross"]),
                opex_category=opex,
                vat_deduction=deduction,
                is_private=is_private,
                notes=notes,
                accounting_notes=notes,
            )
        elif source == "ksef":
            ReceivedKSeFInvoice.objects.create(
                company=company,
                ksef_number=row["ksef_number"],
                invoice_number=row["number"],
                issue_date=issue,
                seller_name=row["supplier"],
                seller_nip="0000000000",
                buyer_name=company.name,
                buyer_nip=company.nip or COMPANY_NIP,
                net_amount=D(row["net"]),
                vat_amount=D(row["vat"]),
                gross_amount=D(row["gross"]),
                currency="PLN",
                opex_category=opex,
                vat_deduction=deduction,
                is_private=is_private,
            )
        elif source == "quick_expense":
            QuickExpense.objects.create(
                company=company,
                date=issue,
                amount=D(row["gross"]),
                amount_net=D(row["net"]),
                vat_rate=str(row["vat_rate"]),
                has_vat=bool(row.get("has_vat", True)),
                vat_deduction=deduction,
                is_private=is_private,
                vendor=row["supplier"],
                document_number=row["number"],
                document_type=QuickExpense.DOC_PARAGON,
                category=opex or "raw_materials",
                notes=notes,
            )
        else:
            raise ValueError(f"Unknown purchase source: {source}")

    sales_net, sales_vat = intended_sales(fixture)
    purch_net, purch_vat = intended_purchases(fixture)
    return {
        "gold": gold(fixture),
        "intended_sales_net": sales_net,
        "intended_vat_nalezny": sales_vat,
        "intended_purchases_net": purch_net,
        "intended_vat_naliczony": purch_vat,
    }


def get_or_create_seed_company():
    from apps.users.models import Company

    company, created = Company.objects.get_or_create(
        nip=COMPANY_NIP,
        defaults={
            "name": COMPANY_NAME,
            "taxation_form": Company.TAXATION_KPIR,
            "company_type": Company.COMPANY_TYPE_INVOICING,
            "is_vat_payer": True,
        },
    )
    return company, created
