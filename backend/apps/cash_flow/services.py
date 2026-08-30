"""Cash flow dashboard computation logic.

All heavy calculation lives here — views stay thin.
"""

import calendar
import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.fixed_costs.models import FixedCost
from apps.invoices.models import Invoice
from apps.ksef.models import ReceivedKSeFInvoice

from apps.sales_reports.models import DailySalesReport
from .models import OPEX_CATEGORY_CHOICES, CompanyTaxConfig, DailyB2CRevenue, QuickExpense
from .serializers import QuickExpenseSerializer

_ZERO = Decimal("0.00")
_CENT = Decimal("0.01")

# ---------------------------------------------------------------------------
# STAŁE USTAWOWE — aktualizacja co rok (zwykle styczeń)
#
# Źródła do sprawdzenia:
#   - ZUS.pl / obwieszczenia GUS — nowe podstawy wymiaru składek
#   - Ustawa o PIT — kwota wolna, progi
#   - Ustawa o NFZ — % składki zdrowotnej, minimum
#
# Rok 2026:
#   MIN_WAGE              = 4 806,00 zł  (minimalne wynagrodzenie brutto)
#   PROGNOSED_AVG_WAGE    = 9 420,00 zł  (prognozowane średnie wynagrodzenie — duży ZUS)
#   AVG_WAGE_Q4_2025      = 9 228,64 zł  (średnie wynagrodzenie Q4 2025 — ryczałt zdrowotna)
#
# Wyliczenia:
#   _MIN_HEALTH_2026      = MIN_WAGE × 9%        = 4 806 × 0,09  = 432,54 zł
#   _ZUS_FULL_SOCIAL_NO_SICK = 0,1953 × PROGNOSED_AVG_WAGE (bez chorobowego)
#   _ZUS_FULL_SOCIAL_SICK    = 0,2093 × PROGNOSED_AVG_WAGE (z chorobowym 2,45%)
#   _RYCZALT tiers        = % × AVG_WAGE_Q4_2025 (wg ustawy NFZ)
#   _HEALTH_LINIOWY_MAX_MONTHLY = 14 100 zł / 12 = 1 175 zł (roczny limit odliczenia)
# ---------------------------------------------------------------------------

_ZUS_FULL_SOCIAL_SICK    = Decimal("1926.76")  # Pełny ZUS z chorobowym    (0,2093 × 9 420)
_ZUS_FULL_SOCIAL_NO_SICK = Decimal("1788.27")  # Pełny ZUS bez chorobowego (0,1953 × 9 420)
_ZUS_PREF_SOCIAL_SICK    = Decimal("456.18")   # Preferencyjny z chorobowym
_ZUS_PREF_SOCIAL_NO_SICK = Decimal("420.86")   # Preferencyjny bez chorobowego
_MIN_HEALTH_2026         = Decimal("432.54")   # Min. zdrowotna = 4 806 × 9%
_PIT_FREE_MONTHLY        = Decimal("300.00")   # Kwota wolna = 12% × 30 000 / 12
_PIT_SCALE_THRESHOLD     = Decimal("120000.00")
_HEALTH_LINIOWY_MAX_MONTHLY = Decimal("1175.00")  # Roczny limit 14 100 zł / 12
_RYCZALT_HEALTH_TIER1    = Decimal("498.35")   # Ryczałt zdrowotna < 60 000 zł/rok  (≈ 5,4% × AVG_Q4)
_RYCZALT_HEALTH_TIER2    = Decimal("830.58")   # Ryczałt zdrowotna 60–300 tys./rok  (≈ 9,0% × AVG_Q4)
_RYCZALT_HEALTH_TIER3    = Decimal("1495.04")  # Ryczałt zdrowotna > 300 tys./rok   (≈ 16,2% × AVG_Q4)
_RYCZALT_THRESHOLD_60K   = Decimal("60000.00")
_RYCZALT_THRESHOLD_300K  = Decimal("300000.00")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def compute_history(company) -> list:
    """Return a list of months with any cash-flow data, newest first.

    Each item is a lightweight summary: period, revenue, costs, zysk, margin.
    Only months that have at least one record are included.
    """
    from django.db.models import Min, Max
    from django.db.models.functions import TruncMonth

    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)

    # Find the earliest date across all data sources
    dates = []
    inv_min = Invoice.objects.filter(
        company=company, status=Invoice.STATUS_PAID
    ).aggregate(m=Min("paid_at__date"))["m"]
    if inv_min:
        dates.append(inv_min)

    b2c_min = DailyB2CRevenue.objects.filter(company=company).aggregate(m=Min("date"))["m"]
    if b2c_min:
        dates.append(b2c_min)

    qe_min = QuickExpense.objects.filter(company=company).aggregate(m=Min("date"))["m"]
    if qe_min:
        dates.append(qe_min)

    ksef_min = ReceivedKSeFInvoice.objects.filter(company=company).aggregate(m=Min("issue_date"))["m"]
    if ksef_min:
        dates.append(ksef_min)

    if not dates:
        return []

    earliest = min(dates)
    today = timezone.localdate()

    # Walk from current month backwards to earliest month
    results = []
    year, month = today.year, today.month

    while (year, month) >= (earliest.year, earliest.month):
        period_start = datetime.date(year, month, 1)
        period_end = datetime.date(year, month, calendar.monthrange(year, month)[1])

        # Quick check: does this month have any data?
        has_data = (
            Invoice.objects.filter(
                company=company,
                status=Invoice.STATUS_PAID,
                paid_at__date__gte=period_start,
                paid_at__date__lte=period_end,
            ).exists()
            or DailyB2CRevenue.objects.filter(
                company=company, date__gte=period_start, date__lte=period_end
            ).exists()
            or QuickExpense.objects.filter(
                company=company, date__gte=period_start, date__lte=period_end
            ).exists()
            or ReceivedKSeFInvoice.objects.filter(
                company=company, issue_date__gte=period_start, issue_date__lte=period_end
            ).exists()
        )

        if has_data:
            rev_paid = _get_revenue_paid(company, period_start, period_end)
            rev_b2c = _get_b2c_revenue(company, period_start, period_end)
            revenue_total = rev_paid + rev_b2c

            costs_ksef = _get_costs_ksef(company, period_start, period_end)
            costs_quick = _get_costs_quick(company, period_start, period_end)
            costs_fixed = _get_costs_fixed(company, period_end)
            costs_total = costs_ksef + costs_quick + costs_fixed

            zus_social = _calc_zus_social(config)
            zus_health = _calc_health_contribution(config, _ZERO)

            vat_to_pay = _ZERO
            if config.vat_payer:
                vat_out = _get_vat_nalezny(company, config, period_start, period_end)
                vat_in = _get_vat_naliczony(company, config, period_start, period_end)
                vat_to_pay = max(vat_out - vat_in, _ZERO)

            net_rev = _get_net_revenue(company, config, period_start, period_end)
            net_b2c = _get_b2c_net(company, period_start, period_end)
            net_costs = _get_net_costs(company, config, period_start, period_end)
            income_for_pit = net_rev + net_b2c - net_costs - zus_social
            pit = _calc_pit(config, max(income_for_pit, _ZERO), _ZERO, zus_social, zus_health)

            really_yours = revenue_total - costs_total - vat_to_pay - zus_social - zus_health - pit

            margin_pct = None
            if revenue_total > 0:
                margin_pct = int((really_yours / revenue_total * 100).quantize(_CENT))

            results.append({
                "period": f"{year}-{month:02d}",
                "revenue_total": float(revenue_total),
                "costs_total": float(costs_total),
                "really_yours": float(really_yours),
                "is_loss": really_yours < 0,
                "margin_pct": margin_pct,
            })

        # Go to previous month
        month -= 1
        if month == 0:
            month = 12
            year -= 1

    return results


def compute_period_summary(company, date_from: datetime.date, date_to: datetime.date) -> dict:
    """Aggregate cash flow summary for an arbitrary date range.
    Uses single aggregate queries — not month-by-month loops.
    """
    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)
    _fmt_date = lambda d: d.isoformat()

    # Revenue
    revenue_b2b_paid = Invoice.objects.filter(
        company=company,
        status=Invoice.STATUS_PAID,
        paid_at__date__gte=date_from,
        paid_at__date__lte=date_to,
    ).aggregate(t=Sum("total_gross"))["t"] or _ZERO

    revenue_b2c = DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=date_from,
        date__lte=date_to,
    ).aggregate(t=Sum("amount"))["t"] or _ZERO

    revenue_total = revenue_b2b_paid + revenue_b2c

    # Costs from KSeF invoices (categorized)
    from apps.cost_allocation.models import InvoiceLineAnnotation
    ksef_invoices = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=date_from,
        issue_date__lte=date_to,
    )
    costs_suppliers = _ZERO
    for inv in ksef_invoices:
        annotated = InvoiceLineAnnotation.objects.filter(
            line__invoice=inv, opex_category__isnull=False
        )
        if annotated.exists():
            for ann in annotated:
                costs_suppliers += ann.line.line_net or _ZERO
        elif inv.opex_category:
            costs_suppliers += inv.gross_amount or _ZERO

    costs_quick = QuickExpense.objects.filter(
        company=company,
        date__gte=date_from,
        date__lte=date_to,
    ).aggregate(t=Sum("amount"))["t"] or _ZERO

    # Fixed costs: count how many months overlap the range
    # Simple approach: count months in range × monthly amount
    # months = number of distinct YYYY-MM in [date_from, date_to]
    months_count = Decimal(str(
        (date_to.year - date_from.year) * 12 + (date_to.month - date_from.month) + 1
    ))
    fixed_monthly = FixedCost.objects.filter(
        company=company,
        is_active=True,
        active_from__lte=date_to,
    ).aggregate(t=Sum("amount_monthly"))["t"] or _ZERO
    costs_fixed_total = fixed_monthly * months_count

    # VAT
    taxes_vat = _ZERO
    if config.vat_payer:
        vat_out = _get_vat_nalezny(company, config, date_from, date_to)
        vat_in = _get_vat_naliczony(company, config, date_from, date_to)
        taxes_vat = max(vat_out - vat_in, _ZERO)

    # ZUS social: fixed monthly × months in range
    zus_social_monthly = _calc_zus_social(config)
    taxes_zus_social = zus_social_monthly * months_count

    # Health: estimate using avg income (simplified for period view)
    net_rev = _get_net_revenue(company, config, date_from, date_to)
    net_b2c = _get_b2c_net(company, date_from, date_to)
    net_costs = _get_net_costs(company, config, date_from, date_to)
    avg_monthly_income = (net_rev + net_b2c - net_costs - taxes_zus_social) / max(months_count, Decimal("1"))
    health_monthly = _calc_health_contribution(config, avg_monthly_income)
    taxes_zus_health = health_monthly * months_count

    # PIT estimate: on the full period net income
    taxes_pit = _calc_pit(config, net_rev + net_b2c, net_costs, taxes_zus_social, taxes_zus_health)

    taxes_total = taxes_vat + taxes_zus_social + taxes_zus_health + taxes_pit

    profit_net = revenue_total - costs_suppliers - costs_quick - costs_fixed_total - taxes_total

    _q = lambda d: float(d.quantize(_CENT, rounding=ROUND_HALF_UP))
    return {
        "date_from": _fmt_date(date_from),
        "date_to": _fmt_date(date_to),
        "revenue_total": _q(revenue_total),
        "revenue_b2b_paid": _q(revenue_b2b_paid),
        "revenue_b2c": _q(revenue_b2c),
        "costs_suppliers": _q(costs_suppliers),
        "costs_quick": _q(costs_quick),
        "costs_fixed_total": _q(costs_fixed_total),
        "taxes_vat": _q(taxes_vat),
        "taxes_zus_social": _q(taxes_zus_social),
        "taxes_zus_health": _q(taxes_zus_health),
        "taxes_pit": _q(taxes_pit),
        "taxes_total": _q(taxes_total),
        "profit_net": _q(profit_net),
    }


def compute_dashboard(company, month_str: str | None = None) -> dict:
    """Return the full dashboard payload for *company*.

    *month_str* is an optional ``YYYY-MM`` string selecting which calendar
    month to use for the 'month' section.  Defaults to the current month.
    """
    today = timezone.localdate()

    if month_str:
        try:
            year, month = int(month_str[:4]), int(month_str[5:7])
        except (ValueError, IndexError):
            year, month = today.year, today.month
    else:
        year, month = today.year, today.month

    period_start = datetime.date(year, month, 1)
    period_end = datetime.date(year, month, calendar.monthrange(year, month)[1])

    config, _ = CompanyTaxConfig.objects.get_or_create(company=company)

    return {
        "today": _build_today(company, config, today),
        "month": _build_month(company, config, period_start, period_end),
    }


# ---------------------------------------------------------------------------
# "Dziś" section – live cash buffer
# ---------------------------------------------------------------------------


def _build_today(company, config: CompanyTaxConfig, today: datetime.date) -> dict:
    cash = config.cash_balance or _ZERO
    bank = config.bank_balance or _ZERO
    total_available = cash + bank

    obligations = []

    if config.vat_payer:
        # VAT for month M is due on vat_due_day of month M+1.
        # Find the upcoming due date, then derive which billing month it covers
        # (the month immediately before the due date's month).
        vat_due_date = _next_due_date(today, config.vat_due_day)
        first_of_due_month = vat_due_date.replace(day=1)
        last_of_billing_month = first_of_due_month - datetime.timedelta(days=1)
        vat_period_start = last_of_billing_month.replace(day=1)
        vat_period_end = last_of_billing_month

        vat_due = _get_vat_nalezny(company, config, vat_period_start, vat_period_end)
        vat_input = _get_vat_naliczony(company, config, vat_period_start, vat_period_end)
        vat_to_pay = max(vat_due - vat_input, _ZERO)

        _fmt = lambda d: f"{float(d.quantize(_CENT, rounding=ROUND_HALF_UP)):,.2f} zł".replace(",", " ")
        month_label = f"{vat_period_start.month}/{vat_period_start.year}"
        vat_method_label = "kasowa" if config.vat_method == "kasowa" else "memoriałowa"
        obligations.append(
            {
                "type": "vat",
                "label": f"VAT {month_label}",
                "amount": float(vat_to_pay.quantize(_CENT, rounding=ROUND_HALF_UP)),
                "due_date": str(vat_due_date),
                "days_until": (vat_due_date - today).days,
                "breakdown": [
                    {"label": f"Okres rozliczeniowy", "value": f"{vat_period_start.strftime('%d.%m')}–{vat_period_end.strftime('%d.%m.%Y')}"},
                    {"label": f"Metoda rozliczenia", "value": vat_method_label},
                    {"label": "VAT należny (ze sprzedaży)", "value": _fmt(vat_due)},
                    {"label": "VAT naliczony (odliczenie z zakupów)", "value": f"− {_fmt(vat_input)}"},
                    {"label": "Do zapłaty", "value": _fmt(vat_to_pay)},
                ],
            }
        )

    # --- ZUS social ---
    zus_due_date = _next_due_date(today, config.zus_due_day)
    zus_social = _calc_zus_social(config)
    _zus_status_labels = {
        CompanyTaxConfig.ZUS_ULGA_NA_START: "Ulga na start",
        CompanyTaxConfig.ZUS_PREFERENCYJNY: "Preferencyjny ZUS",
        CompanyTaxConfig.ZUS_PELNY: "Pełny ZUS",
        CompanyTaxConfig.ZUS_ETAT_JDG: "Etat + JDG",
    }
    zus_status_label = _zus_status_labels.get(config.zus_status, config.zus_status)
    if zus_social > _ZERO:
        _fmt = lambda d: f"{float(d.quantize(_CENT, rounding=ROUND_HALF_UP)):,.2f} zł".replace(",", " ")
        obligations.append({
            "type": "zus",
            "label": f"ZUS społeczny (do {config.zus_due_day}. mies.)",
            "amount": float(zus_social.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "due_date": str(zus_due_date),
            "days_until": (zus_due_date - today).days,
            "breakdown": [
                {"label": "Status ZUS", "value": zus_status_label},
                {"label": "Ubezpieczenie chorobowe", "value": "tak" if config.has_sick_insurance else "nie"},
                {"label": "Składka społeczna 2026 (stawka ryczałtowa ZUS)", "value": _fmt(zus_social)},
            ],
        })

    # --- PIT billing period = month before the due month ---
    first_of_zus_due_month = zus_due_date.replace(day=1)
    last_of_pit_billing = first_of_zus_due_month - datetime.timedelta(days=1)
    pit_period_start = last_of_pit_billing.replace(day=1)
    pit_period_end = last_of_pit_billing
    pit_net_rev = _get_net_revenue(company, config, pit_period_start, pit_period_end)
    pit_net_b2c = _get_b2c_net(company, pit_period_start, pit_period_end)
    pit_net_costs = _get_net_costs(company, config, pit_period_start, pit_period_end)
    monthly_income = pit_net_rev + pit_net_b2c - pit_net_costs - zus_social

    # --- Health contribution ---
    _fmt = lambda d: f"{float(d.quantize(_CENT, rounding=ROUND_HALF_UP)):,.2f} zł".replace(",", " ")
    health_amount = _calc_health_contribution(config, monthly_income)
    _pit_period_label = f"{pit_period_start.strftime('%d.%m')}–{pit_period_end.strftime('%d.%m.%Y')}"
    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "Ryczałt (stawka zryczałtowana)"},
            {"label": "Próg przychodów rocznych", "value": "do 60 000 / 300 000 zł"},
            {"label": "Składka zdrowotna 2026 (tier)", "value": _fmt(health_amount)},
        ]
    elif config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        calc_base = max(monthly_income, _ZERO)
        calc_49 = (calc_base * Decimal("0.049")).quantize(_CENT, rounding=ROUND_HALF_UP)
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "KPiR – liniowy 19%"},
            {"label": f"Dochód ({_pit_period_label})", "value": _fmt(monthly_income)},
            {"label": "4,9% × dochód", "value": _fmt(calc_49)},
            {"label": "Minimum 2026", "value": _fmt(_MIN_HEALTH_2026)},
            {"label": "Składka zdrowotna (max z powyższych)", "value": _fmt(health_amount)},
        ]
    else:  # skala
        calc_base = max(monthly_income, _ZERO)
        calc_9 = (calc_base * Decimal("0.09")).quantize(_CENT, rounding=ROUND_HALF_UP)
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "KPiR – skala podatkowa"},
            {"label": f"Dochód ({_pit_period_label})", "value": _fmt(monthly_income)},
            {"label": "9% × dochód", "value": _fmt(calc_9)},
            {"label": "Minimum 2026", "value": _fmt(_MIN_HEALTH_2026)},
            {"label": "Składka zdrowotna (max z powyższych)", "value": _fmt(health_amount)},
        ]
    obligations.append({
        "type": "zus_health",
        "label": f"Składka zdrowotna (do {config.zus_due_day}. mies.)",
        "amount": float(health_amount.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "due_date": str(zus_due_date),
        "days_until": (zus_due_date - today).days,
        "breakdown": health_breakdown,
    })

    # --- Podatek dochodowy (PIT advance) — always shown, may be 0 ---
    pit_amount = _calc_pit(config, pit_net_rev + pit_net_b2c, pit_net_costs, zus_social, health_amount)
    pit_total_rev = pit_net_rev + pit_net_b2c
    if pit_amount == _ZERO and pit_total_rev == _ZERO:
        pit_note = f"Brak przychodów w okresie {_pit_period_label} — zaliczka wynosi 0 zł."
    else:
        pit_note = None
    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        health_ded = min(health_amount, _HEALTH_LINIOWY_MAX_MONTHLY)
        taxable = max(pit_total_rev - pit_net_costs - zus_social - health_ded, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód netto ({_pit_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "Koszty netto", "value": f"− {_fmt(pit_net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Składka zdrowotna (odliczenie, max 1 175 zł)", "value": f"− {_fmt(health_ded)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": "Stawka liniowa", "value": "19%"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_amount)},
        ]
    elif config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_SCALE:
        taxable = max(pit_total_rev - pit_net_costs - zus_social, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód netto ({_pit_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "Koszty netto", "value": f"− {_fmt(pit_net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": "12% × podstawa", "value": _fmt(taxable * Decimal("0.12"))},
            {"label": "Kwota wolna (miesięcznie)", "value": f"− 300,00 zł"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_amount)},
        ]
    else:  # ryczałt
        health_50 = (health_amount * Decimal("0.5")).quantize(_CENT, rounding=ROUND_HALF_UP)
        taxable = max(pit_total_rev - health_50, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód ({_pit_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "50% składki zdrowotnej (odliczenie)", "value": f"− {_fmt(health_50)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": f"Stawka ryczałtu", "value": f"{float(config.tax_rate):.0f}%"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_amount)},
        ]
    obligations.append({
        "type": "pit",
        "label": "Podatek dochodowy (~szacunek)",
        "amount": float(pit_amount.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "due_date": str(zus_due_date),
        "days_until": (zus_due_date - today).days,
        "breakdown": pit_breakdown,
        **({"note": pit_note} if pit_note else {}),
    })

    total_reserved = sum((Decimal(str(o["amount"])) for o in obligations), _ZERO)
    really_yours = total_available - total_reserved

    return {
        "cash_balance": float(cash),
        "bank_balance": float(bank),
        "balance_updated_at": (
            config.balance_updated_at.isoformat() if config.balance_updated_at else None
        ),
        "total_available": float(total_available),
        "upcoming_obligations": obligations,
        "total_reserved": float(total_reserved.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "really_yours": float(really_yours.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "has_config": True,
        "receivables": _get_receivables(company, today),
        "payables": _get_payables(company, today),
    }


# ---------------------------------------------------------------------------
# "Miesiąc" section – monthly forecast
# ---------------------------------------------------------------------------


def _calc_tax_threshold_alert(
    config: CompanyTaxConfig,
    ytd_revenue: Decimal,
    current_month_net: Decimal,
    period_end: datetime.date,
) -> dict | None:
    """Return a threshold alert dict if the user is approaching or has crossed a tax threshold.

    Returns None if no relevant threshold applies.
    Alert fields:
      type: 'warning' | 'crossed'
      title: str
      message: str
      ytd: float
      threshold: float
      remaining: float  (0 if crossed)
    """
    _fmt = lambda d: f"{float(d.quantize(_CENT, rounding=ROUND_HALF_UP)):,.0f} zł".replace(",", " ")

    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        # Two thresholds: 60k and 300k — health insurance tier changes
        for threshold, label_below, label_above in [
            (_RYCZALT_THRESHOLD_300K, "300 000 zł", "300 000 zł"),
            (_RYCZALT_THRESHOLD_60K, "60 000 zł", "60 000 zł"),
        ]:
            if ytd_revenue >= threshold:
                remaining = _ZERO
                return {
                    "type": "crossed",
                    "title": f"Przekroczono próg {label_above} (ryczałt)",
                    "message": (
                        f"Twój przychód roczny ({_fmt(ytd_revenue)}) przekroczył {label_above}. "
                        f"Składka zdrowotna wzrosła do wyższego progu."
                    ),
                    "ytd": float(ytd_revenue),
                    "threshold": float(threshold),
                    "remaining": 0.0,
                }
            remaining = threshold - ytd_revenue
            warn_zone = threshold * Decimal("0.15")  # warn within 15% of threshold
            if remaining <= warn_zone:
                return {
                    "type": "warning",
                    "title": f"Zbliżasz się do progu {label_below} (ryczałt)",
                    "message": (
                        f"Przychód roczny: {_fmt(ytd_revenue)}. "
                        f"Do progu {label_below} zostało {_fmt(remaining)} — po przekroczeniu składka zdrowotna wzrośnie."
                    ),
                    "ytd": float(ytd_revenue),
                    "threshold": float(threshold),
                    "remaining": float(remaining),
                }

    elif config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_SCALE:
        # Skala: próg 120 000 zł dochodu — zmiana stawki z 12% na 32%
        # ytd_revenue here is net revenue; for income we'd need net costs YTD — approximation with revenue
        threshold = _PIT_SCALE_THRESHOLD
        if ytd_revenue >= threshold:
            return {
                "type": "crossed",
                "title": "Przekroczono próg 120 000 zł (skala podatkowa)",
                "message": (
                    f"Przychód roczny ({_fmt(ytd_revenue)}) przekroczył 120 000 zł. "
                    f"Nadwyżka ponad próg opodatkowana jest stawką 32% zamiast 12%."
                ),
                "ytd": float(ytd_revenue),
                "threshold": float(threshold),
                "remaining": 0.0,
            }
        remaining = threshold - ytd_revenue
        warn_zone = threshold * Decimal("0.15")
        if remaining <= warn_zone:
            return {
                "type": "warning",
                "title": "Zbliżasz się do progu 120 000 zł (skala podatkowa)",
                "message": (
                    f"Przychód roczny: {_fmt(ytd_revenue)}. "
                    f"Do progu 32% zostało ok. {_fmt(remaining)} — rozważ optymalizację kosztów."
                ),
                "ytd": float(ytd_revenue),
                "threshold": float(threshold),
                "remaining": float(remaining),
            }

    return None


def _build_month(
    company,
    config: CompanyTaxConfig,
    period_start: datetime.date,
    period_end: datetime.date,
) -> dict:
    # --- Revenue ---
    revenue_paid = _get_revenue_paid(company, period_start, period_end)
    revenue_outstanding = _get_revenue_outstanding(company, period_start, period_end)
    b2c_gross = _get_b2c_revenue(company, period_start, period_end)

    # Revenue summaries for UI
    revenue_paid_summary = _get_revenue_paid_summary(company, period_start, period_end)
    revenue_outstanding_summary = _get_revenue_outstanding_summary(company, period_start, period_end)
    b2c_count = (
        DailyB2CRevenue.objects.filter(company=company, date__gte=period_start, date__lte=period_end).count()
        + DailySalesReport.objects.filter(
            company=company, date__gte=period_start, date__lte=period_end,
            status=DailySalesReport.STATUS_SAVED,
        ).count()
    )

    # --- Costs ---
    costs_ksef = _get_costs_ksef(company, period_start, period_end)
    costs_quick = _get_costs_quick(company, period_start, period_end)
    costs_fixed = _get_costs_fixed(company, period_end)

    # Cost summaries for UI
    costs_ksef_count = _get_costs_ksef_count(company, period_start, period_end)
    costs_ksef_by_category = _get_costs_ksef_by_category(company, period_start, period_end)
    costs_quick_by_category = _get_costs_quick_by_category(company, period_start, period_end)
    costs_fixed_items = _get_costs_fixed_items(company, period_end)

    # --- Net revenue & costs (for PIT, excl. VAT for VAT payers) ---
    net_revenue = _get_net_revenue(company, config, period_start, period_end)
    net_b2c = _get_b2c_net(company, period_start, period_end)
    net_costs = _get_net_costs(company, config, period_start, period_end)

    # --- VAT ---
    vat_output = _ZERO
    vat_input = _ZERO
    vat_to_pay = _ZERO
    vat_due_date = None
    vat_input_invoices: list = []
    if config.vat_payer:
        vat_output = _get_vat_nalezny(company, config, period_start, period_end)
        vat_input = _get_vat_naliczony(company, config, period_start, period_end)
        vat_to_pay = max(vat_output - vat_input, _ZERO)
        vat_input_invoices = _get_vat_naliczony_breakdown(company, period_start, period_end)
        # VAT for this period is due on next month's vat_due_day
        next_month_start = (period_end + datetime.timedelta(days=1)).replace(day=1)
        try:
            vat_due_date = next_month_start.replace(day=config.vat_due_day)
        except ValueError:
            # day out of range for month (e.g. day=31 in April)
            last_day = calendar.monthrange(next_month_start.year, next_month_start.month)[1]
            vat_due_date = next_month_start.replace(day=last_day)

    # --- ZUS / Health / PIT ---
    zus_social = _calc_zus_social(config)
    monthly_income_for_health = net_revenue + net_b2c - net_costs - zus_social
    # For ryczałt, pass ytd_revenue (sum of all revenue from Jan to period_end)
    ytd_revenue = _get_ytd_revenue(company, config, period_end)
    zus_health = _calc_health_contribution(config, monthly_income_for_health, ytd_revenue)
    zus_monthly = zus_social + zus_health
    pit_estimate = _calc_pit(config, net_revenue + net_b2c, net_costs, zus_social, zus_health)

    try:
        zus_due_date = period_start.replace(day=config.zus_due_day)
    except ValueError:
        last_day = calendar.monthrange(period_start.year, period_start.month)[1]
        zus_due_date = period_start.replace(day=last_day)

    # --- "What's really yours" (conservative: only paid revenue) ---
    really_yours_estimate = (
        revenue_paid
        + b2c_gross
        - costs_ksef
        - costs_quick
        - costs_fixed
        - vat_to_pay
        - zus_social
        - zus_health
        - pit_estimate
    )

    # --- Breakdowns for UI "skąd ta liczba?" ---
    _fmt = lambda d: f"{float(d.quantize(_CENT, rounding=ROUND_HALF_UP)):,.2f} zł".replace(",", " ")
    _period_label = f"{period_start.strftime('%d.%m')}–{period_end.strftime('%d.%m.%Y')}"

    _zus_status_labels = {
        CompanyTaxConfig.ZUS_ULGA_NA_START: "Ulga na start",
        CompanyTaxConfig.ZUS_PREFERENCYJNY: "Preferencyjny ZUS",
        CompanyTaxConfig.ZUS_PELNY: "Pełny ZUS",
        CompanyTaxConfig.ZUS_ETAT_JDG: "Etat + JDG",
    }
    zus_status_label = _zus_status_labels.get(config.zus_status, config.zus_status)

    if zus_social > _ZERO:
        zus_breakdown = [
            {"label": "Status ZUS", "value": zus_status_label},
            {"label": "Ubezpieczenie chorobowe", "value": "tak" if config.has_sick_insurance else "nie"},
            {"label": "Składka społeczna 2026 (stawka ryczałtowa ZUS)", "value": _fmt(zus_social)},
        ]
    else:
        zus_breakdown = [
            {"label": "Status ZUS", "value": zus_status_label},
            {"label": "Składka społeczna", "value": "0 zł (brak obowiązku)"},
        ]

    monthly_income = monthly_income_for_health  # alias for readability
    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "Ryczałt"},
            {"label": f"Przychód rok narastająco (do {period_end.strftime('%d.%m.%Y')})", "value": _fmt(ytd_revenue)},
            {"label": "Próg zdrowotnej 60 000 / 300 000 zł", "value": "wg rocznych przychodów"},
            {"label": "Składka zdrowotna 2026 (tier)", "value": _fmt(zus_health)},
        ]
    elif config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        calc_base = max(monthly_income, _ZERO)
        calc_49 = (calc_base * Decimal("0.049")).quantize(_CENT, rounding=ROUND_HALF_UP)
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "KPiR – liniowy 19%"},
            {"label": f"Przychód netto ({_period_label})", "value": _fmt(net_revenue + net_b2c)},
            {"label": "Koszty netto", "value": f"− {_fmt(net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Dochód miesiąca", "value": _fmt(monthly_income)},
            {"label": "4,9% × dochód", "value": _fmt(calc_49)},
            {"label": "Minimum 2026", "value": _fmt(_MIN_HEALTH_2026)},
            {"label": "Składka zdrowotna (max z powyższych)", "value": _fmt(zus_health)},
        ]
    else:  # skala
        calc_base = max(monthly_income, _ZERO)
        calc_9 = (calc_base * Decimal("0.09")).quantize(_CENT, rounding=ROUND_HALF_UP)
        health_breakdown = [
            {"label": "Forma opodatkowania", "value": "KPiR – skala podatkowa"},
            {"label": f"Przychód netto ({_period_label})", "value": _fmt(net_revenue + net_b2c)},
            {"label": "Koszty netto", "value": f"− {_fmt(net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Dochód miesiąca", "value": _fmt(monthly_income)},
            {"label": "9% × dochód", "value": _fmt(calc_9)},
            {"label": "Minimum 2026", "value": _fmt(_MIN_HEALTH_2026)},
            {"label": "Składka zdrowotna (max z powyższych)", "value": _fmt(zus_health)},
        ]

    pit_total_rev = net_revenue + net_b2c
    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        health_ded = min(zus_health, _HEALTH_LINIOWY_MAX_MONTHLY)
        taxable = max(pit_total_rev - net_costs - zus_social - health_ded, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód netto ({_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "Koszty netto", "value": f"− {_fmt(net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Składka zdrowotna (odliczenie, max 1 175 zł)", "value": f"− {_fmt(health_ded)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": "Stawka liniowa", "value": "19%"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_estimate)},
        ]
    elif config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_SCALE:
        taxable = max(pit_total_rev - net_costs - zus_social, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód netto ({_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "Koszty netto", "value": f"− {_fmt(net_costs)}"},
            {"label": "ZUS społeczny (odliczenie)", "value": f"− {_fmt(zus_social)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": "12% × podstawa", "value": _fmt(taxable * Decimal("0.12"))},
            {"label": "Kwota wolna (miesięcznie)", "value": "− 300,00 zł"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_estimate)},
        ]
    else:  # ryczałt
        health_50 = (zus_health * Decimal("0.5")).quantize(_CENT, rounding=ROUND_HALF_UP)
        taxable = max(pit_total_rev - health_50, _ZERO)
        pit_breakdown = [
            {"label": f"Przychód ({_period_label})", "value": _fmt(pit_total_rev)},
            {"label": "50% składki zdrowotnej (odliczenie)", "value": f"− {_fmt(health_50)}"},
            {"label": "Podstawa opodatkowania", "value": _fmt(taxable)},
            {"label": f"Stawka ryczałtu", "value": f"{float(config.tax_rate):.0f}%"},
            {"label": "Zaliczka podatku dochodowego", "value": _fmt(pit_estimate)},
        ]
    if pit_estimate == _ZERO and pit_total_rev == _ZERO:
        pit_breakdown.append({"label": "Uwaga", "value": f"Brak przychodu w {_period_label} — zaliczka 0 zł"})

    result_breakdown = [
        {"label": f"Przychód opłacony B2B ({_period_label})", "value": _fmt(revenue_paid)},
        {"label": "Sprzedaż B2C (kasa)", "value": _fmt(b2c_gross)},
        {"label": "Faktury zakupowe (KSeF)", "value": f"− {_fmt(costs_ksef)}"},
        {"label": "Koszty gotówkowe", "value": f"− {_fmt(costs_quick)}"},
        {"label": "Koszty stałe", "value": f"− {_fmt(costs_fixed)}"},
        {"label": "VAT do zapłaty", "value": f"− {_fmt(vat_to_pay)}"},
        {"label": "ZUS społeczny", "value": f"− {_fmt(zus_social)}"},
        {"label": "Składka zdrowotna", "value": f"− {_fmt(zus_health)}"},
        {"label": "Podatek dochodowy (~szacunek)", "value": f"− {_fmt(pit_estimate)}"},
        {"label": "= Szacowany wynik", "value": _fmt(really_yours_estimate)},
    ]

    # --- Tax threshold alert ---
    tax_threshold_alert = _calc_tax_threshold_alert(config, ytd_revenue, net_revenue + net_b2c, period_end)

    # --- Uncategorized KSeF invoices (not wliczone w koszty) ---
    uncategorized_ksef_count = _count_uncategorized_ksef(company, period_start, period_end)

    # --- Recent quick expenses (last 10) ---
    recent_expenses_qs = QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    )[:10]
    # Use a plain serialiser-less representation to avoid circular imports
    recent_expenses = [
        {
            "id": str(e.uuid),
            "date": str(e.date),
            "amount": str(e.amount),
            "category": e.category,
            "category_label": e.get_category_display(),
            "vendor": e.vendor,
            "has_vat": e.has_vat,
        }
        for e in recent_expenses_qs
    ]

    return {
        "period": str(period_start)[:7],  # "YYYY-MM"
        "revenue_paid": float(revenue_paid.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "revenue_outstanding": float(revenue_outstanding.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "b2c_revenue": float(b2c_gross.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "costs_ksef": float(costs_ksef.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "costs_quick": float(costs_quick.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "costs_fixed": float(costs_fixed.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "vat_output": float(vat_output.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "vat_input": float(vat_input.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "vat_to_pay": float(vat_to_pay.quantize(_CENT, rounding=ROUND_HALF_UP)),
        # Positive when input VAT > output VAT (refund / carried forward)
        "vat_surplus": float(max(vat_input - vat_output, _ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)),
        "vat_due_date": str(vat_due_date) if vat_due_date else None,
        "vat_input_invoices": vat_input_invoices,
        "pit_estimate": float(pit_estimate.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "pit_is_estimate": True,
        "zus_social": float(zus_social.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "zus_health": float(zus_health.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "zus_monthly": float(zus_monthly.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "zus_due_date": str(zus_due_date),
        "really_yours_estimate": float(
            really_yours_estimate.quantize(_CENT, rounding=ROUND_HALF_UP)
        ),
        "zus_breakdown": zus_breakdown,
        "health_breakdown": health_breakdown,
        "pit_breakdown": pit_breakdown,
        "result_breakdown": result_breakdown,
        "revenue_paid_count": revenue_paid_summary["count"],
        "revenue_paid_top": revenue_paid_summary["top"],
        "revenue_outstanding_count": revenue_outstanding_summary["count"],
        "revenue_outstanding_top": revenue_outstanding_summary["top"],
        "b2c_entries_count": b2c_count,
        "costs_ksef_count": costs_ksef_count,
        "costs_ksef_by_category": costs_ksef_by_category,
        "costs_quick_by_category": costs_quick_by_category,
        "costs_fixed_items": costs_fixed_items,
        "recent_quick_expenses": recent_expenses,
        "uncategorized_ksef_count": uncategorized_ksef_count,
        "tax_threshold_alert": tax_threshold_alert,
    }


# ---------------------------------------------------------------------------
# Summary helpers for "Przychody / Koszty" UI breakdowns
# ---------------------------------------------------------------------------


def _get_revenue_paid_summary(company, period_start, period_end) -> dict:
    """Count + top 3 customers for paid invoices."""
    qs = Invoice.objects.filter(
        company=company,
        status=Invoice.STATUS_PAID,
        paid_at__date__gte=period_start,
        paid_at__date__lte=period_end,
    ).select_related("customer").order_by("-total_gross")
    count = qs.count()
    top = [
        {"name": inv.customer.name if inv.customer else "—", "amount": float(inv.total_gross)}
        for inv in qs[:3]
    ]
    return {"count": count, "top": top}


def _get_revenue_outstanding_summary(company, period_start, period_end) -> dict:
    """Count + top 3 customers for outstanding invoices."""
    qs = Invoice.objects.filter(
        company=company,
        status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_OVERDUE],
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    ).select_related("customer").order_by("-total_gross")
    count = qs.count()
    top = [
        {"name": inv.customer.name if inv.customer else "—", "amount": float(inv.total_gross)}
        for inv in qs[:3]
    ]
    return {"count": count, "top": top}


def _get_costs_ksef_count(company, period_start, period_end) -> int:
    """Count of KSeF invoices with at least one categorized line."""
    from apps.cost_allocation.models import InvoiceLineAnnotation
    invoices_qs = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    )
    count = 0
    for inv in invoices_qs:
        has_lines = InvoiceLineAnnotation.objects.filter(
            line__invoice=inv, opex_category__isnull=False
        ).exists()
        if has_lines or inv.opex_category:
            count += 1
    return count


def _get_costs_quick_by_category(company, period_start, period_end) -> list:
    """Quick expenses grouped by category: [{category, label, total, count}]."""
    from django.db.models import Count
    rows = (
        QuickExpense.objects.filter(
            company=company,
            date__gte=period_start,
            date__lte=period_end,
        )
        .values("category")
        .annotate(total=Sum("amount"), count=Count("uuid"))
        .order_by("-total")
    )
    return [
        {
            "category": r["category"],
            "label": dict(OPEX_CATEGORY_CHOICES).get(r["category"], r["category"]),
            "total": float((r["total"] or _ZERO)),
            "count": r["count"],
        }
        for r in rows
    ]


def _get_costs_ksef_by_category(company, period_start, period_end) -> list:
    """KSeF invoice costs grouped by opex_category.

    Line-level annotations take priority over invoice-level opex_category.
    Returns [{category, label, total, count}] sorted by total desc.
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    invoices_qs = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    )

    totals: dict = {}  # category -> {total, count}
    for invoice in invoices_qs:
        annotated_lines = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
            opex_category__isnull=False,
        )
        if annotated_lines.exists():
            for ann in annotated_lines:
                cat = ann.opex_category
                totals.setdefault(cat, {"total": _ZERO, "count": 0})
                totals[cat]["total"] += ann.line.line_net or _ZERO
                totals[cat]["count"] += 1
        elif invoice.opex_category:
            cat = invoice.opex_category
            totals.setdefault(cat, {"total": _ZERO, "count": 0})
            totals[cat]["total"] += invoice.gross_amount or _ZERO
            totals[cat]["count"] += 1

    return sorted(
        [
            {
                "category": cat,
                "label": dict(OPEX_CATEGORY_CHOICES).get(cat, cat),
                "total": float(data["total"].quantize(_CENT, rounding=ROUND_HALF_UP)),
                "count": data["count"],
            }
            for cat, data in totals.items()
        ],
        key=lambda x: x["total"],
        reverse=True,
    )


def _get_costs_fixed_items(company, period_end: datetime.date) -> list:
    """Active fixed costs as [{description, category, amount_monthly}]."""
    items = FixedCost.objects.filter(
        company=company,
        is_active=True,
        active_from__lte=period_end,
    ).order_by("-amount_monthly")
    return [
        {
            "description": fc.description or "—",
            "category": fc.category,
            "amount": float(fc.amount_monthly),
        }
        for fc in items
    ]


# ---------------------------------------------------------------------------
# Revenue helpers
# ---------------------------------------------------------------------------


def _get_revenue_paid(company, period_start, period_end) -> Decimal:
    """B2B invoices confirmed as paid within the period (by paid_at date)."""
    result = Invoice.objects.filter(
        company=company,
        status=Invoice.STATUS_PAID,
        paid_at__date__gte=period_start,
        paid_at__date__lte=period_end,
    ).aggregate(t=Sum("total_gross"))["t"]
    return result or _ZERO


def _get_revenue_outstanding(company, period_start, period_end) -> Decimal:
    """B2B invoices issued/sent/overdue but not yet paid, by issue_date."""
    result = Invoice.objects.filter(
        company=company,
        status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_OVERDUE],
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    ).aggregate(t=Sum("total_gross"))["t"]
    return result or _ZERO


def _get_b2c_revenue(company, period_start, period_end) -> Decimal:
    """Gross B2C revenue from DailyB2CRevenue + DailySalesReport (saved)."""
    legacy = DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ).aggregate(t=Sum("amount"))["t"] or _ZERO

    rk = DailySalesReport.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
        status=DailySalesReport.STATUS_SAVED,
    ).aggregate(t=Sum("amount"))["t"] or _ZERO

    return legacy + rk


def _get_b2c_net(company, period_start, period_end) -> Decimal:
    """Net B2C revenue (gross minus embedded VAT) from both sources."""
    net = _ZERO

    # Legacy DailyB2CRevenue
    for row in DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ):
        if row.vat_included and row.vat_rate > _ZERO:
            net += row.amount / (1 + row.vat_rate / 100)
        else:
            net += row.amount

    # DailySalesReport (saved)
    for row in DailySalesReport.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
        status=DailySalesReport.STATUS_SAVED,
    ):
        if row.vat_included and row.vat_rate > _ZERO:
            net += row.amount / (1 + row.vat_rate / 100)
        else:
            net += row.amount

    return net


def _get_ytd_revenue(company, config: CompanyTaxConfig, period_end: datetime.date) -> Decimal:
    """Sum of net revenue from Jan 1 of the same year through period_end."""
    year_start = period_end.replace(month=1, day=1)
    return _get_net_revenue(company, config, year_start, period_end) + _get_b2c_net(company, year_start, period_end)


def _get_net_revenue(company, config: CompanyTaxConfig, period_start, period_end) -> Decimal:
    """Net B2B revenue (excl. VAT) for PIT calculation."""
    if config.vat_method == CompanyTaxConfig.VAT_METHOD_KASOWA:
        qs = Invoice.objects.filter(
            company=company,
            status=Invoice.STATUS_PAID,
            paid_at__date__gte=period_start,
            paid_at__date__lte=period_end,
        )
    else:
        qs = Invoice.objects.filter(
            company=company,
            status__in=[
                Invoice.STATUS_ISSUED,
                Invoice.STATUS_SENT,
                Invoice.STATUS_PAID,
                Invoice.STATUS_OVERDUE,
            ],
            issue_date__gte=period_start,
            issue_date__lte=period_end,
        )
    result = qs.aggregate(t=Sum("subtotal_net"))["t"]
    return result or _ZERO


# ---------------------------------------------------------------------------
# Cost helpers
# ---------------------------------------------------------------------------


def _get_costs_ksef(company, period_start, period_end) -> Decimal:
    """OPEX from received KSeF invoices.

    Priority: if any line on the invoice has opex_category set, sum those lines.
    Fallback: use invoice-level opex_category (gross_amount).
    Invoices with neither are excluded.
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    invoices_qs = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    )

    total = _ZERO
    for invoice in invoices_qs:
        annotated_lines = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
            opex_category__isnull=False,
        )
        if annotated_lines.exists():
            for ann in annotated_lines:
                total += ann.line.line_net or _ZERO
        elif invoice.opex_category:
            total += invoice.gross_amount or _ZERO

    return total


def _get_costs_quick(company, period_start, period_end) -> Decimal:
    result = QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ).aggregate(t=Sum("amount"))["t"]
    return result or _ZERO


def _get_costs_fixed(company, period_end: datetime.date) -> Decimal:
    """Sum of active fixed costs that started on or before period_end."""
    result = FixedCost.objects.filter(
        company=company,
        is_active=True,
        active_from__lte=period_end,
    ).aggregate(t=Sum("amount_monthly"))["t"]
    return result or _ZERO


def _get_net_costs(company, config: CompanyTaxConfig, period_start, period_end) -> Decimal:
    """Net costs (excl. VAT for VAT payers) for PIT calculation."""
    # KSeF costs: use net_amount if available, else gross_amount
    ksef_net = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
        opex_category__isnull=False,
    ).aggregate(t=Sum("net_amount"))["t"] or _ZERO

    # Quick expenses: if has_vat, extract net (gross / 1.23)
    quick_net = _ZERO
    for exp in QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ):
        if exp.has_vat:
            quick_net += exp.amount / Decimal("1.23")
        else:
            quick_net += exp.amount

    fixed = _get_costs_fixed(company, period_end)
    return ksef_net + quick_net + fixed


# ---------------------------------------------------------------------------
# VAT helpers
# ---------------------------------------------------------------------------


def _get_vat_nalezny(
    company, config: CompanyTaxConfig, period_start, period_end
) -> Decimal:
    """Output VAT (VAT należny) for the period."""
    if config.vat_method == CompanyTaxConfig.VAT_METHOD_KASOWA:
        b2b_vat = (
            Invoice.objects.filter(
                company=company,
                status=Invoice.STATUS_PAID,
                paid_at__date__gte=period_start,
                paid_at__date__lte=period_end,
            ).aggregate(t=Sum("vat_amount"))["t"]
            or _ZERO
        )
    else:
        b2b_vat = (
            Invoice.objects.filter(
                company=company,
                status__in=[
                    Invoice.STATUS_ISSUED,
                    Invoice.STATUS_SENT,
                    Invoice.STATUS_PAID,
                    Invoice.STATUS_OVERDUE,
                ],
                issue_date__gte=period_start,
                issue_date__lte=period_end,
            ).aggregate(t=Sum("vat_amount"))["t"]
            or _ZERO
        )

    # B2C VAT — extract from gross using per-row VAT rate
    b2c_vat = _ZERO
    for row in DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
        vat_included=True,
    ):
        if row.vat_rate > _ZERO:
            b2c_vat += row.amount * row.vat_rate / (100 + row.vat_rate)

    return b2b_vat + b2c_vat


def _get_vat_naliczony(
    company, config: CompanyTaxConfig, period_start, period_end
) -> Decimal:
    """Input VAT (VAT naliczony) — deductible from output VAT.

    Only invoices explicitly categorised as OPEX (opex_category set, at invoice
    level or line level) are included.  Uncategorised received invoices are
    ignored because the user hasn't confirmed they are business-related expenses.

    For invoices with line-level opex_category annotations, we use the invoice's
    vat_amount as a proxy (line-level VAT is not stored separately).
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    invoices_qs = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
        vat_amount__isnull=False,
    )

    ksef_vat = _ZERO
    for invoice in invoices_qs:
        has_line_annotations = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
            opex_category__isnull=False,
        ).exists()
        if has_line_annotations or invoice.opex_category:
            ksef_vat += invoice.vat_amount or _ZERO

    # Quick expenses with VAT receipt — assume 23% embedded (amount is gross)
    quick_vat = _ZERO
    for exp in QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
        has_vat=True,
    ):
        quick_vat += exp.amount * Decimal("23") / Decimal("123")

    return ksef_vat + quick_vat


def _get_vat_naliczony_breakdown(company, period_start, period_end) -> list:
    """Return per-invoice VAT input breakdown for display in the dashboard.

    For invoices with line-level opex_category annotations, include the individual
    line categories. For invoice-level only, show the invoice opex_category.
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    invoices = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
        vat_amount__isnull=False,
    ).order_by("issue_date")

    result = []
    for inv in invoices:
        annotated_lines = list(
            InvoiceLineAnnotation.objects.filter(
                line__invoice=inv,
                opex_category__isnull=False,
            ).select_related("line")
        )
        if annotated_lines:
            # Include invoice with line-level breakdown
            line_categories = list({ann.opex_category for ann in annotated_lines})
            result.append({
                "id": str(inv.uuid),
                "vendor": inv.seller_name or "",
                "issue_date": str(inv.issue_date),
                "vat_amount": float(inv.vat_amount),
                "gross_amount": float(inv.gross_amount) if inv.gross_amount else None,
                "opex_category": line_categories[0] if len(line_categories) == 1 else "mixed",
                "line_categories": line_categories,
            })
        elif inv.opex_category:
            result.append({
                "id": str(inv.uuid),
                "vendor": inv.seller_name or "",
                "issue_date": str(inv.issue_date),
                "vat_amount": float(inv.vat_amount),
                "gross_amount": float(inv.gross_amount) if inv.gross_amount else None,
                "opex_category": inv.opex_category,
            })

    return result


# ---------------------------------------------------------------------------
# ZUS helper
# ---------------------------------------------------------------------------


def _get_zus_monthly(company, reference_date: datetime.date) -> Decimal:
    """Sum of active ZUS/Zdrowotne fixed costs at *reference_date*."""
    result = FixedCost.objects.filter(
        company=company,
        category=FixedCost.CAT_ZUS_ZDROWOTNE,
        is_active=True,
        active_from__lte=reference_date,
    ).aggregate(t=Sum("amount_monthly"))["t"]
    return result or _ZERO


# ---------------------------------------------------------------------------
# ZUS / Health / PIT helpers (2026)
# ---------------------------------------------------------------------------


def _calc_zus_social(config: CompanyTaxConfig) -> Decimal:
    """Monthly ZUS social contributions (składki społeczne) — 2026."""
    if config.zus_status in (
        CompanyTaxConfig.ZUS_ULGA_NA_START,
        CompanyTaxConfig.ZUS_ETAT_JDG,
    ):
        return _ZERO
    if config.zus_status == CompanyTaxConfig.ZUS_PREFERENCYJNY:
        return _ZUS_PREF_SOCIAL_SICK if config.has_sick_insurance else _ZUS_PREF_SOCIAL_NO_SICK
    # pelny_zus and maly_zus_plus use full amounts (mały ZUS varies per person
    # but we use full as a conservative estimate; user can override via FixedCost)
    return _ZUS_FULL_SOCIAL_SICK if config.has_sick_insurance else _ZUS_FULL_SOCIAL_NO_SICK


def _calc_health_contribution(
    config: CompanyTaxConfig,
    monthly_income: Decimal,
    ytd_revenue: Decimal = _ZERO,
) -> Decimal:
    """Monthly health contribution (składka zdrowotna) — 2026 rules."""
    if config.zus_status == CompanyTaxConfig.ZUS_ETAT_JDG:
        return _ZERO  # covered by employer
    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_SCALE:
        base = max(monthly_income, _ZERO)
        return max(base * Decimal("0.09"), _MIN_HEALTH_2026).quantize(_CENT, rounding=ROUND_HALF_UP)
    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        base = max(monthly_income, _ZERO)
        return max(base * Decimal("0.049"), _MIN_HEALTH_2026).quantize(_CENT, rounding=ROUND_HALF_UP)
    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        if ytd_revenue >= _RYCZALT_THRESHOLD_300K:
            return _RYCZALT_HEALTH_TIER3
        if ytd_revenue >= _RYCZALT_THRESHOLD_60K:
            return _RYCZALT_HEALTH_TIER2
        return _RYCZALT_HEALTH_TIER1
    return _MIN_HEALTH_2026


def _calc_pit(
    config: CompanyTaxConfig,
    net_revenue: Decimal,
    net_costs: Decimal,
    zus_social: Decimal,
    health_contribution: Decimal,
) -> Decimal:
    """Monthly PIT advance (zaliczka PIT) — 2026 rules. Always >= 0."""
    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_SCALE:
        taxable = max(net_revenue - net_costs - zus_social, _ZERO)
        pit = max(taxable * Decimal("0.12") - _PIT_FREE_MONTHLY, _ZERO)
        return pit.quantize(_CENT, rounding=ROUND_HALF_UP)

    if config.tax_form == CompanyTaxConfig.TAX_FORM_KPIR_LINEAR:
        health_deductible = min(health_contribution, _HEALTH_LINIOWY_MAX_MONTHLY)
        taxable = max(net_revenue - net_costs - zus_social - health_deductible, _ZERO)
        return (taxable * Decimal("0.19")).quantize(_CENT, rounding=ROUND_HALF_UP)

    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        health_50 = (health_contribution * Decimal("0.5")).quantize(_CENT, rounding=ROUND_HALF_UP)
        taxable = max(net_revenue - health_50, _ZERO)
        return (taxable * config.tax_rate / 100).quantize(_CENT, rounding=ROUND_HALF_UP)

    return _ZERO


# ---------------------------------------------------------------------------
# PIT helper (backward-compat wrapper)
# ---------------------------------------------------------------------------


def _get_pit_estimate(
    config: CompanyTaxConfig, total_net_revenue: Decimal, total_net_costs: Decimal
) -> Decimal:
    """Backward-compatible PIT estimate using tax_rate directly (used by existing tests).

    For the live dashboard use _calc_pit() instead, which applies 2026 rules.
    """
    if config.tax_form == CompanyTaxConfig.TAX_FORM_RYCZALT:
        taxable = max(total_net_revenue, _ZERO)
    else:
        taxable = max(total_net_revenue - total_net_costs, _ZERO)
    return (taxable * config.tax_rate / 100).quantize(_CENT, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Uncategorized KSeF invoices counter
# ---------------------------------------------------------------------------


def _count_uncategorized_ksef(company, period_start, period_end) -> int:
    """Count received KSeF invoices in the period with no OPEX category.

    An invoice is considered categorized when:
    - it has an invoice-level ``opex_category``, OR
    - at least one of its lines has an ``InvoiceLineAnnotation.opex_category``

    All others (no category at all) are uncategorized and therefore excluded
    from cost/VAT calculations — which is what the banner warns the user about.
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    invoices = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    )

    count = 0
    for invoice in invoices:
        has_line = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
            opex_category__isnull=False,
        ).exists()
        if not has_line and not invoice.opex_category:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Expense breakdown (for chart)
# ---------------------------------------------------------------------------


def _get_expense_breakdown(company, period_start, period_end) -> dict:
    """Return costs broken down by OPEX category for the given period.

    Sources:
    - ReceivedKSeFInvoice with opex_category set (or line annotations)
    - QuickExpense grouped by category
    - FixedCost (active, as fixed monthly amount)

    Returns dict: {category_slug: amount, ..., "total": amount}
    """
    from apps.cost_allocation.models import InvoiceLineAnnotation

    result = {}

    # 1. KSeF invoices — line-level if available, else invoice-level
    invoices_qs = ReceivedKSeFInvoice.objects.filter(
        company=company,
        issue_date__gte=period_start,
        issue_date__lte=period_end,
    )
    for invoice in invoices_qs:
        annotated_lines = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
            opex_category__isnull=False,
        ).select_related("line")
        if annotated_lines.exists():
            for ann in annotated_lines:
                cat = ann.opex_category
                result[cat] = result.get(cat, _ZERO) + (ann.line.line_net or _ZERO)
        elif invoice.opex_category:
            cat = invoice.opex_category
            result[cat] = result.get(cat, _ZERO) + (invoice.gross_amount or _ZERO)

    # 2. QuickExpense grouped by category
    for exp in QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ):
        cat = exp.category
        result[cat] = result.get(cat, _ZERO) + exp.amount

    # 3. Fixed costs — broken down by their own category (prefix "fixed_")
    from apps.fixed_costs.models import FixedCost as FixedCostModel
    fixed_items = FixedCostModel.objects.filter(
        company=company,
        is_active=True,
        active_from__lte=period_end,
    )
    for item in fixed_items:
        key = f"fixed_{item.category}"
        result[key] = result.get(key, _ZERO) + item.amount_monthly

    # Convert Decimal to float, compute total
    result_float = {
        k: float(v.quantize(_CENT, rounding=ROUND_HALF_UP)) for k, v in result.items()
    }
    result_float["total"] = sum(result_float.values())

    return result_float


# ---------------------------------------------------------------------------
# Receivables / Payables helpers
# ---------------------------------------------------------------------------


def _get_receivables(company, today: datetime.date) -> list:
    """Open B2B invoices that the client hasn't paid yet."""
    invoices = (
        Invoice.objects.filter(
            company=company,
            status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_OVERDUE],
        )
        .select_related("customer")
        .order_by("due_date")[:10]
    )
    result = []
    for inv in invoices:
        days = (inv.due_date - today).days if inv.due_date else None
        result.append(
            {
                "id": str(inv.uuid),
                "invoice_number": inv.invoice_number or "",
                "customer_name": inv.customer.name if inv.customer else "",
                "amount": float(
                    (inv.total_gross or _ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)
                ),
                "due_date": str(inv.due_date) if inv.due_date else None,
                "days_until": days,
            }
        )
    return result


def _get_payables(company, today: datetime.date) -> dict:
    """Unpaid supplier invoices (ReceivedKSeF) — money you owe.

    Returns:
        total_count   – all unpaid invoices (regardless of due_date)
        total_amount  – sum of gross_amount across ALL unpaid invoices
        items         – up to 5 invoices with due_date, sorted overdue-first
    """
    all_unpaid = ReceivedKSeFInvoice.objects.filter(company=company, is_paid=False)
    total_count = all_unpaid.count()
    total_amount = float(
        (all_unpaid.aggregate(s=Sum("gross_amount"))["s"] or _ZERO)
        .quantize(_CENT, rounding=ROUND_HALF_UP)
    )

    # Preview: top 5 with a known due_date, overdue first
    preview_qs = all_unpaid.filter(due_date__isnull=False).order_by("due_date")[:5]
    items = []
    for inv in preview_qs:
        items.append(
            {
                "id": str(inv.uuid),
                "ksef_number": inv.ksef_number or "",
                "invoice_number": inv.invoice_number or "",
                "seller_name": inv.seller_name or "Nieznany dostawca",
                "issue_date": str(inv.issue_date) if inv.issue_date else "",
                "amount": float(
                    (inv.gross_amount or _ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)
                ),
                "due_date": str(inv.due_date),
                "days_until": (inv.due_date - today).days,
            }
        )
    return {"total_count": total_count, "total_amount": total_amount, "items": items}


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def _next_due_date(today: datetime.date, due_day: int) -> datetime.date:
    """Return the upcoming due date for *due_day* of the month.

    If this month's *due_day* is still in the future (or today), return it.
    Otherwise return the same day next month.
    """
    try:
        this_month_due = today.replace(day=due_day)
    except ValueError:
        # due_day out of range for this month — use last day
        last_day = calendar.monthrange(today.year, today.month)[1]
        this_month_due = today.replace(day=last_day)

    if this_month_due >= today:
        return this_month_due

    # Move to next month
    if today.month == 12:
        next_month = datetime.date(today.year + 1, 1, 1)
    else:
        next_month = datetime.date(today.year, today.month + 1, 1)

    try:
        return next_month.replace(day=due_day)
    except ValueError:
        last_day = calendar.monthrange(next_month.year, next_month.month)[1]
        return next_month.replace(day=last_day)
