"""
FA-3 invoice XML generator for KSeF.
Schema: http://crd.gov.pl/wzor/2025/06/25/13775/
Ported from xmlGenerator.js in the SSAPI-connected reference app.

Seller data comes from invoice.company (dynamic, not hardcoded).
Buyer data comes from invoice.customer.
Line items come from invoice.items.all().
"""

import base64
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal, ROUND_HALF_UP


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
    """Format a date or date-like value as YYYY-MM-DD."""
    if hasattr(d, "isoformat"):
        return d.isoformat()[:10]
    return str(d)[:10]


def _fmt_amount(d: Decimal) -> str:
    """Format decimal: strip trailing zeros (600.00 → 600, 2.40 → 2.4)."""
    s = str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def _payment_code(payment_method: str) -> str:
    """Map Invoice.payment_method to FA-3 FormaPlatnosci code."""
    return "1" if payment_method == "cash" else "6"


_VALID_COUNTRY_CODES = {
    "AF","AL","DZ","AD","AO","AG","AR","AM","AU","AT","AZ","BS","BH","BD","BB",
    "BY","BE","BZ","BJ","BT","BO","BA","BW","BR","BN","BG","BF","BI","CV","KH",
    "CM","CA","CF","TD","CL","CN","CO","KM","CG","CD","CR","CI","HR","CU","CY",
    "CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","SZ","ET","FJ","FI",
    "FR","GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN","HU",
    "IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KW",
    "KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MG","MW","MY","MV","ML",
    "MT","MH","MR","MU","MX","FM","MD","MC","MN","ME","MA","MZ","MM","NA","NR",
    "NP","NL","NZ","NI","NE","NG","NO","OM","PK","PW","PA","PG","PY","PE","PH",
    "PL","PT","QA","RO","RU","RW","KN","LC","VC","WS","SM","ST","SA","SN","RS",
    "SC","SL","SG","SK","SI","SB","SO","ZA","SS","ES","LK","SD","SR","SE","CH",
    "SY","TW","TJ","TZ","TH","TL","TG","TO","TT","TN","TR","TM","TV","UG","UA",
    "AE","GB","US","UY","UZ","VU","VE","VN","YE","ZM","ZW",
}

def _country_code(value: str) -> str:
    """Return a valid ISO 3166-1 alpha-2 country code, defaulting to PL."""
    code = (value or "").strip().upper()
    if code in _VALID_COUNTRY_CODES:
        return code
    return "PL"


def _build_address_lines(street: str, postal_code: str, city: str) -> tuple[str, str]:
    """Return (AdresL1, AdresL2) for KSeF XML."""
    l1 = (street or "").strip()
    postal = (postal_code or "").strip()
    cty = (city or "").strip()
    l2 = f"{postal} {cty}".strip()
    return l1, l2


def generate_fa3_xml(invoice) -> str:
    """
    Build FA-3 KSeF XML for the given Invoice instance.
    invoice must have: company, customer, items (prefetched), all date fields.
    Returns XML string (UTF-8).
    """
    company = invoice.company
    customer = invoice.customer
    items = list(invoice.items.all())

    # --- Seller address ---
    seller_l1, seller_l2 = _build_address_lines(
        street=company.address,
        postal_code=company.postal_code,
        city=company.city,
    )

    # --- Buyer address ---
    buyer_name = customer.company_name or customer.name
    buyer_l1, buyer_l2 = _build_address_lines(
        street=customer.street,
        postal_code=customer.postal_code,
        city=customer.city,
    )

    is_kor = bool(getattr(invoice, "is_correction", False))

    # --- Original invoice items (needed for KOR before/after lines) ---
    # Match original→correction pairs by order_item_id (same FK copied by the service).
    # Items without order_item fall back to position-based matching.
    # pairs: list of (orig_item, corr_item)
    # added_items: correction items with no original pair (new lines added in correction)
    pairs: list[tuple] = []
    added_items: list = []
    if is_kor and invoice.corrects_invoice_id:
        raw_orig = list(invoice.corrects_invoice.items.all())
        raw_corr = list(invoice.items.all())

        # Build lookup: order_item_id → correction item
        corr_by_order_item: dict = {}
        corr_no_link: list = []
        for ci in raw_corr:
            if ci.order_item_id:
                corr_by_order_item[ci.order_item_id] = ci
            else:
                corr_no_link.append(ci)

        for oi in raw_orig:
            if oi.order_item_id and oi.order_item_id in corr_by_order_item:
                pairs.append((oi, corr_by_order_item[oi.order_item_id]))
            else:
                # Fallback: pair by position for items without order_item
                pairs.append((oi, corr_no_link.pop(0) if corr_no_link else oi))

        # Remaining corr_no_link = added lines (no original counterpart)
        added_items = corr_no_link

    def _rate_key(item) -> str:
        return str(int(item.vat_rate)) if item.vat_rate == item.vat_rate.to_integral_value() else str(item.vat_rate)

    # --- VAT summary ---
    # For KOR: show the DIFFERENCE (corrected − original); may be negative.
    # For regular invoices: sum of all lines.
    vat_groups: dict[str, dict] = {}  # rate_str -> {net, vat}
    total_gross = Decimal("0.00")

    if is_kor and pairs:
        # Build original totals keyed by rate
        orig_vat: dict[str, dict] = {}
        for orig, _corr in pairs:
            rk = _rate_key(orig)
            orig_vat.setdefault(rk, {"net": Decimal("0"), "vat": Decimal("0")})
            orig_vat[rk]["net"] += orig.line_net
            orig_vat[rk]["vat"] += orig.line_vat

        # Build corrected totals: non-removed pairs + added items
        new_vat: dict[str, dict] = {}
        for _orig, corr in pairs:
            if not getattr(corr, "is_removed", False):
                rk = _rate_key(corr)
                new_vat.setdefault(rk, {"net": Decimal("0"), "vat": Decimal("0")})
                new_vat[rk]["net"] += corr.line_net
                new_vat[rk]["vat"] += corr.line_vat
        for added in added_items:
            rk = _rate_key(added)
            new_vat.setdefault(rk, {"net": Decimal("0"), "vat": Decimal("0")})
            new_vat[rk]["net"] += added.line_net
            new_vat[rk]["vat"] += added.line_vat

        all_rates = set(orig_vat) | set(new_vat)
        for rk in all_rates:
            diff_net = new_vat.get(rk, {}).get("net", Decimal("0")) - orig_vat.get(rk, {}).get("net", Decimal("0"))
            diff_vat = new_vat.get(rk, {}).get("vat", Decimal("0")) - orig_vat.get(rk, {}).get("vat", Decimal("0"))
            vat_groups[rk] = {"net": diff_net, "vat": diff_vat}
            total_gross += diff_net + diff_vat
    else:
        for item in items:
            rate_key = _rate_key(item)
            vat_groups.setdefault(rate_key, {"net": Decimal("0.00"), "vat": Decimal("0.00")})
            vat_groups[rate_key]["net"] += item.line_net
            vat_groups[rate_key]["vat"] += item.line_vat
            total_gross += item.line_gross

    # FA-3 schema positions for VAT rates (covers most common Polish rates)
    _vat_position_map = {
        "23": ("P_13_1", "P_14_1"),
        "8":  ("P_13_2", "P_14_2"),
        "5":  ("P_13_3", "P_14_3"),
        "0":  ("P_13_6", "P_14_6"),
    }

    vat_fields_xml = ""
    for rate_key, amounts in vat_groups.items():
        # For KOR include lines even if negative; for regular only if positive
        if is_kor or amounts["net"] > Decimal("0"):
            tags = _vat_position_map.get(rate_key)
            if tags:
                vat_fields_xml += (
                    f"\n    <{tags[0]}>{_fmt_amount(amounts['net'])}</{tags[0]}>"
                    f"\n    <{tags[1]}>{_fmt_amount(amounts['vat'])}</{tags[1]}>"
                )

    # --- Line items (FaWiersz) ---
    def _item_gross_price(item) -> Decimal:
        vat_mult = Decimal("1") + item.vat_rate / Decimal("100")
        return (item.unit_price_net * vat_mult).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    def _fa_wiersz(idx: int, item, stan_przed: bool = False) -> str:
        pkwiu_tag = f"\n      <PKWiU>{_escape(item.pkwiu)}</PKWiU>" if item.pkwiu else ""
        stan_tag = "\n      <StanPrzed>1</StanPrzed>" if stan_przed else ""
        if is_kor:
            # KOR uses net price (P_9A) and net line total (P_11), not gross
            return f"""
    <FaWiersz>
      <NrWierszaFa>{idx}</NrWierszaFa>
      <P_7>{_escape(item.product_name)}</P_7>{pkwiu_tag}
      <P_8A>{_escape(item.product_unit or "szt")}</P_8A>
      <P_8B>{_fmt_amount(item.quantity)}</P_8B>
      <P_9A>{_fmt_amount(item.unit_price_net)}</P_9A>
      <P_11>{_fmt_amount(item.line_net)}</P_11>
      <P_12>{_rate_key(item)}</P_12>{stan_tag}
    </FaWiersz>"""
        else:
            # Regular invoice uses gross price (P_9B) and gross line total (P_11A)
            return f"""
    <FaWiersz>
      <NrWierszaFa>{idx}</NrWierszaFa>
      <P_7>{_escape(item.product_name)}</P_7>{pkwiu_tag}
      <P_8A>{_escape(item.product_unit or "szt")}</P_8A>
      <P_8B>{_fmt_amount(item.quantity)}</P_8B>
      <P_9B>{_fmt_amount(_item_gross_price(item))}</P_9B>
      <P_11A>{_fmt_amount(item.line_gross)}</P_11A>
      <P_12>{_rate_key(item)}</P_12>
    </FaWiersz>"""

    lines_xml = ""
    if is_kor and pairs:
        for idx, (orig, corr) in enumerate(pairs, start=1):
            # Always emit StanPrzed (original value)
            lines_xml += _fa_wiersz(idx, orig, stan_przed=True)
            # Emit "after" row only if line is NOT removed
            if not getattr(corr, "is_removed", False):
                lines_xml += _fa_wiersz(idx, corr, stan_przed=False)
        # Added lines (no original counterpart) — emit "after" row only
        for idx, added in enumerate(added_items, start=len(pairs) + 1):
            lines_xml += _fa_wiersz(idx, added, stan_przed=False)
    else:
        for idx, item in enumerate(items, start=1):
            lines_xml += _fa_wiersz(idx, item)

    # --- KOR: DaneFaKorygowanej block ---
    dane_kor_xml = ""
    if is_kor and invoice.corrects_invoice_id:
        orig_inv = invoice.corrects_invoice
        orig_ksef = orig_inv.ksef_number or ""
        ksef_nr_tag = ""
        if orig_ksef:
            ksef_nr_tag = f"\n    <NrKSeF>1</NrKSeF>\n    <NrKSeFFaKorygowanej>{_escape(orig_ksef)}</NrKSeFFaKorygowanej>"
        dane_kor_xml = f"""
  <DaneFaKorygowanej>
    <DataWystFaKorygowanej>{_fmt_date(orig_inv.issue_date)}</DataWystFaKorygowanej>
    <NrFaKorygowanej>{_escape(orig_inv.invoice_number)}</NrFaKorygowanej>{ksef_nr_tag}
  </DaneFaKorygowanej>"""

    rodzaj_faktury = "KOR" if is_kor else "VAT"

    # --- Creation timestamp (UTC, ISO 8601) ---
    now_utc = datetime.now(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>{now_utc}</DataWytworzeniaFa>
    <SystemInfo>MojeSaldoo App v1.0</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>{_escape(company.nip)}</NIP>
      <Nazwa>{_escape(company.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>{_escape(seller_l1)}</AdresL1>
      <AdresL2>{_escape(seller_l2)}</AdresL2>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>{_escape(customer.nip)}</NIP>
      <Nazwa>{_escape(buyer_name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>{_country_code(customer.country)}</KodKraju>
      <AdresL1>{_escape(buyer_l1)}</AdresL1>
      <AdresL2>{_escape(buyer_l2)}</AdresL2>
    </Adres>
    <JST>2</JST>
    <GV>2</GV>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>{_fmt_date(invoice.issue_date)}</P_1>
    <P_1M>{_escape(company.city or "Warszawa")}</P_1M>
    <P_2>{_escape(invoice.invoice_number)}</P_2>
    <P_6>{_fmt_date(invoice.sale_date)}</P_6>{vat_fields_xml}
    <P_15>{_fmt_amount(total_gross)}</P_15>
    <Adnotacje>
      <P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A>
      <Zwolnienie><P_19N>1</P_19N></Zwolnienie>
      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>
      <P_23>2</P_23>
      <PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>
    </Adnotacje>
    <RodzajFaktury>{rodzaj_faktury}</RodzajFaktury>{dane_kor_xml}
    {lines_xml}
    <Platnosc>
      <TerminPlatnosci>
        <Termin>{_fmt_date(invoice.due_date)}</Termin>
      </TerminPlatnosci>
      <FormaPlatnosci>{_payment_code(invoice.payment_method)}</FormaPlatnosci>
    </Platnosc>
  </Fa>
</Faktura>"""

    return xml


def generate_fa3_xml_base64(invoice) -> str:
    """Generate FA-3 XML and return it Base64-encoded (as expected by SSAPI)."""
    xml_str = generate_fa3_xml(invoice)
    return base64.b64encode(xml_str.encode("utf-8")).decode("ascii")
