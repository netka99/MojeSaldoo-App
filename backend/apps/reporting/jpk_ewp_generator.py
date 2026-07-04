"""
JPK_EWP(3) — Ewidencja Przychodów generator.

Used by ryczałt VAT-payer companies to export their revenue register
for a given calendar month. The XML schema is defined by the Ministry
of Finance (Ministerstwo Finansów).

Each issued/paid invoice in the period becomes one EwidencjaPrzychodu
entry. Revenue is bucketed into one of the schema fields based on the
company's ryczalt_category:
  rolnicze     → PrzychodyRolnicze (2%)
  handel       → PrzychodyHandel (3%)
  budownictwo  → PrzychodyBudownictwo (5.5%)
  uslugi       → PrzychodyUslugi (8.5%)
  it           → PrzychodyIT (12%)
  medyczne     → PrzychodyMedyczne (14%)
  finansowe    → PrzychodyFinansowe (15%)
  wolne_zawody → PrzychodyWolneZawody (17%)
"""

import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP


# Mapping: ryczalt_category → XML element name for that revenue type
CATEGORY_XML_FIELD: dict[str, str] = {
    "rolnicze":     "PrzychodyRolnicze",
    "handel":       "PrzychodyHandel",
    "budownictwo":  "PrzychodyBudownictwo",
    "uslugi":       "PrzychodyUslugi",
    "it":           "PrzychodyIT",
    "medyczne":     "PrzychodyMedyczne",
    "finansowe":    "PrzychodyFinansowe",
    "wolne_zawody": "PrzychodyWolneZawody",
}


def _escape(value) -> str:
    if not value:
        return ""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _fmt_date(d) -> str:
    if hasattr(d, "isoformat"):
        return d.isoformat()[:10]
    return str(d)[:10]


def _fmt_amount(d: Decimal) -> str:
    return str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def generate_jpk_ewp(company, invoices, year: int, month: int) -> str:
    """
    Generate JPK_EWP(3) XML for the given company and invoice list.

    Args:
        company: Company model instance (must have nip, name, address, city,
                 postal_code, ryczalt_category set).
        invoices: List/queryset of Invoice instances for the period (already
                  evaluated — pass list(queryset) to avoid double-iteration).
        year: Calendar year (e.g. 2026).
        month: Calendar month 1–12.

    Returns:
        UTF-8 XML string.
    """
    revenue_field = CATEGORY_XML_FIELD.get(company.ryczalt_category or "", "PrzychodyUslugi")
    generated_at = date.today().isoformat()
    period_from = f"{year:04d}-{month:02d}-01"
    last_day = calendar.monthrange(year, month)[1]
    period_to = f"{year:04d}-{month:02d}-{last_day:02d}"

    nip = _escape(company.nip or "")
    company_name = _escape(company.name or "")
    address = _escape(company.address or "")
    city = _escape(company.city or "")
    postal_code = _escape(company.postal_code or "")

    # Build entries first so we can compute totals in one pass.
    entry_blocks: list[str] = []
    total = Decimal("0.00")
    category_total = Decimal("0.00")

    for lp, invoice in enumerate(invoices, start=1):
        amount = Decimal(str(invoice.total_gross))
        total += amount
        category_total += amount

        buyer_name = ""
        buyer_address = ""
        if invoice.customer:
            buyer_name = _escape(
                invoice.customer.name or invoice.customer.company_name or ""
            )
            parts = []
            if invoice.customer.street:
                parts.append(invoice.customer.street)
            if invoice.customer.postal_code and invoice.customer.city:
                parts.append(f"{invoice.customer.postal_code} {invoice.customer.city}")
            buyer_address = _escape(", ".join(parts))

        block = "\n".join([
            "  <EwidencjaPrzychodu>",
            f"    <LpEP>{lp}</LpEP>",
            f"    <DataPrzychodu>{_fmt_date(invoice.issue_date)}</DataPrzychodu>",
            f"    <NrDokumentu>{_escape(invoice.invoice_number)}</NrDokumentu>",
            f"    <NazwaNabywcy>{buyer_name}</NazwaNabywcy>",
            f"    <AdresNabywcy>{buyer_address}</AdresNabywcy>",
            f"    <{revenue_field}>{_fmt_amount(amount)}</{revenue_field}>",
            f"    <PrzychodnyCalosc>{_fmt_amount(amount)}</PrzychodnyCalosc>",
            "  </EwidencjaPrzychodu>",
        ])
        entry_blocks.append(block)

    count = len(entry_blocks)

    lines: list[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append(
        '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2022/02/17/02171/" '
        'xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2018/08/24/eD/DefinicjeTypy/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    )

    # ── Nagłówek ──────────────────────────────────────────────────────────────
    lines.append("  <Naglowek>")
    lines.append('    <KodFormularza kodSystemowy="JPK_EWP" wersjaSchemy="1-0">JPK_EWP</KodFormularza>')
    lines.append("    <WariantFormularza>3</WariantFormularza>")
    lines.append("    <CelZlozenia poz=\"P_7\">1</CelZlozenia>")
    lines.append(f"    <DataWytworzeniaJPK>{generated_at}</DataWytworzeniaJPK>")
    lines.append(f"    <DataOd>{period_from}</DataOd>")
    lines.append(f"    <DataDo>{period_to}</DataDo>")
    lines.append("    <NazwaSystemu>MojeSaldoo</NazwaSystemu>")
    lines.append("  </Naglowek>")

    # ── Podmiot1 ──────────────────────────────────────────────────────────────
    lines.append("  <Podmiot1>")
    lines.append("    <IdentyfikatorPodmiotu>")
    lines.append(f"      <etd:NIP>{nip}</etd:NIP>")
    lines.append(f"      <etd:PelnaNazwa>{company_name}</etd:PelnaNazwa>")
    lines.append("    </IdentyfikatorPodmiotu>")
    lines.append("    <AdresPodmiotu>")
    lines.append(f"      <etd:KodPocztowy>{postal_code}</etd:KodPocztowy>")
    lines.append(f"      <etd:Miejscowosc>{city}</etd:Miejscowosc>")
    lines.append(f"      <etd:Ulica>{address}</etd:Ulica>")
    lines.append("    </AdresPodmiotu>")
    lines.append("  </Podmiot1>")

    # ── Entries ───────────────────────────────────────────────────────────────
    lines.extend(entry_blocks)

    # ── Podsumowanie ──────────────────────────────────────────────────────────
    lines.append("  <EwidencjaPrzychoduCtrl>")
    lines.append(f"    <LiczbaWierszy>{count}</LiczbaWierszy>")
    lines.append(f"    <SumaPrzychodnyCalosc>{_fmt_amount(total)}</SumaPrzychodnyCalosc>")
    lines.append(f"    <Suma{revenue_field}>{_fmt_amount(category_total)}</Suma{revenue_field}>")
    lines.append("  </EwidencjaPrzychoduCtrl>")

    lines.append("</JPK>")

    return "\n".join(lines)
