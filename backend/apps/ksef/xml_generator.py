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
    return str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


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

    # --- VAT summary (P_13/P_14 fields) ---
    vat_groups: dict[str, dict] = {}  # rate_str -> {net, vat}
    total_gross = Decimal("0.00")

    for item in items:
        rate_key = str(int(item.vat_rate)) if item.vat_rate == item.vat_rate.to_integral_value() else str(item.vat_rate)
        if rate_key not in vat_groups:
            vat_groups[rate_key] = {"net": Decimal("0.00"), "vat": Decimal("0.00")}
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
        if amounts["net"] > Decimal("0"):
            tags = _vat_position_map.get(rate_key)
            if tags:
                vat_fields_xml += (
                    f"\n    <{tags[0]}>{_fmt_amount(amounts['net'])}</{tags[0]}>"
                    f"\n    <{tags[1]}>{_fmt_amount(amounts['vat'])}</{tags[1]}>"
                )

    # --- Line items (FaWiersz) ---
    lines_xml = ""
    for idx, item in enumerate(items, start=1):
        # FA-3 uses gross unit price (P_9B) and gross line total (P_11A)
        vat_multiplier = Decimal("1") + item.vat_rate / Decimal("100")
        unit_price_gross = (item.unit_price_net * vat_multiplier).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        pkwiu_tag = f"\n      <PKWiU>{_escape(item.pkwiu)}</PKWiU>" if item.pkwiu else ""
        lines_xml += f"""
    <FaWiersz>
      <NrWierszaFa>{idx}</NrWierszaFa>
      <P_7>{_escape(item.product_name)}</P_7>{pkwiu_tag}
      <P_8A>{_escape(item.product_unit or "szt")}</P_8A>
      <P_8B>{_fmt_amount(item.quantity)}</P_8B>
      <P_9B>{_fmt_amount(unit_price_gross)}</P_9B>
      <P_11A>{_fmt_amount(item.line_gross)}</P_11A>
      <P_12>{int(item.vat_rate) if item.vat_rate == item.vat_rate.to_integral_value() else item.vat_rate}</P_12>
    </FaWiersz>"""

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
    <RodzajFaktury>VAT</RodzajFaktury>
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
