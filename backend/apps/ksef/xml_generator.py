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
    """Map Invoice.payment_method to FA-3 FormaPlatnosci code.
    1=gotówka, 2=karta, 3=bon, 4=czek, 5=kredyt, 6=przelew, 7=mobilna, 8=inna.
    """
    return {
        "cash": "1",
        "card": "2",
        "voucher": "3",
        "check": "4",
        "credit": "5",
        "transfer": "6",
        "mobile": "7",
        "other": "8",
    }.get(payment_method, "6")


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


def _build_p6_xml(invoice) -> str:
    """
    Zwraca XML dla pola P_6 / OkresFa zgodnie z wybranym wariantem sale_date_type.

    Warianty FA-3:
      single  → <P_6>YYYY-MM-DD</P_6>
      period  → <OkresFa><P_6_Od>...</P_6_Od><P_6_Do>...</P_6_Do></OkresFa>
      issue   → brak (data wystawienia = data wykonania)
      various → brak (różne daty per wiersz)
    """
    sdt = getattr(invoice, "sale_date_type", "single") or "single"
    if sdt == "period":
        date_from = _fmt_date(invoice.sale_date)
        date_to = _fmt_date(invoice.sale_date_to) if invoice.sale_date_to else date_from
        return f"<OkresFa><P_6_Od>{date_from}</P_6_Od><P_6_Do>{date_to}</P_6_Do></OkresFa>"
    elif sdt in ("issue", "various"):
        return ""
    else:  # single (default)
        return f"<P_6>{_fmt_date(invoice.sale_date)}</P_6>"


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

    # --- Seller contact data (DaneKontaktowe) ---
    seller_phone = (getattr(company, "phone", "") or "").strip()
    seller_email = (getattr(company, "email", "") or "").strip()
    seller_contact_xml = ""
    if seller_phone or seller_email:
        contact_inner = ""
        if seller_phone:
            contact_inner += f"\n      <Telefon>{_escape(seller_phone)}</Telefon>"
        if seller_email:
            contact_inner += f"\n      <Email>{_escape(seller_email)}</Email>"
        seller_contact_xml = f"\n    <DaneKontaktowe>{contact_inner}\n    </DaneKontaktowe>"

    # --- Buyer address ---
    buyer_name = customer.company_name or customer.name
    buyer_l1, buyer_l2 = _build_address_lines(
        street=customer.street,
        postal_code=customer.postal_code,
        city=customer.city,
    )

    # --- Buyer contact data (DaneKontaktowe) ---
    buyer_phone = (getattr(customer, "phone", "") or "").strip()
    buyer_email = (getattr(customer, "email", "") or "").strip()
    buyer_contact_xml = ""
    if buyer_phone or buyer_email:
        contact_inner = ""
        if buyer_phone:
            contact_inner += f"\n      <Telefon>{_escape(buyer_phone)}</Telefon>"
        if buyer_email:
            contact_inner += f"\n      <Email>{_escape(buyer_email)}</Email>"
        buyer_contact_xml = f"\n    <DaneKontaktowe>{contact_inner}\n    </DaneKontaktowe>"

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

    # --- Optional invoice-level flags ---
    is_mpp = bool(getattr(invoice, "annotation_mpp", False))
    is_kasowa = bool(getattr(invoice, "annotation_kasowa", False))
    is_odwrotne = bool(getattr(invoice, "annotation_odwrotne", False))
    is_trojstronna = bool(getattr(invoice, "annotation_trojstronna", False))
    is_zwolnienie = bool(getattr(invoice, "annotation_zwolnienie", False))
    is_marza = bool(getattr(invoice, "annotation_marza", False))
    is_tp = bool(getattr(invoice, "annotation_tp", False))
    is_fp = bool(getattr(invoice, "annotation_fp", False))
    is_oss = bool(getattr(invoice, "annotation_oss", False))

    # JST / GV from customer (defaults: 2 = nie dotyczy)
    jst_val = "1" if getattr(customer, "is_jst", False) else "2"
    gv_val = "1" if getattr(customer, "is_gv_member", False) else "2"

    # Podmiot3 (optional third party: faktor or odbiorca)
    podmiot3_role = (getattr(customer, "podmiot3_role", "") or "").strip()
    podmiot3_xml = ""
    if podmiot3_role:
        p3_name = (getattr(customer, "podmiot3_name", "") or "").strip()
        p3_id_wew = (getattr(customer, "podmiot3_id_wew", "") or "").strip()
        p3_l1, p3_l2 = _build_address_lines(
            street=getattr(customer, "podmiot3_street", "") or "",
            postal_code=getattr(customer, "podmiot3_postal_code", "") or "",
            city=getattr(customer, "podmiot3_city", "") or "",
        )
        p3_country = _country_code(getattr(customer, "podmiot3_country", "PL") or "PL")
        # Auto-detect: 10 digits = NIP, anything else = IDWew (e.g. "8441866342-27001")
        if p3_id_wew and p3_id_wew.isdigit() and len(p3_id_wew) == 10:
            ident_inner = f"\n      <NIP>{_escape(p3_id_wew)}</NIP>"
        elif p3_id_wew:
            ident_inner = f"\n      <IDWew>{_escape(p3_id_wew)}</IDWew>"
        else:
            ident_inner = ""
        # OpisRoli — required when role = "12" (Rola inna)
        p3_role_opis = (getattr(customer, "podmiot3_role_opis", "") or "").strip()
        opis_roli_xml = f"\n    <OpisRoli>{_escape(p3_role_opis)}</OpisRoli>" if podmiot3_role == "12" and p3_role_opis else ""
        podmiot3_xml = f"""
  <Podmiot3>
    <DaneIdentyfikacyjne>{ident_inner}
      <Nazwa>{_escape(p3_name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>{p3_country}</KodKraju>
      <AdresL1>{_escape(p3_l1)}</AdresL1>
      <AdresL2>{_escape(p3_l2)}</AdresL2>
    </Adres>
    <Rola>{podmiot3_role}</Rola>{opis_roli_xml}
  </Podmiot3>"""

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

    # --- Adnotacje block (dynamic) ---
    zwolnienie_inner = "<P_19>1</P_19>" if is_zwolnienie else "<P_19N>1</P_19N>"
    marza_inner = "<P_PMarzy>1</P_PMarzy>" if is_marza else "<P_PMarzyN>1</P_PMarzyN>"
    adnotacje_xml = f"""
    <Adnotacje>
      <P_16>{"1" if is_mpp else "2"}</P_16>
      <P_17>{"1" if is_kasowa else "2"}</P_17>
      <P_18>{"1" if is_odwrotne else "2"}</P_18>
      <P_18A>{"1" if is_trojstronna else "2"}</P_18A>
      <Zwolnienie>{zwolnienie_inner}</Zwolnienie>
      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>
      <P_23>{"1" if is_marza else "2"}</P_23>
      <PMarzy>{marza_inner}</PMarzy>
    </Adnotacje>"""

    # P_106E_1/2/3 — after Adnotacje, before RodzajFaktury (per FA-3 schema ordering)
    p106e_xml = ""
    if is_oss:
        p106e_xml += "\n    <P_106E_1>1</P_106E_1>"
    if is_tp:
        p106e_xml += "\n    <P_106E_2>1</P_106E_2>"
    if is_fp:
        p106e_xml += "\n    <P_106E_3>1</P_106E_3>"

    # --- RodzajFaktury: KOR overrides model field ---
    ksef_type = getattr(invoice, "ksef_invoice_type", "VAT") or "VAT"
    rodzaj_faktury = "KOR" if is_kor else ksef_type

    # --- Stopka faktury (after FaWiersz, before Platnosc) ---
    stopka_xml = ""
    footer = (getattr(invoice, "footer_text", "") or "").strip()
    if footer:
        stopka_xml = f"\n    <StopkaFaktury>{_escape(footer)}</StopkaFaktury>"

    # --- WZ: numery dokumentów magazynowych (FA-3 pole fakultatywne, max 1000, po P_2) ---
    wz_xml = ""
    if getattr(invoice, "show_wz_numbers", False):
        from apps.delivery.models import DeliveryDocument
        order_ids = list(invoice.invoice_orders.values_list("order_id", flat=True))
        if order_ids:
            wz_nums = list(
                DeliveryDocument.objects.filter(
                    order_id__in=order_ids,
                    document_type=DeliveryDocument.DOC_TYPE_WZ,
                ).values_list("document_number", flat=True).order_by("issue_date")
            )
            wz_nums = [n for n in wz_nums if n][:1000]
            for num in wz_nums:
                wz_xml += f"\n    <WZ>{_escape(num)}</WZ>"

    # --- Platnosc extras ---
    # Bank account: only emit for transfer payments
    bank_xml = ""
    bank_iban = (getattr(invoice, "bank_account_iban", "") or "").strip()
    if bank_iban and invoice.payment_method == "transfer":
        bank_swift_val = (getattr(invoice, "bank_swift", "") or "").strip()
        bank_name_val = (getattr(invoice, "bank_name", "") or "").strip()
        bank_xml = f"""
      <RachunekBankowy>
        <NrRB>{_escape(bank_iban)}</NrRB>"""
        if bank_swift_val:
            bank_xml += f"\n        <SWIFT>{_escape(bank_swift_val)}</SWIFT>"
        if bank_name_val:
            bank_xml += f"\n        <NazwaBanku>{_escape(bank_name_val)}</NazwaBanku>"
        bank_xml += "\n      </RachunekBankowy>"

    skonto_xml = ""
    discount = (getattr(invoice, "discount_conditions", "") or "").strip()
    if discount:
        skonto_xml = f"\n      <Skonto>{_escape(discount)}</Skonto>"

    link_xml = ""
    payment_link_val = (getattr(invoice, "payment_link", "") or "").strip()
    if payment_link_val:
        link_xml = f"\n      <LinkDoPlatnosci>{_escape(payment_link_val)}</LinkDoPlatnosci>"

    ksef_pid_xml = ""
    ksef_pid_val = (getattr(invoice, "ksef_payment_id", "") or "").strip()
    if ksef_pid_val:
        ksef_pid_xml = f"\n      <IdPlatnosci>{_escape(ksef_pid_val)}</IdPlatnosci>"

    # InnyRodzajPlatnosci — required when FormaPlatnosci=8 (other)
    other_pm_xml = ""
    other_pm_desc = (getattr(invoice, "other_payment_description", "") or "").strip()
    if invoice.payment_method == "other" and other_pm_desc:
        other_pm_xml = f"\n      <InnyRodzajPlatnosci>{_escape(other_pm_desc)}</InnyRodzajPlatnosci>"

    # P_IZ — informacja o zapłacie: 1=zapłacono, 2=nie zapłacono
    # DataZaplaty — data otrzymania zapłaty (required when P_IZ=1)
    p_iz_xml = ""
    payment_received = getattr(invoice, "payment_received_at", None)
    if payment_received is not None:
        p_iz_xml = (
            "\n      <P_IZ>1</P_IZ>"
            f"\n      <DataZaplaty>{_fmt_date(payment_received)}</DataZaplaty>"
        )

    # --- Rejestry (seller registry identifiers) ---
    # NOTE: element names (KRS/REGON/BDO) and their ordering inside DaneIdentyfikacyjne
    # must be verified against the official FA-3 XSD at
    # http://crd.gov.pl/wzor/2025/06/25/13775/ before production use.
    # TODO: verify Rejestry sub-element ordering from XSD.
    regon_val = (getattr(company, "regon", "") or "").strip()
    krs_val = (getattr(company, "krs", "") or "").strip()
    bdo_val = (getattr(company, "bdo", "") or "").strip()
    rejestry_xml = ""
    if krs_val or regon_val or bdo_val:
        rejestry_inner = ""
        if krs_val:
            rejestry_inner += f"\n      <KRS>{_escape(krs_val)}</KRS>"
        if regon_val:
            rejestry_inner += f"\n      <REGON>{_escape(regon_val)}</REGON>"
        if bdo_val:
            rejestry_inner += f"\n      <BDO>{_escape(bdo_val)}</BDO>"
        rejestry_xml = f"\n    <Rejestry>{rejestry_inner}\n    </Rejestry>"

    # --- KOR: DaneFaKorygowanej block ---
    dane_kor_xml = ""
    if is_kor and invoice.corrects_invoice_id:
        orig_inv = invoice.corrects_invoice
        orig_ksef = orig_inv.ksef_number or ""
        ksef_nr_tag = ""
        if orig_ksef:
            ksef_nr_tag = f"\n    <NrKSeF>1</NrKSeF>\n    <NrKSeFFaKorygowanej>{_escape(orig_ksef)}</NrKSeFFaKorygowanej>"
        correction_reason = (getattr(invoice, "correction_reason", "") or "").strip()
        przyczyna_xml = f"\n    <PrzyczynaKorekty>{_escape(correction_reason)}</PrzyczynaKorekty>" if correction_reason else ""
        dane_kor_xml = f"""
  <DaneFaKorygowanej>
    <DataWystFaKorygowanej>{_fmt_date(orig_inv.issue_date)}</DataWystFaKorygowanej>
    <NrFaKorygowanej>{_escape(orig_inv.invoice_number)}</NrFaKorygowanej>{ksef_nr_tag}{przyczyna_xml}
  </DaneFaKorygowanej>"""

    # --- ROZ: Rozliczenie block ---
    rozliczenie_xml = ""
    if rodzaj_faktury == "ROZ":
        from apps.invoices.models import InvoiceAdvance
        advance_links = list(
            InvoiceAdvance.objects.filter(roz_invoice=invoice).select_related("zal_invoice")
        )
        if advance_links:
            odliczenia_entries = ""
            wartosc_odliczen = Decimal("0.00")
            for link in advance_links:
                zal_inv = link.zal_invoice
                zal_ksef_nr = (zal_inv.ksef_number or "").strip()
                if zal_ksef_nr:
                    # ZAL was sent to KSeF — use KSeF number
                    odliczenia_entries += f"\n      <NrKSeFFaZaliczkowej>{_escape(zal_ksef_nr)}</NrKSeFFaZaliczkowej>"
                else:
                    # ZAL not in KSeF — use regular invoice number
                    odliczenia_entries += f"\n      <NrFaZaliczkowej>{_escape(zal_inv.invoice_number or '')}</NrFaZaliczkowej>"
                deduction = link.deduction_amount if link.deduction_amount is not None else zal_inv.total_gross
                wartosc_odliczen += deduction
            odliczenia_entries += f"\n      <WartoscOdliczen>{_fmt_amount(wartosc_odliczen)}</WartoscOdliczen>"
            kwota_pozostala = max(total_gross - wartosc_odliczen, Decimal("0.00"))
            rozliczenie_xml = (
                f"\n  <Rozliczenie>"
                f"\n    <Obciazenia>"
                f"\n      <WartoscObciazen>{_fmt_amount(total_gross)}</WartoscObciazen>"
                f"\n    </Obciazenia>"
                f"\n    <Odliczenia>{odliczenia_entries}"
                f"\n    </Odliczenia>"
                f"\n    <P_15ZAL>{_fmt_amount(kwota_pozostala)}</P_15ZAL>"
                f"\n  </Rozliczenie>"
            )

    # --- WarunkiTransakcji (optional: contracts / purchase_orders) ---
    # FA-3: each entry can have <DataUmowy>/<NrUmowy> and <DataZamowienia>/<NrZamowienia>
    warunki_xml = ""
    contracts_val = getattr(invoice, "contracts", None) or []
    purchase_orders_val = getattr(invoice, "purchase_orders", None) or []
    if contracts_val or purchase_orders_val:
        warunki_inner = ""
        for entry in contracts_val:
            entry_inner = ""
            d = (entry.get("date") or "").strip()
            n = (entry.get("number") or "").strip()
            if d:
                entry_inner += f"\n      <DataUmowy>{_escape(d)}</DataUmowy>"
            if n:
                entry_inner += f"\n      <NrUmowy>{_escape(n)}</NrUmowy>"
            if entry_inner:
                warunki_inner += f"\n    <Umowa>{entry_inner}\n    </Umowa>"
        for entry in purchase_orders_val:
            entry_inner = ""
            d = (entry.get("date") or "").strip()
            n = (entry.get("number") or "").strip()
            if d:
                entry_inner += f"\n      <DataZamowienia>{_escape(d)}</DataZamowienia>"
            if n:
                entry_inner += f"\n      <NrZamowienia>{_escape(n)}</NrZamowienia>"
            if entry_inner:
                warunki_inner += f"\n    <Zamowienie>{entry_inner}\n    </Zamowienie>"
        if warunki_inner:
            warunki_xml = f"\n  <WarunkiTransakcji>{warunki_inner}\n  </WarunkiTransakcji>"

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
      <Nazwa>{_escape(company.name)}</Nazwa>{rejestry_xml}
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>{_escape(seller_l1)}</AdresL1>
      <AdresL2>{_escape(seller_l2)}</AdresL2>
    </Adres>{seller_contact_xml}
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
    </Adres>{buyer_contact_xml}
    <JST>{jst_val}</JST>
    <GV>{gv_val}</GV>
  </Podmiot2>{podmiot3_xml}
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>{_fmt_date(invoice.issue_date)}</P_1>
    <P_1M>{_escape(invoice.place_of_issue or company.city or "Warszawa")}</P_1M>
    <P_2>{_escape(invoice.invoice_number)}</P_2>{wz_xml}
    {_build_p6_xml(invoice)}{vat_fields_xml}
    <P_15>{_fmt_amount(total_gross)}</P_15>{adnotacje_xml}{p106e_xml}
    <RodzajFaktury>{rodzaj_faktury}</RodzajFaktury>{dane_kor_xml}{rozliczenie_xml}
    {lines_xml}{stopka_xml}
    <Platnosc>
      <TerminPlatnosci>
        {f"<OpisTerminuPlatnosci>{_escape(invoice.due_date_description.strip())}</OpisTerminuPlatnosci>" if getattr(invoice, "due_date_description", "").strip() else f"<Termin>{_fmt_date(invoice.due_date)}</Termin>"}
      </TerminPlatnosci>
      <FormaPlatnosci>{_payment_code(invoice.payment_method)}</FormaPlatnosci>{other_pm_xml}{bank_xml}{skonto_xml}{link_xml}{ksef_pid_xml}{p_iz_xml}
    </Platnosc>
  </Fa>{warunki_xml}
</Faktura>"""

    return xml


def generate_fa3_xml_base64(invoice) -> str:
    """Generate FA-3 XML and return it Base64-encoded (as expected by SSAPI)."""
    xml_str = generate_fa3_xml(invoice)
    return base64.b64encode(xml_str.encode("utf-8")).decode("ascii")
