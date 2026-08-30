"""Payment schedule (harmonogram płatności) computation.

Builds a day-by-day list of confirmed cash events for a given month:

Incoming (green = already received, orange = overdue, gray = expected):
  - B2B invoices — by due_date; status reflects paid_at / overdue
  - DailyB2CRevenue — only confirmed entries (user-submitted)

Outgoing (scheduled):
  - FixedCost items — placed on their due_day each month
  - VAT obligation — calculated from tax config, due on vat_due_day of next month
  - ZUS social + health — placed on zus_due_day of current month
  - ReceivedKSeFInvoice (unpaid) — by their due_date

Returns a list of day dicts sorted by date, plus a summary.
"""

import calendar
import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q, Sum

from apps.fixed_costs.models import FixedCost
from apps.invoices.models import Invoice
from apps.ksef.models import ReceivedKSeFInvoice

from .models import CompanyTaxConfig, DailyB2CRevenue
from .services import (
    _calc_health_contribution,
    _calc_zus_social,
    _get_vat_nalezny,
    _get_vat_naliczony,
    _get_ytd_revenue,
)

_ZERO = Decimal("0.00")
_CENT = Decimal("0.01")

# Event type constants
TYPE_B2B_INCOMING = "b2b_incoming"
TYPE_B2C_INCOMING = "b2c_incoming"
TYPE_FIXED_COST = "fixed_cost"
TYPE_VAT = "vat"
TYPE_ZUS_SOCIAL = "zus_social"
TYPE_ZUS_HEALTH = "zus_health"
TYPE_SUPPLIER_INVOICE = "supplier_invoice"

# Status constants
STATUS_PAID = "paid"          # money already moved
STATUS_EXPECTED = "expected"  # scheduled, not yet
STATUS_OVERDUE = "overdue"    # past due date, not received/paid


def compute_harmonogram(company, month_str: str | None = None) -> dict:
    """Return the full harmonogram payload for *company* for the given month.

    *month_str* is ``YYYY-MM``; defaults to current month.
    """
    today = datetime.date.today()

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

    events: list[dict] = []

    # ── 1. B2B INCOMING ───────────────────────────────────────────────────────
    # Paid invoices: show on the actual payment date (paid_at) if it falls in
    # this month.  Unpaid invoices (issued/sent/overdue): show on due_date if
    # it falls in this month.

    b2b_invoices = Invoice.objects.filter(
        company=company,
        status__in=[
            Invoice.STATUS_ISSUED,
            Invoice.STATUS_SENT,
            Invoice.STATUS_OVERDUE,
            Invoice.STATUS_PAID,
        ],
    ).filter(
        Q(
            status=Invoice.STATUS_PAID,
            paid_at__date__gte=period_start,
            paid_at__date__lte=period_end,
        ) | Q(
            status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_OVERDUE],
            due_date__gte=period_start,
            due_date__lte=period_end,
        )
    ).select_related("customer").order_by("due_date")

    for inv in b2b_invoices:
        if inv.status == Invoice.STATUS_PAID and inv.paid_at:
            event_date = inv.paid_at.date()
            ev_status = STATUS_PAID
        elif inv.due_date and inv.due_date < today:
            event_date = inv.due_date
            ev_status = STATUS_OVERDUE
        else:
            event_date = inv.due_date or period_end
            ev_status = STATUS_EXPECTED

        events.append({
            "date": str(event_date),
            "type": TYPE_B2B_INCOMING,
            "label": inv.customer.name if inv.customer else inv.invoice_number or "Faktura",
            "sublabel": inv.invoice_number or "",
            "amount": float((inv.total_gross or _ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "in",
            "status": ev_status,
        })

    # ── 2. B2C INCOMING — only confirmed DailyB2CRevenue entries ─────────────

    b2c_entries = DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ).order_by("date")

    for entry in b2c_entries:
        events.append({
            "date": str(entry.date),
            "type": TYPE_B2C_INCOMING,
            "label": "Sprzedaż gotówkowa B2C",
            "sublabel": entry.notes or "",
            "amount": float(entry.amount.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "in",
            "status": STATUS_PAID,  # submitted = confirmed
        })

    # ── 3. FIXED COSTS — placed on their due_day ─────────────────────────────

    fixed_costs = FixedCost.objects.filter(
        company=company,
        is_active=True,
        active_from__lte=period_end,
    ).order_by("due_day", "description")

    last_day = period_end.day
    for fc in fixed_costs:
        day = fc.due_day if fc.due_day else None
        if day is None:
            continue  # skip costs with no due_day — they're just totals
        day = min(day, last_day)
        event_date = datetime.date(year, month, day)
        ev_status = STATUS_PAID if event_date <= today else STATUS_EXPECTED
        events.append({
            "date": str(event_date),
            "type": TYPE_FIXED_COST,
            "label": fc.description or fc.get_category_display(),
            "sublabel": fc.get_category_display(),
            "amount": float(fc.amount_monthly.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "out",
            "status": ev_status,
        })

    # ── 4. VAT — due on vat_due_day of the NEXT month for this period ────────

    if config.vat_payer:
        next_month_first = (period_end + datetime.timedelta(days=1)).replace(day=1)
        try:
            vat_due = next_month_first.replace(day=config.vat_due_day)
        except ValueError:
            vat_due = next_month_first.replace(
                day=calendar.monthrange(next_month_first.year, next_month_first.month)[1]
            )

        # Only include VAT due date if it falls within the requested month
        # (i.e., when viewing the month AFTER the billing period)
        # Always include it — we show it as "coming up" on the due date
        vat_out = _get_vat_nalezny(company, config, period_start, period_end)
        vat_in = _get_vat_naliczony(company, config, period_start, period_end)
        vat_to_pay = max(vat_out - vat_in, _ZERO)

        # Show VAT event in the month it is due (next month)
        # But also show a "reservation" entry in current month on last day
        if vat_to_pay > _ZERO:
            # Show as upcoming if the due date is next month — show in current month as reminder
            vat_event_date = period_end  # reserve on last day of billing month
            ev_status = STATUS_PAID if vat_event_date < today else STATUS_EXPECTED
            events.append({
                "date": str(vat_event_date),
                "type": TYPE_VAT,
                "label": f"VAT {month}/{year}",
                "sublabel": f"Termin: {vat_due.strftime('%d.%m.%Y')}",
                "amount": float(vat_to_pay.quantize(_CENT, rounding=ROUND_HALF_UP)),
                "direction": "out",
                "status": ev_status,
            })

    # ── 5. ZUS — social + health on zus_due_day of THIS month ────────────────

    try:
        zus_due = datetime.date(year, month, config.zus_due_day)
    except ValueError:
        zus_due = period_end

    zus_social = _calc_zus_social(config)
    ytd = _get_ytd_revenue(company, config, period_end)

    # Estimate monthly income for health (simplified — use zero for schedule purposes)
    zus_health = _calc_health_contribution(config, _ZERO, ytd)

    zus_ev_status = STATUS_PAID if zus_due <= today else STATUS_EXPECTED

    if zus_social > _ZERO:
        events.append({
            "date": str(zus_due),
            "type": TYPE_ZUS_SOCIAL,
            "label": "ZUS społeczny",
            "sublabel": f"Termin: {zus_due.strftime('%d.%m.%Y')}",
            "amount": float(zus_social.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "out",
            "status": zus_ev_status,
        })

    if zus_health > _ZERO:
        events.append({
            "date": str(zus_due),
            "type": TYPE_ZUS_HEALTH,
            "label": "Składka zdrowotna",
            "sublabel": f"Termin: {zus_due.strftime('%d.%m.%Y')}",
            "amount": float(zus_health.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "out",
            "status": zus_ev_status,
        })

    # ── 6. UNPAID SUPPLIER INVOICES — by their due_date ──────────────────────

    supplier_invoices = ReceivedKSeFInvoice.objects.filter(
        company=company,
        is_paid=False,
        due_date__gte=period_start,
        due_date__lte=period_end,
    ).order_by("due_date")

    for inv in supplier_invoices:
        ev_status = STATUS_OVERDUE if inv.due_date < today else STATUS_EXPECTED
        events.append({
            "date": str(inv.due_date),
            "type": TYPE_SUPPLIER_INVOICE,
            "label": inv.seller_name or "Dostawca",
            "sublabel": inv.invoice_number or inv.ksef_number or "",
            "amount": float((inv.gross_amount or _ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "out",
            "status": ev_status,
        })

    # ── Sort all events by date ───────────────────────────────────────────────

    events.sort(key=lambda e: (e["date"], e["direction"]))  # out before in on same day? No — in first
    # Actually: show incoming before outgoing on the same day (better for running balance)
    events.sort(key=lambda e: (e["date"], 0 if e["direction"] == "in" else 1))

    # ── Running balance ───────────────────────────────────────────────────────

    bank = config.bank_balance or _ZERO
    cash = config.cash_balance or _ZERO
    opening_balance = float((bank + cash).quantize(_CENT, rounding=ROUND_HALF_UP))

    running = Decimal(str(opening_balance))
    min_balance = running
    min_balance_date = None

    for ev in events:
        amount = Decimal(str(ev["amount"]))
        if ev["direction"] == "in":
            running += amount
        else:
            running -= amount
        ev["running_balance"] = float(running.quantize(_CENT, rounding=ROUND_HALF_UP))
        if running < min_balance:
            min_balance = running
            min_balance_date = ev["date"]

    # ── Summary ───────────────────────────────────────────────────────────────

    total_in = sum(
        (Decimal(str(e["amount"])) for e in events if e["direction"] == "in"), _ZERO
    )
    total_out = sum(
        (Decimal(str(e["amount"])) for e in events if e["direction"] == "out"), _ZERO
    )
    confirmed_in = sum(
        (Decimal(str(e["amount"]))
        for e in events
        if e["direction"] == "in" and e["status"] == STATUS_PAID), _ZERO
    )
    expected_in = sum(
        (Decimal(str(e["amount"]))
        for e in events
        if e["direction"] == "in" and e["status"] in (STATUS_EXPECTED, STATUS_OVERDUE)), _ZERO
    )

    _q = lambda d: float(d.quantize(_CENT, rounding=ROUND_HALF_UP))

    return {
        "period": f"{year}-{month:02d}",
        "opening_balance": opening_balance,
        "has_balance": config.bank_balance > _ZERO or config.cash_balance > _ZERO,
        "balance_updated_at": (
            config.balance_updated_at.isoformat() if config.balance_updated_at else None
        ),
        "total_in": _q(total_in),
        "confirmed_in": _q(confirmed_in),
        "expected_in": _q(expected_in),
        "total_out": _q(total_out),
        "closing_balance": float(running.quantize(_CENT, rounding=ROUND_HALF_UP)),
        "min_balance": _q(min_balance),
        "min_balance_date": min_balance_date,
        "events": events,
    }
