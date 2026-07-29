"""
Pre-send KSeF invoice validator.

Validates every field that ends up in the FA-3 XML before xml_generator.py
is called. Mirrors the frontend invoiceValidator.ts logic but runs on the
authoritative Invoice model — cannot be bypassed by the client.

Usage:
    from apps.ksef.validators import validate_invoice_for_ksef

    errors, warnings = validate_invoice_for_ksef(invoice)
    if errors:
        return Response({"detail": errors}, status=400)
"""

from datetime import date as date_type
from decimal import Decimal

# ---------------------------------------------------------------------------
# Constants (FA-3 schema limits)
# ---------------------------------------------------------------------------

# Only these rates have dedicated P_13_X / P_14_X positions in the FA-3 schema.
# Historical rates (3, 4, 7, 22) are not supported and would be silently dropped
# from the XML, causing KSeF to reject the invoice.
_SUPPORTED_VAT_RATES: set[Decimal] = {
    Decimal("0"),
    Decimal("5"),
    Decimal("8"),
    Decimal("23"),
}

# KSeF rejects invoices dated more than this many days in the past
# (exception applies only during declared KSeF outages).
_MAX_DAYS_IN_PAST = 7

# FA-3 schema field length limits
_MAX_NIP = 10
_MAX_SELLER_NAME = 240
_MAX_BUYER_NAME = 240
_MAX_ADDRESS_L1 = 200
_MAX_ADDRESS_L2 = 200
_MAX_INVOICE_NUMBER = 256
_MAX_CITY = 256
_MAX_PRODUCT_NAME = 512
_MAX_PRODUCT_UNIT = 50

# Decimal precision limits (FA-3 schema)
_MAX_QTY_DECIMALS = 6        # P_8B
_MAX_PRICE_DECIMALS = 8      # P_9A / P_9B
_MAX_AMOUNT_DECIMALS = 2     # P_11 / P_11A / P_15

# Monetary tolerance for rounding errors (2 grosze)
_TOLERANCE = Decimal("0.02")

# Payment methods that map to FA-3 FormaPlatnosci codes.
# "card" exists in the Invoice model but has no FA-3 code (would silently map
# to "6"/transfer) — flag it so the user can correct the invoice.
_VALID_PAYMENT_METHODS = {"cash", "transfer"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decimal_places(value: Decimal) -> int:
    """Return the number of significant decimal places in a Decimal value."""
    sign, digits, exponent = value.normalize().as_tuple()
    return max(0, -exponent)


def _rate_key(vat_rate: Decimal) -> str:
    """Canonical string key for a VAT rate (e.g. Decimal('8.00') → '8')."""
    return (
        str(int(vat_rate))
        if vat_rate == vat_rate.to_integral_value()
        else str(vat_rate)
    )


# ---------------------------------------------------------------------------
# Main validator
# ---------------------------------------------------------------------------

def validate_invoice_for_ksef(invoice) -> tuple[list[str], list[str]]:
    """
    Validate an Invoice instance against all FA-3 KSeF requirements.

    Returns (errors, warnings).
    - errors: hard failures — KSeF will reject the invoice.
    - warnings: soft issues — invoice may still be accepted but warrants review.

    Does NOT raise; the caller decides whether to abort.
    Call this before generate_fa3_xml() in the send-to-ksef flow.
    """
    errors: list[str] = []
    warnings: list[str] = []
    today = date_type.today()

    company = invoice.company
    customer = invoice.customer
    items = list(invoice.items.all())

    # ------------------------------------------------------------------
    # 1. SELLER — Podmiot1 (from company)
    # ------------------------------------------------------------------

    # NIP (10 digits, no spaces/hyphens)
    seller_nip = (company.nip or "").replace(" ", "").replace("-", "")
    if not seller_nip:
        errors.append("Firma nie ma uzupełnionego NIP.")
    elif not seller_nip.isdigit() or len(seller_nip) != _MAX_NIP:
        errors.append(
            f"NIP firmy musi mieć dokładnie 10 cyfr (podano: '{company.nip}')."
        )

    # Nazwa (max 240)
    seller_name = (company.name or "").strip()
    if not seller_name:
        errors.append("Brak nazwy firmy (wymagane w FA-3 Podmiot1).")
    elif len(seller_name) > _MAX_SELLER_NAME:
        errors.append(
            f"Nazwa firmy zbyt długa ({len(seller_name)}/{_MAX_SELLER_NAME} znaków)."
        )

    # AdresL1 (street, max 200)
    seller_l1 = (company.address or "").strip()
    if len(seller_l1) > _MAX_ADDRESS_L1:
        errors.append(
            f"Adres firmy (ulica) zbyt długi ({len(seller_l1)}/{_MAX_ADDRESS_L1} znaków)."
        )

    # AdresL2 ("postal_code city", max 200)
    seller_l2 = f"{(company.postal_code or '').strip()} {(company.city or '').strip()}".strip()
    if len(seller_l2) > _MAX_ADDRESS_L2:
        errors.append(
            f"Adres firmy (kod + miasto) zbyt długi ({len(seller_l2)}/{_MAX_ADDRESS_L2} znaków)."
        )

    # P_1M: city of issue (max 256, defaults to "Warszawa" if empty — not an error)
    city_of_issue = (company.city or "").strip()
    if len(city_of_issue) > _MAX_CITY:
        errors.append(
            f"Miasto wystawienia zbyt długie ({len(city_of_issue)}/{_MAX_CITY} znaków)."
        )

    # ------------------------------------------------------------------
    # 2. BUYER — Podmiot2 (from customer)
    # ------------------------------------------------------------------

    # NIP
    buyer_nip = (customer.nip or "").replace(" ", "").replace("-", "")
    if not buyer_nip:
        errors.append("Nabywca nie ma uzupełnionego NIP.")
    elif not buyer_nip.isdigit() or len(buyer_nip) != _MAX_NIP:
        errors.append(
            f"NIP nabywcy musi mieć dokładnie 10 cyfr (podano: '{customer.nip}')."
        )

    # Nazwa
    buyer_name = (
        getattr(customer, "company_name", None) or getattr(customer, "name", None) or ""
    ).strip()
    if not buyer_name:
        errors.append("Brak nazwy nabywcy (wymagane w FA-3 Podmiot2).")
    elif len(buyer_name) > _MAX_BUYER_NAME:
        errors.append(
            f"Nazwa nabywcy zbyt długa ({len(buyer_name)}/{_MAX_BUYER_NAME} znaków)."
        )

    # AdresL1
    buyer_l1 = (getattr(customer, "street", None) or "").strip()
    if len(buyer_l1) > _MAX_ADDRESS_L1:
        errors.append(
            f"Adres nabywcy (ulica) zbyt długi ({len(buyer_l1)}/{_MAX_ADDRESS_L1} znaków)."
        )

    # AdresL2
    buyer_l2 = (
        f"{(getattr(customer, 'postal_code', None) or '').strip()} "
        f"{(getattr(customer, 'city', None) or '').strip()}"
    ).strip()
    if len(buyer_l2) > _MAX_ADDRESS_L2:
        errors.append(
            f"Adres nabywcy (kod + miasto) zbyt długi ({len(buyer_l2)}/{_MAX_ADDRESS_L2} znaków)."
        )

    # ------------------------------------------------------------------
    # 3. INVOICE METADATA — Fa block
    # ------------------------------------------------------------------

    # P_2: invoice number
    inv_number = (invoice.invoice_number or "").strip()
    if not inv_number:
        errors.append("Brak numeru faktury (P_2).")
    elif len(inv_number) > _MAX_INVOICE_NUMBER:
        errors.append(
            f"Numer faktury zbyt długi ({len(inv_number)}/{_MAX_INVOICE_NUMBER} znaków)."
        )

    # P_1: issue_date — required, must not be in future, max 7 days in past
    issue_date = invoice.issue_date
    if not issue_date:
        errors.append("Brak daty wystawienia faktury (P_1).")
    else:
        delta = (today - issue_date).days
        if delta < 0:
            errors.append("Data wystawienia nie może być w przyszłości (P_1).")
        elif delta > _MAX_DAYS_IN_PAST:
            errors.append(
                f"Data wystawienia jest {delta} dni wstecz — KSeF akceptuje "
                f"max {_MAX_DAYS_IN_PAST} dni przy problemach technicznych (P_1)."
            )
        elif delta > 1:
            warnings.append(
                f"Data wystawienia jest {delta} dni wstecz. "
                f"Dopuszczalne tylko przy zgłoszonych problemach technicznych KSeF."
            )

    # P_6: sale_date — required, must be ≤ issue_date
    sale_date = invoice.sale_date
    if not sale_date:
        errors.append("Brak daty sprzedaży (P_6).")
    elif issue_date and sale_date > issue_date:
        errors.append(
            f"Data sprzedaży ({sale_date}) nie może być późniejsza "
            f"niż data wystawienia ({issue_date}) (P_6)."
        )

    # due_date — required, must be ≥ issue_date
    due_date = invoice.due_date
    if not due_date:
        errors.append("Brak terminu płatności (TerminPlatnosci).")
    elif issue_date and due_date < issue_date:
        errors.append(
            f"Termin płatności ({due_date}) nie może być wcześniejszy "
            f"niż data wystawienia ({issue_date})."
        )

    # FormaPlatnosci — only cash/transfer map to valid FA-3 codes
    if invoice.payment_method not in _VALID_PAYMENT_METHODS:
        errors.append(
            f"Forma płatności '{invoice.payment_method}' nie jest obsługiwana przez KSeF "
            f"(dozwolone: 'transfer' = przelew, 'cash' = gotówka)."
        )

    # ------------------------------------------------------------------
    # 4. CORRECTION INVOICE (KOR) — DaneFaKorygowanej
    # ------------------------------------------------------------------

    if invoice.is_correction:
        orig = invoice.corrects_invoice
        if orig is None:
            errors.append(
                "Faktura korygująca (KOR) nie ma przypisanej faktury oryginalnej "
                "(corrects_invoice)."
            )
        else:
            orig_number = (orig.invoice_number or "").strip()
            if not orig_number:
                errors.append(
                    "Faktura oryginalna nie ma numeru (NrFaKorygowanej — wymagane w KOR)."
                )
            elif len(orig_number) > _MAX_INVOICE_NUMBER:
                errors.append(
                    f"Numer faktury oryginalnej zbyt długi "
                    f"({len(orig_number)}/{_MAX_INVOICE_NUMBER} znaków)."
                )

            if not orig.issue_date:
                errors.append(
                    "Faktura oryginalna nie ma daty wystawienia "
                    "(DataWystFaKorygowanej — wymagane w KOR)."
                )

            # If original was accepted in KSeF, its ksef_number must be present
            # so we can include NrKSeFFaKorygowanej in the XML.
            if getattr(orig, "ksef_status", None) == "accepted" and not orig.ksef_number:
                warnings.append(
                    "Faktura oryginalna ma status 'accepted' w KSeF, ale brak numeru KSeF. "
                    "Pole NrKSeFFaKorygowanej nie zostanie wysłane — sprawdź przed wysłaniem."
                )

    # ------------------------------------------------------------------
    # 5. LINE ITEMS — FaWiersz
    # ------------------------------------------------------------------

    if not items:
        errors.append("Faktura nie ma żadnych pozycji (FaWiersz).")

    line_gross_sum = Decimal("0.00")
    vat_groups: dict[str, dict[str, Decimal]] = {}

    for idx, item in enumerate(items, start=1):
        pname = (item.product_name or "").strip()
        label = f"Pozycja #{idx} ({pname or '?'})"

        # P_7: product/service name
        if not pname:
            errors.append(f"{label}: Brak nazwy produktu/usługi (P_7).")
        elif len(pname) > _MAX_PRODUCT_NAME:
            errors.append(
                f"{label}: Nazwa zbyt długa ({len(pname)}/{_MAX_PRODUCT_NAME} znaków, P_7)."
            )

        # P_8A: unit (optional, but length-limited)
        unit = (item.product_unit or "").strip()
        if len(unit) > _MAX_PRODUCT_UNIT:
            errors.append(
                f"{label}: Jednostka miary zbyt długa "
                f"({len(unit)}/{_MAX_PRODUCT_UNIT} znaków, P_8A)."
            )

        # P_8B: quantity — must be > 0, max 6 decimal places
        qty = item.quantity
        if qty is None or qty <= 0:
            errors.append(f"{label}: Ilość musi być większa od 0 (P_8B).")
        elif _decimal_places(qty) > _MAX_QTY_DECIMALS:
            errors.append(
                f"{label}: Ilość ma zbyt wiele miejsc po przecinku "
                f"({_decimal_places(qty)}/{_MAX_QTY_DECIMALS}, P_8B)."
            )

        # P_9A / P_9B: unit price — max 8 decimal places
        unit_price = item.unit_price_net
        if unit_price is None:
            errors.append(f"{label}: Brak ceny jednostkowej netto.")
        else:
            if not invoice.is_correction and unit_price <= 0:
                errors.append(
                    f"{label}: Cena jednostkowa netto musi być większa od 0 (P_9B)."
                )
            if _decimal_places(unit_price) > _MAX_PRICE_DECIMALS:
                errors.append(
                    f"{label}: Cena jednostkowa ma zbyt wiele miejsc po przecinku "
                    f"({_decimal_places(unit_price)}/{_MAX_PRICE_DECIMALS})."
                )

        # P_12: VAT rate — must be in the supported set
        vat_rate = item.vat_rate
        if vat_rate not in _SUPPORTED_VAT_RATES:
            errors.append(
                f"{label}: Stawka VAT {vat_rate}% nie jest obsługiwana w FA-3 "
                f"(dozwolone: 0%, 5%, 8%, 23%). Stawka zostałaby pominięta w XML."
            )

        # Line totals — max 2 decimal places each
        line_net = item.line_net or Decimal("0.00")
        line_vat = item.line_vat or Decimal("0.00")
        line_gross = item.line_gross or Decimal("0.00")

        if _decimal_places(line_net) > _MAX_AMOUNT_DECIMALS:
            errors.append(
                f"{label}: Wartość netto ma zbyt wiele miejsc po przecinku "
                f"(max {_MAX_AMOUNT_DECIMALS}, P_11)."
            )
        if _decimal_places(line_vat) > _MAX_AMOUNT_DECIMALS:
            errors.append(
                f"{label}: Kwota VAT ma zbyt wiele miejsc po przecinku "
                f"(max {_MAX_AMOUNT_DECIMALS})."
            )
        if _decimal_places(line_gross) > _MAX_AMOUNT_DECIMALS:
            errors.append(
                f"{label}: Wartość brutto ma zbyt wiele miejsc po przecinku "
                f"(max {_MAX_AMOUNT_DECIMALS}, P_11A)."
            )

        # Internal line consistency: net + vat must equal gross
        expected_gross = line_net + line_vat
        if abs(expected_gross - line_gross) > _TOLERANCE:
            errors.append(
                f"{label}: Netto ({line_net}) + VAT ({line_vat}) = {expected_gross} "
                f"≠ brutto ({line_gross}). KSeF odrzuci fakturę (tolerancja: {_TOLERANCE} PLN)."
            )

        # Accumulate for cross-line checksum
        line_gross_sum += line_gross
        rk = _rate_key(vat_rate)
        if rk not in vat_groups:
            vat_groups[rk] = {
                "net": Decimal("0.00"),
                "vat": Decimal("0.00"),
                "gross": Decimal("0.00"),
            }
        vat_groups[rk]["net"] += line_net
        vat_groups[rk]["vat"] += line_vat
        vat_groups[rk]["gross"] += line_gross

    # ------------------------------------------------------------------
    # 6. TOTALS CHECKSUM — P_15 and per-rate sums (most critical)
    # ------------------------------------------------------------------

    total_gross = invoice.total_gross or Decimal("0.00")

    # P_15 must match the sum of all line gross totals
    if items and abs(total_gross - line_gross_sum) > _TOLERANCE:
        errors.append(
            f"Suma brutto faktury (P_15 = {total_gross}) nie zgadza się z sumą "
            f"pozycji ({line_gross_sum}). "
            f"Różnica: {abs(total_gross - line_gross_sum)} PLN. "
            f"KSeF odrzuci fakturę."
        )

    # Per VAT rate: net + vat must equal gross
    for rk, totals in vat_groups.items():
        net_sum = totals["net"]
        vat_sum = totals["vat"]
        gross_sum = totals["gross"]
        expected = net_sum + vat_sum
        if abs(expected - gross_sum) > _TOLERANCE:
            errors.append(
                f"Błąd sumy kontrolnej VAT {rk}%: "
                f"netto ({net_sum}) + VAT ({vat_sum}) = {expected} "
                f"≠ brutto ({gross_sum}). Różnica: {abs(expected - gross_sum)} PLN."
            )

    # ------------------------------------------------------------------
    # 7. KSEF INVOICE TYPE
    # ------------------------------------------------------------------
    ksef_type = getattr(invoice, "ksef_invoice_type", "VAT") or "VAT"
    if not invoice.is_correction and ksef_type in ("ZAL", "ROZ"):
        errors.append(
            f"Typ faktury '{ksef_type}' (zaliczkowa/rozliczeniowa) nie jest jeszcze obsługiwany "
            f"w generatorze FA-3. Zmień rodzaj faktury na 'VAT' lub skontaktuj się z pomocą techniczną."
        )

    # ------------------------------------------------------------------
    # 8. ANNOTATION MUTUAL EXCLUSIONS
    # ------------------------------------------------------------------
    if getattr(invoice, "annotation_zwolnienie", False) and getattr(invoice, "annotation_mpp", False):
        errors.append(
            "Adnotacje 'Zwolnienie z VAT' i 'Mechanizm podzielonej płatności (MPP)' "
            "nie mogą być zaznaczone jednocześnie."
        )
    if getattr(invoice, "annotation_zwolnienie", False) and getattr(invoice, "annotation_marza", False):
        errors.append(
            "Adnotacje 'Zwolnienie z VAT' i 'Procedura marży' nie mogą być zaznaczone jednocześnie."
        )

    # ------------------------------------------------------------------
    # 9. BANK ACCOUNT
    # ------------------------------------------------------------------
    bank_iban = (getattr(invoice, "bank_account_iban", "") or "").strip().replace(" ", "")
    if bank_iban:
        if invoice.payment_method == "cash":
            warnings.append(
                "Numer rachunku bankowego podany dla faktury gotówkowej. "
                "Rachunek bankowy zostanie pominięty w XML (nie dotyczy gotówki)."
            )
        elif len(bank_iban) < 15 or len(bank_iban) > 34:
            errors.append(
                f"Numer IBAN '{bank_iban}' ma nieprawidłową długość ({len(bank_iban)} znaków; wymagane 15–34)."
            )
        elif not bank_iban[:2].isalpha():
            errors.append(
                f"Numer IBAN musi zaczynać się od 2-literowego kodu kraju (np. 'PL')."
            )

    bank_swift = (getattr(invoice, "bank_swift", "") or "").strip()
    if bank_swift and not (8 <= len(bank_swift) <= 11 and bank_swift.isalnum()):
        errors.append(
            f"Kod SWIFT '{bank_swift}' jest nieprawidłowy (wymagane 8 lub 11 znaków alfanumerycznych)."
        )

    # ------------------------------------------------------------------
    # 10. OPTIONAL FIELD LENGTH GUARDS
    # ------------------------------------------------------------------
    payment_link = (getattr(invoice, "payment_link", "") or "").strip()
    if len(payment_link) > 512:
        errors.append(f"Link do płatności zbyt długi ({len(payment_link)}/512 znaków).")

    ksef_pid = (getattr(invoice, "ksef_payment_id", "") or "").strip()
    if len(ksef_pid) > 50:
        errors.append(f"Identyfikator płatności KSeF zbyt długi ({len(ksef_pid)}/50 znaków).")

    discount = (getattr(invoice, "discount_conditions", "") or "").strip()
    if len(discount) > 256:
        errors.append(f"Warunki skonta zbyt długie ({len(discount)}/256 znaków).")

    footer = (getattr(invoice, "footer_text", "") or "").strip()
    if len(footer) > 3500:
        errors.append(f"Stopka faktury zbyt długa ({len(footer)}/3500 znaków).")

    return errors, warnings
