"""VAT deduction helpers shared by cash flow, purchases, and KSeF inbox."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

VAT_DEDUCTION_FULL = "full"
VAT_DEDUCTION_HALF = "half"
VAT_DEDUCTION_NONE = "none"

VAT_DEDUCTION_CHOICES = [
    (VAT_DEDUCTION_FULL, "100% — działalność"),
    (VAT_DEDUCTION_HALF, "50% — samochód osobowy"),
    (VAT_DEDUCTION_NONE, "0% — brak odliczenia"),
]

CENT = Decimal("0.01")
CENT4 = Decimal("0.0001")
_ZERO = Decimal("0.00")


def parse_vat_rate(raw) -> Decimal | None:
    """Return a percent rate (e.g. 8 or 23) or None if missing/invalid/zero."""
    if raw is None:
        return None
    text = str(raw).strip().replace("%", "").replace(",", ".")
    if not text:
        return None
    try:
        rate = Decimal(text)
    except (InvalidOperation, TypeError):
        return None
    if rate <= 0:
        return None
    return rate


def deduction_share(code: str | None) -> Decimal:
    if code == VAT_DEDUCTION_HALF:
        return Decimal("0.5")
    if code == VAT_DEDUCTION_NONE:
        return _ZERO
    return Decimal("1")


def q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def deductible_vat(
    *,
    stored_vat: Decimal | None = None,
    gross: Decimal | None = None,
    vat_rate=None,
    vat_deduction: str | None = VAT_DEDUCTION_FULL,
    is_private: bool = False,
) -> Decimal:
    """VAT the taxpayer may deduct.

    Never invents 23%. A missing rate with only a gross amount yields 0.
    ``is_private`` always yields 0 (personal spend).
    """
    if is_private:
        return _ZERO
    share = deduction_share(vat_deduction)
    if share == 0:
        return _ZERO
    if stored_vat is not None:
        return q(stored_vat * share)
    rate = parse_vat_rate(vat_rate)
    if rate is None or gross is None:
        return _ZERO
    return q(gross * rate / (100 + rate) * share)


def net_from_gross(gross: Decimal, vat_rate=None) -> Decimal:
    """Strip VAT from gross using the document rate. Missing rate → full gross.

    Returns 4 decimal places so that qty × unit_price_net × (1+vat) rounds
    correctly back to the original gross (avoids 20 × 6.94 × 1.08 = 149.90
    instead of 150.00).
    """
    rate = parse_vat_rate(vat_rate)
    if rate is None:
        return (gross).quantize(CENT4, rounding=ROUND_HALF_UP)
    return (gross * 100 / (100 + rate)).quantize(CENT4, rounding=ROUND_HALF_UP)
