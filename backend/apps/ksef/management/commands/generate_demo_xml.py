"""
Management command: generate_demo_xml

Generates valid FA-3 XML content for ReceivedKSeFInvoice records that have
no xml_content (empty/blank).  Uses the invoice's stored fields and its
related ReceivedKSeFInvoiceLine rows to produce well-formed XML conforming
to the FA (3) schema namespace:
    http://crd.gov.pl/wzor/2025/06/25/13775/
"""

from collections import defaultdict
from decimal import Decimal
from xml.etree.ElementTree import Element, SubElement, tostring
import xml.dom.minidom

from django.core.management.base import BaseCommand

from apps.ksef.models import ReceivedKSeFInvoice


FA3_NS = "http://crd.gov.pl/wzor/2025/06/25/13775/"


def _sub(parent: Element, tag: str, text: str = "") -> Element:
    """Create a child element with optional text content."""
    el = SubElement(parent, tag)
    if text:
        el.text = text
    return el


def _fmt_decimal(value) -> str:
    """Format a Decimal (or numeric) to a plain string without trailing zeros beyond 2dp."""
    if value is None:
        return "0.00"
    d = Decimal(str(value))
    # Normalise but keep at least 2 decimal places
    formatted = f"{d:.2f}"
    return formatted


def _fmt_quantity(value) -> str:
    """Format quantity — strip trailing zeros after 4 dp, but keep at least 2."""
    if value is None:
        return "0"
    d = Decimal(str(value))
    # Remove insignificant trailing zeros
    normalised = d.normalize()
    # Ensure we don't end up with scientific notation for small/large numbers
    return format(normalised, "f")


def _vat_rate_index(vat_rate: str) -> int:
    """
    Map a VAT rate string to the FA-3 suffix index used in P_13_X / P_14_X.

    FA-3 grouping order (subset relevant for PL):
        1 → 23%
        2 → 8%
        3 → 5%
        4 → 0%
        5 → zw (exempt)
        6 → np (outside scope)

    Unknown rates fall back to index 1 (standard rate).
    """
    mapping = {
        "23": 1,
        "8": 2,
        "5": 3,
        "0": 4,
        "zw": 5,
        "np": 6,
    }
    key = str(vat_rate).strip().lower().replace("%", "")
    return mapping.get(key, 1)


def build_fa3_xml(invoice: "ReceivedKSeFInvoice") -> str:
    """Build a valid FA-3 XML string for the given invoice."""

    # Register the namespace so ElementTree uses the correct prefix
    import xml.etree.ElementTree as ET
    ET.register_namespace("", FA3_NS)

    root = Element(f"{{{FA3_NS}}}Faktura")

    # ── Naglowek ────────────────────────────────────────────────────────────
    naglowek = _sub(root, f"{{{FA3_NS}}}Naglowek")

    kod = _sub(naglowek, f"{{{FA3_NS}}}KodFormularza", "FA")
    kod.set("kodSystemowy", "FA (3)")
    kod.set("wersjaSchemy", "1-0E")

    _sub(naglowek, f"{{{FA3_NS}}}WariantFormularza", "3")

    issue_date_str = (
        invoice.issue_date.isoformat() if invoice.issue_date else "2026-01-01"
    )
    _sub(naglowek, f"{{{FA3_NS}}}DataWytworzeniaFa", f"{issue_date_str}T10:00:00")
    _sub(naglowek, f"{{{FA3_NS}}}SystemInfo", "DemoSystem")

    # ── Podmiot1 (seller) ────────────────────────────────────────────────────
    podmiot1 = _sub(root, f"{{{FA3_NS}}}Podmiot1")
    dane1 = _sub(podmiot1, f"{{{FA3_NS}}}DaneIdentyfikacyjne")
    _sub(dane1, f"{{{FA3_NS}}}NIP", invoice.seller_nip or "0000000000")
    _sub(dane1, f"{{{FA3_NS}}}PelnaNazwa", invoice.seller_name or "Sprzedawca")
    adres1 = _sub(podmiot1, f"{{{FA3_NS}}}Adres")
    _sub(adres1, f"{{{FA3_NS}}}KodKraju", invoice.seller_country or "PL")
    _sub(
        adres1,
        f"{{{FA3_NS}}}AdresL1",
        invoice.seller_address_l1 or "ul. Nieznana 1, 00-001 Warszawa",
    )
    if invoice.seller_address_l2:
        _sub(adres1, f"{{{FA3_NS}}}AdresL2", invoice.seller_address_l2)

    # ── Podmiot2 (buyer) ─────────────────────────────────────────────────────
    podmiot2 = _sub(root, f"{{{FA3_NS}}}Podmiot2")
    dane2 = _sub(podmiot2, f"{{{FA3_NS}}}DaneIdentyfikacyjne")
    _sub(dane2, f"{{{FA3_NS}}}NIP", invoice.buyer_nip or "0000000000")
    _sub(dane2, f"{{{FA3_NS}}}PelnaNazwa", invoice.buyer_name or "Nabywca")
    adres2 = _sub(podmiot2, f"{{{FA3_NS}}}Adres")
    _sub(adres2, f"{{{FA3_NS}}}KodKraju", "PL")
    _sub(adres2, f"{{{FA3_NS}}}AdresL1", "ul. Przykładowa 1, 00-001 Warszawa")

    # ── Fa ───────────────────────────────────────────────────────────────────
    fa = _sub(root, f"{{{FA3_NS}}}Fa")
    _sub(fa, f"{{{FA3_NS}}}KodWaluty", invoice.currency or "PLN")
    _sub(fa, f"{{{FA3_NS}}}P_1", issue_date_str)
    _sub(fa, f"{{{FA3_NS}}}P_2", invoice.invoice_number or invoice.ksef_number)
    _sub(
        fa,
        f"{{{FA3_NS}}}RodzajFaktury",
        (invoice.invoice_type or "VAT").upper() or "VAT",
    )

    # ── FaWiersz (line items) ────────────────────────────────────────────────
    lines = list(invoice.lines.order_by("position"))

    # Accumulate net and VAT per rate index for P_13_X / P_14_X
    net_by_rate: dict[int, Decimal] = defaultdict(Decimal)
    vat_by_rate: dict[int, Decimal] = defaultdict(Decimal)

    for idx, line in enumerate(lines, start=1):
        wiersz = _sub(fa, f"{{{FA3_NS}}}FaWiersz")
        _sub(wiersz, f"{{{FA3_NS}}}NrWierszaFa", str(line.position or idx))
        _sub(wiersz, f"{{{FA3_NS}}}P_7", line.name or f"Pozycja {idx}")
        _sub(wiersz, f"{{{FA3_NS}}}P_8A", line.unit or "szt.")
        _sub(wiersz, f"{{{FA3_NS}}}P_8B", _fmt_quantity(line.quantity))
        _sub(wiersz, f"{{{FA3_NS}}}P_9A", _fmt_decimal(line.unit_net_price))
        _sub(wiersz, f"{{{FA3_NS}}}P_11", _fmt_decimal(line.line_net))
        _sub(wiersz, f"{{{FA3_NS}}}P_12", str(line.vat_rate or "23"))

        rate_idx = _vat_rate_index(line.vat_rate)
        line_net = Decimal(str(line.line_net or 0))
        net_by_rate[rate_idx] += line_net

        # Compute VAT for this line
        vat_key = str(line.vat_rate or "").strip().lower().replace("%", "")
        if vat_key in ("zw", "np", "0"):
            vat_amount = Decimal("0.00")
        else:
            try:
                rate_pct = Decimal(vat_key)
                vat_amount = (line_net * rate_pct / Decimal("100")).quantize(Decimal("0.01"))
            except Exception:
                vat_amount = Decimal("0.00")
        vat_by_rate[rate_idx] += vat_amount

    # ── Platnosci (payment terms) ─────────────────────────────────────────────
    if invoice.due_date:
        platnosci = _sub(fa, f"{{{FA3_NS}}}Platnosci")
        terminy = _sub(platnosci, f"{{{FA3_NS}}}TerminyPlatnosci")
        _sub(terminy, f"{{{FA3_NS}}}Termin", invoice.due_date.isoformat())

    # ── VAT summary (P_13_X / P_14_X) ────────────────────────────────────────
    # If we have no line data, fall back to invoice-level totals under rate index 1
    if not lines:
        net_by_rate[1] = Decimal(str(invoice.net_amount or 0))
        vat_by_rate[1] = Decimal(str(invoice.vat_amount or 0))

    gross_total = Decimal("0.00")
    for rate_idx in sorted(net_by_rate.keys()):
        net_val = net_by_rate[rate_idx].quantize(Decimal("0.01"))
        vat_val = vat_by_rate[rate_idx].quantize(Decimal("0.01"))
        _sub(fa, f"{{{FA3_NS}}}P_13_{rate_idx}", _fmt_decimal(net_val))
        _sub(fa, f"{{{FA3_NS}}}P_14_{rate_idx}", _fmt_decimal(vat_val))
        gross_total += net_val + vat_val

    # If invoice has an explicit gross, prefer that (avoids rounding drift)
    if invoice.gross_amount:
        gross_total = Decimal(str(invoice.gross_amount))

    _sub(fa, f"{{{FA3_NS}}}P_15", _fmt_decimal(gross_total))

    # ── Pretty-print ─────────────────────────────────────────────────────────
    raw = tostring(root, encoding="unicode", xml_declaration=False)
    dom = xml.dom.minidom.parseString(raw)
    pretty = dom.toprettyxml(indent="  ", encoding=None)
    # toprettyxml adds its own <?xml ...?> declaration — replace with UTF-8 one
    lines_xml = pretty.split("\n")
    if lines_xml[0].startswith("<?xml"):
        lines_xml[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return "\n".join(lines_xml)


class Command(BaseCommand):
    help = "Generate FA-3 XML for demo KSeF invoices without xml_content"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be done without saving changes.",
        )
        parser.add_argument(
            "--company-id",
            type=int,
            default=None,
            help="Limit to a specific company PK.",
        )

    def handle(self, *args, **options):
        import datetime as _dt
        dry_run: bool = options["dry_run"]
        company_id: int | None = options["company_id"]

        # ── Backfill due_date for existing records that are missing it ──────────
        backfill_qs = ReceivedKSeFInvoice.objects.filter(due_date__isnull=True, issue_date__isnull=False)
        if company_id is not None:
            backfill_qs = backfill_qs.filter(company_id=company_id)
        backfill_count = backfill_qs.count()
        if backfill_count:
            if dry_run:
                self.stdout.write(f"[DRY RUN] Would backfill due_date for {backfill_count} invoice(s) (issue_date + 30 days)")
            else:
                for inv in backfill_qs:
                    inv.due_date = inv.issue_date + _dt.timedelta(days=30)
                    inv.save(update_fields=["due_date"])
                self.stdout.write(self.style.SUCCESS(f"Backfilled due_date for {backfill_count} invoice(s)."))

        qs = ReceivedKSeFInvoice.objects.filter(xml_content="").select_related()
        if company_id is not None:
            qs = qs.filter(company_id=company_id)

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS("No invoices without xml_content found. Nothing to do."))
            return

        self.stdout.write(
            f"Found {total} invoice(s) without xml_content"
            + (f" for company_id={company_id}" if company_id else "")
            + ("  [DRY RUN]" if dry_run else "")
        )

        updated = 0
        errors = 0

        for invoice in qs.prefetch_related("lines"):
            try:
                xml_str = build_fa3_xml(invoice)
                if dry_run:
                    self.stdout.write(
                        f"  [DRY RUN] Would update: {invoice.ksef_number} / {invoice.invoice_number}"
                    )
                else:
                    import datetime as _dt
                    update_fields = ["xml_content"]
                    invoice.xml_content = xml_str
                    if not invoice.due_date and invoice.issue_date:
                        invoice.due_date = invoice.issue_date + _dt.timedelta(days=30)
                        update_fields.append("due_date")
                    invoice.save(update_fields=update_fields)
                    self.stdout.write(
                        f"  Updated: {invoice.ksef_number} / {invoice.invoice_number}"
                    )
                updated += 1
            except Exception as exc:
                self.stderr.write(
                    self.style.ERROR(
                        f"  ERROR on {invoice.ksef_number}: {exc}"
                    )
                )
                errors += 1

        action = "Would update" if dry_run else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{action} {updated}/{total} invoice(s). Errors: {errors}."
            )
        )
