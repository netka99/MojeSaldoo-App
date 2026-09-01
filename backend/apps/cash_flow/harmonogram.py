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
  - QuickExpense — cash expenses by their date (always paid)

Returns a list of day dicts sorted by date, plus a summary.
"""

import calendar
import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q, Sum

from apps.fixed_costs.models import FixedCost
from apps.invoices.models import Invoice
from apps.ksef.models import ReceivedKSeFInvoice

from .models import CompanyTaxConfig, DailyB2CRevenue, QuickExpense
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
TYPE_QUICK_EXPENSE = "quick_expense"

# Status constants
STATUS_PAID = "paid"          # money already moved
STATUS_EXPECTED = "expected"  # scheduled, not yet
STATUS_OVERDUE = "overdue"    # past due date, not received/paid


def _compute_period_net_flow(
    company, config, date_from: datetime.date, date_to: datetime.date
) -> Decimal:
    """Return net cash (in − out) for all harmonogram events in [date_from, date_to].

    Used to project the opening balance when the viewed month differs from the
    anchor month.  Mirrors the event logic in compute_harmonogram exactly so
    the two are always in sync.
    """
    if date_from > date_to:
        return _ZERO

    net = _ZERO

    # B2B paid — actual receipt date
    agg = Invoice.objects.filter(
        company=company,
        status=Invoice.STATUS_PAID,
        paid_at__date__gte=date_from,
        paid_at__date__lte=date_to,
    ).aggregate(s=Sum("total_gross"))
    net += agg["s"] or _ZERO

    # B2B unpaid — by due_date
    agg = Invoice.objects.filter(
        company=company,
        status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_OVERDUE],
        due_date__gte=date_from,
        due_date__lte=date_to,
    ).aggregate(s=Sum("total_gross"))
    net += agg["s"] or _ZERO

    # B2C
    agg = DailyB2CRevenue.objects.filter(
        company=company,
        date__gte=date_from,
        date__lte=date_to,
    ).aggregate(s=Sum("amount"))
    net += agg["s"] or _ZERO

    # Fixed costs — recurring by due_day, iterate month by month
    y, m = date_from.year, date_from.month
    while True:
        m_end = datetime.date(y, m, calendar.monthrange(y, m)[1])
        fixed_costs = FixedCost.objects.filter(
            company=company,
            is_active=True,
            active_from__lte=m_end,
        )
        for fc in fixed_costs:
            if fc.due_day is None:
                continue
            day = min(fc.due_day, m_end.day)
            fc_date = datetime.date(y, m, day)
            if date_from <= fc_date <= date_to:
                net -= fc.amount_monthly
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        if datetime.date(y, m, 1) > date_to:
            break

    # VAT — event placed on last day of the billing month
    if config.vat_payer:
        y, m = date_from.year, date_from.month
        while True:
            m_start = datetime.date(y, m, 1)
            m_end = datetime.date(y, m, calendar.monthrange(y, m)[1])
            if date_from <= m_end <= date_to:
                vat_out = _get_vat_nalezny(company, config, m_start, m_end)
                vat_in = _get_vat_naliczony(company, config, m_start, m_end)
                net -= max(vat_out - vat_in, _ZERO)
            if m == 12:
                y, m = y + 1, 1
            else:
                m += 1
            if datetime.date(y, m, 1) > date_to:
                break

    # ZUS — on zus_due_day of each month
    y, m = date_from.year, date_from.month
    while True:
        try:
            zus_due = datetime.date(y, m, config.zus_due_day)
        except ValueError:
            zus_due = datetime.date(y, m, calendar.monthrange(y, m)[1])
        if date_from <= zus_due <= date_to:
            zus_social = _calc_zus_social(config)
            ytd = _get_ytd_revenue(company, config, zus_due)
            zus_health = _calc_health_contribution(config, _ZERO, ytd)
            net -= zus_social + zus_health
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        if datetime.date(y, m, 1) > date_to:
            break

    # Supplier invoices (unpaid) by due_date
    agg = ReceivedKSeFInvoice.objects.filter(
        company=company,
        is_paid=False,
        due_date__gte=date_from,
        due_date__lte=date_to,
    ).aggregate(s=Sum("gross_amount"))
    net -= agg["s"] or _ZERO

    # Quick expenses
    agg = QuickExpense.objects.filter(
        company=company,
        date__gte=date_from,
        date__lte=date_to,
    ).aggregate(s=Sum("amount"))
    net -= agg["s"] or _ZERO

    return net


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

    # ── 7. QUICK EXPENSES — cash expenses by their date ──────────────────────

    quick_expenses = QuickExpense.objects.filter(
        company=company,
        date__gte=period_start,
        date__lte=period_end,
    ).order_by("date")

    for qe in quick_expenses:
        events.append({
            "date": str(qe.date),
            "type": TYPE_QUICK_EXPENSE,
            "label": qe.vendor or qe.get_category_display(),
            "sublabel": qe.get_category_display() if qe.vendor else "",
            "amount": float(qe.amount.quantize(_CENT, rounding=ROUND_HALF_UP)),
            "direction": "out",
            "status": STATUS_PAID,  # cash expenses are always already paid
        })

    # ── Sort all events by date ───────────────────────────────────────────────

    events.sort(key=lambda e: (e["date"], e["direction"]))  # out before in on same day? No — in first
    # Actually: show incoming before outgoing on the same day (better for running balance)
    events.sort(key=lambda e: (e["date"], 0 if e["direction"] == "in" else 1))

    # ── Running balance ───────────────────────────────────────────────────────

    bank = config.bank_balance or _ZERO
    cash = config.cash_balance or _ZERO
    vat = config.vat_balance or _ZERO
    anchor_balance = bank + cash  # freely available (VAT account is locked)
    vat_balance = float(vat.quantize(_CENT, rounding=ROUND_HALF_UP))
    has_balance = bank > _ZERO or cash > _ZERO or vat > _ZERO

    # Anchor date: the date the user says the balance is valid for.
    # Use balance_date if explicitly set by the user; fall back to balance_updated_at.
    # Events BEFORE anchor are already baked into the entered balance — exclude
    # them from the running_balance chain to avoid double-counting.
    # Anchor logic only applies when there is an actual balance set (has_balance=True).
    # Without a real balance, all events chain from 0 — no exclusions.
    if config.balance_date:
        anchor_date = config.balance_date
    elif config.balance_updated_at:
        anchor_date = config.balance_updated_at.date()
    else:
        anchor_date = None
    anchor_in_month = bool(
        has_balance and anchor_date and period_start <= anchor_date <= period_end
    )

    # Compute opening balance for the viewed month, carrying over from the anchor.
    # When the viewed month differs from the anchor month we project forward/backward
    # using _compute_period_net_flow so July → August → September are all connected.
    # If no anchor_date is known we cannot project — fall back to the entered balance as-is.
    if not has_balance:
        opening_balance_d = _ZERO
    elif not anchor_date:
        # Balance entered but no anchor date — use it directly (no carryover possible)
        opening_balance_d = anchor_balance
    else:
        anchor_ym = (anchor_date.year, anchor_date.month)
        viewed_ym = (year, month)
        if viewed_ym == anchor_ym:
            # Same month — anchor balance is the starting point as-is
            opening_balance_d = anchor_balance
        elif viewed_ym > anchor_ym:
            # Later month — carry forward: add net flow from anchor_date to day before this month
            flow_end = period_start - datetime.timedelta(days=1)
            net = _compute_period_net_flow(company, config, anchor_date, flow_end)
            opening_balance_d = anchor_balance + net
        else:
            # Earlier month — carry backward: subtract net flow from this month start to day before anchor
            flow_end = anchor_date - datetime.timedelta(days=1)
            net = _compute_period_net_flow(company, config, period_start, flow_end)
            opening_balance_d = anchor_balance - net

    opening_balance = float(opening_balance_d.quantize(_CENT, rounding=ROUND_HALF_UP))

    running = Decimal(str(opening_balance))
    min_balance = running
    min_balance_date = None

    for ev in events:
        ev_date = datetime.date.fromisoformat(ev["date"])
        if anchor_in_month and ev_date < anchor_date:
            # Before anchor: already included in the entered balance, show for context only
            ev["before_anchor"] = True
            ev["running_balance"] = None
        else:
            ev["before_anchor"] = False
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
        "vat_balance": vat_balance,
        "has_balance": has_balance,
        "anchor_date": anchor_date.isoformat() if anchor_date else None,
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
