import { useState, useRef, useCallback, Fragment } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, addMonths, subMonths, parseISO, getDaysInMonth, getDay, startOfMonth, differenceInCalendarDays } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

import { TaxConfigSetup } from '@/components/features/cashflow/TaxConfigSetup';
import { PageExplainer } from '@/components/ui/PageExplainer';
import { useHarmonogramQuery, cashFlowKeys } from '@/query/use-cashflow';
import { useAuth } from '@/context/AuthContext';
import type { HarmonogramEvent } from '@/types/cashflow.types';

// Inline SVG icons (no external icon library required)
function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}
function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function IconTrendingDown({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}
function IconInfo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 2,
});

function fmt(value: number) {
  return pln.format(value);
}

function fmtShort(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1).replace('.', ',')} tys.`;
  return value.toFixed(0);
}

function eventTypeLabel(type: HarmonogramEvent['type']): string {
  switch (type) {
    case 'b2b_incoming': return 'Faktura B2B';
    case 'b2c_incoming': return 'Sprzedaż B2C';
    case 'fixed_cost':   return 'Koszt stały';
    case 'vat':          return 'VAT';
    case 'zus_social':   return 'ZUS społeczny';
    case 'zus_health':   return 'Składka zdrowotna';
    case 'supplier_invoice': return 'Faktura dostawcy';
    case 'quick_expense':    return 'Wydatek gotówkowy';
  }
}

function eventTooltip(event: HarmonogramEvent): string {
  switch (event.type) {
    case 'b2b_incoming':
      return event.status === 'paid'
        ? 'Faktury od klientów B2B opłacone w tym miesiącu — niezależnie od miesiąca wystawienia.'
        : 'Faktury od klientów B2B z terminem płatności w tym miesiącu — w tym wystawione w poprzednich miesiącach.';
    case 'b2c_incoming':
      return 'Sprzedaż gotówkowa wprowadzona w tym miesiącu.';
    case 'fixed_cost':
      return 'Stałe wydatki z terminem płatności w tym miesiącu — czynsz, leasing i inne koszty stałe.';
    case 'supplier_invoice':
      return 'Nieopłacone faktury od dostawców z terminem płatności w tym miesiącu — w tym wystawione w poprzednich miesiącach.';
    case 'quick_expense':
      return 'Wydatek gotówkowy wprowadzony ręcznie — paragon, faktura bez KSeF lub inny koszt.';
    case 'vat':
      return 'VAT należny z Twoich faktur sprzedażowych minus VAT naliczony z faktur zakupowych. Termin płatności: 25. następnego miesiąca.';
    case 'zus_social':
      return 'Stała składka ZUS społeczny. Termin płatności: 20. tego miesiąca.';
    case 'zus_health':
      return 'Składka zdrowotna liczona od dochodu. Termin płatności: 20. tego miesiąca.';
  }
}

function statusDot(status: HarmonogramEvent['status'], direction: 'in' | 'out') {
  if (status === 'paid') return direction === 'in' ? 'bg-green-500' : 'bg-slate-400';
  if (status === 'overdue') return 'bg-red-500';
  return direction === 'in' ? 'bg-blue-400' : 'bg-orange-400';
}

// ---------------------------------------------------------------------------
// Day group
// ---------------------------------------------------------------------------

interface DayGroup {
  date: string;
  events: HarmonogramEvent[];
}

function groupByDay(events: HarmonogramEvent[]): DayGroup[] {
  const map = new Map<string, HarmonogramEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.date) ?? [];
    list.push(ev);
    map.set(ev.date, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, evs]) => ({ date, events: evs }));
}

function dayNet(events: HarmonogramEvent[]) {
  return events.reduce((acc, e) => e.direction === 'in' ? acc + e.amount : acc - e.amount, 0);
}

// ---------------------------------------------------------------------------
// Calendar grid
// ---------------------------------------------------------------------------

// Polish week starts on Monday: Mon=0 … Sun=6
// JS getDay(): Sun=0, Mon=1 … Sat=6 → convert to Mon-based
function jsToMon(jsDay: number) {
  return (jsDay + 6) % 7;
}

const WEEK_LABELS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

interface CalendarGridProps {
  month: string;          // 'YYYY-MM'
  groups: DayGroup[];
  today: string;
  hasBalance: boolean;
  anchorDate: string | null;
  onDayClick: (date: string) => void;
}

function CalendarGrid({ month, groups, today, hasBalance, anchorDate, onDayClick }: CalendarGridProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const byDate = new Map<string, DayGroup>(groups.map(g => [g.date, g]));

  const firstDay = parseISO(`${month}-01`);
  const totalDays = getDaysInMonth(firstDay);
  const startPad = jsToMon(getDay(startOfMonth(firstDay)));

  // Build grid cells: nulls for padding + day numbers
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // Pad end to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mb-5 rounded-lg border border-border bg-card overflow-hidden">
      {/* Week day headers */}
      <div className="grid grid-cols-7 border-b border-border/50">
        {WEEK_LABELS.map(label => (
          <div key={label} className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`pad-${idx}`} className="border-b border-r border-border/30 last:border-r-0 aspect-square" />;
          }

          const dateStr = `${month}-${String(day).padStart(2, '0')}`;
          const group = byDate.get(dateStr);
          const net = group ? dayNet(group.events) : null;
          const lastEvent = group ? group.events[group.events.length - 1] : null;
          // closingBalance for calendar cell =X tys. — only when balance is set
          const closingBalance = hasBalance && lastEvent?.running_balance != null ? lastEvent.running_balance : null;
          // tooltipBalance for hover detail — always show when running_balance available (even without balance, starts from 0)
          const tooltipBalance = lastEvent?.running_balance != null ? lastEvent.running_balance : null;
          const isToday = dateStr === today;
          const isPast = dateStr < today;
          const hasNeg = hasBalance && (group?.events.some(e => e.running_balance !== null && e.running_balance < 0) ?? false);
          const isHovered = hoveredDate === dateStr;

          const colIdx = idx % 7;
          const isLastCol = colIdx === 6;
          const totalRows = Math.ceil(cells.length / 7);
          const rowIdx = Math.floor(idx / 7);
          const isLastRow = rowIdx >= totalRows - 2; // last two rows → tooltip upward

          return (
            <div
              key={dateStr}
              className={`relative border-b border-border/30 ${!isLastCol ? 'border-r' : ''} select-none`}
              style={{ minHeight: '52px' }}
              onMouseEnter={() => group && setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
              onClick={() => group && onDayClick(dateStr)}
            >
              {/* Cell background */}
              <div className={`h-full w-full p-1.5 transition-colors ${
                hasNeg
                  ? 'bg-red-50/60 hover:bg-red-100/60'
                  : group
                    ? 'hover:bg-muted/60 cursor-pointer'
                    : ''
              } ${isToday ? 'bg-primary/5' : ''}`}>

                {/* Day number */}
                <span className={`block text-[11px] font-semibold leading-none mb-1 ${
                  isToday
                    ? 'flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px]'
                    : isPast && !group
                      ? 'text-muted-foreground/40'
                      : 'text-foreground'
                }`}>
                  {day}
                </span>

                {/* Net change */}
                {net !== null && (
                  <span className={`block text-[10px] font-semibold tabular-nums leading-none ${
                    net >= 0 ? 'text-green-700' : 'text-red-600'
                  }`}>
                    {net >= 0 ? '+' : ''}{fmtShort(net)}
                  </span>
                )}

                {/* Closing balance — only when has_balance and running_balance is available */}
                {closingBalance !== null && (
                  <span className={`block text-[9px] tabular-nums leading-none mt-0.5 ${
                    closingBalance < 0 ? 'font-bold text-red-600' : 'text-muted-foreground'
                  }`}>
                    ={fmtShort(closingBalance)}
                  </span>
                )}

                {/* Event dots row */}
                {group && (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {group.events.slice(0, 4).map((ev, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${statusDot(ev.status, ev.direction)}`}
                      />
                    ))}
                    {group.events.length > 4 && (
                      <span className="text-[9px] text-muted-foreground leading-none">+{group.events.length - 4}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Hover tooltip */}
              {isHovered && group && (
                <div
                  className={`absolute z-20 w-60 rounded-lg border border-border bg-popover p-3 shadow-lg text-xs ${
                    colIdx >= 4 ? 'right-0' : 'left-0'
                  } ${isLastRow ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                  style={{ pointerEvents: 'none' }}
                >
                  {/* Header: date only */}
                  <p className="mb-2 font-semibold text-foreground capitalize">
                    {format(parseISO(dateStr), 'd MMMM', { locale: pl })}
                  </p>

                  {/* Previous day balance — only when balance is set */}
                  {hasBalance && tooltipBalance !== null && (() => {
                    const prevDayBalance = tooltipBalance - net!;
                    return (
                      <div className="mb-1.5 flex justify-between text-[10px] border-b border-border/40 pb-1.5">
                        <span className="text-muted-foreground">Było wcześniej</span>
                        <span className={`tabular-nums font-semibold ${prevDayBalance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {fmt(prevDayBalance)}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Events — with running balance only when balance is set */}
                  <div className="space-y-1.5">
                    {group.events.map((ev, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(ev.status, ev.direction)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-muted-foreground">{ev.label}</span>
                            <span className={`shrink-0 font-semibold tabular-nums ${ev.direction === 'in' ? 'text-green-700' : 'text-foreground'}`}>
                              {ev.direction === 'in' ? '+' : '−'}{fmt(ev.amount)}
                            </span>
                          </div>
                          {hasBalance && ev.running_balance !== null && (
                            <div className={`text-right text-[10px] tabular-nums ${ev.running_balance < 0 ? 'font-bold text-red-600' : 'text-muted-foreground/70'}`}>
                              = {fmt(ev.running_balance)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Net change + closing balance footer */}
                  <div className="mt-2 border-t border-border/50 pt-2 space-y-0.5">
                    <div className={`flex justify-between text-[10px] font-medium ${net! >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      <span>Zmiana w tym dniu</span>
                      <span className="tabular-nums">{net! >= 0 ? '+' : ''}{fmt(net!)}</span>
                    </div>
                    {hasBalance && tooltipBalance !== null && (
                      <div className={`flex justify-between text-[10px] font-bold ${tooltipBalance < 0 ? 'text-red-600' : 'text-foreground'}`}>
                        <span>Zostaje na koniec dnia</span>
                        <span className="tabular-nums">{fmt(tooltipBalance)}</span>
                      </div>
                    )}
                  </div>

                  {/* Anchor info if this day is the anchor */}
                  {anchorDate === dateStr && (
                    <p className="mt-1.5 text-[10px] text-primary font-medium text-center">
                      📍 Stan konta wpisany na ten dzień
                    </p>
                  )}

                  <p className="mt-1 text-center text-[10px] text-muted-foreground/70">Kliknij, żeby przejść do listy ↓</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

function EventRow({ event, hasBalance }: { event: HarmonogramEvent; hasBalance: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isIn = event.direction === 'in';
  const isNegBal = hasBalance && event.running_balance !== null && event.running_balance < 0;

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 ${isNegBal ? 'bg-red-50/50' : ''} ${event.before_anchor ? 'opacity-40' : ''}`}>
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${statusDot(event.status, event.direction)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="truncate text-sm font-medium text-foreground">{event.label}</p>
          <div className="relative shrink-0">
            <button
              type="button"
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              onClick={() => setShowTooltip(v => !v)}
              aria-label="Więcej informacji"
            >
              <IconInfo className="h-3 w-3" />
            </button>
            {showTooltip && (
              <div
                className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg text-xs text-muted-foreground"
                onClick={e => e.stopPropagation()}
              >
                {eventTooltip(event)}
                <button
                  type="button"
                  className="mt-2 block text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
                  onClick={() => setShowTooltip(false)}
                >
                  Zamknij
                </button>
              </div>
            )}
          </div>
        </div>
        {event.sublabel && (
          <p className="truncate text-xs text-muted-foreground">{event.sublabel}</p>
        )}
        <p className="text-xs text-muted-foreground/70">{eventTypeLabel(event.type)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold tabular-nums ${isIn ? 'text-green-700' : 'text-foreground'}`}>
          {isIn ? '+' : '−'}{fmt(event.amount)}
        </p>
        {hasBalance && event.running_balance !== null && (
          <p className={`text-xs tabular-nums ${isNegBal ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
            {isNegBal ? '⚠ ' : ''}{fmt(event.running_balance)}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnchorSeparator
// ---------------------------------------------------------------------------

function AnchorSeparator({ anchorDate }: { anchorDate: string }) {
  const dateLabel = format(parseISO(anchorDate), 'd MMM', { locale: pl });
  return (
    <div className="flex items-center gap-2 py-2" data-testid="anchor-separator">
      <div className="flex-1 border-t border-dashed border-border/60" />
      <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap px-1">
        zdarzenia sprzed {dateLabel} • już uwzględnione w saldzie
      </span>
      <div className="flex-1 border-t border-dashed border-border/60" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayCard
// ---------------------------------------------------------------------------

interface DayCardProps {
  group: DayGroup;
  today: string;
  hasBalance: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
}

function DayCard({ group, today, hasBalance, cardRef }: DayCardProps) {
  const d = parseISO(group.date);
  const isToday = group.date === today;
  const isPast = group.date < today;
  const hasNegative = hasBalance && group.events.some(e => e.running_balance !== null && e.running_balance < 0);
  const net = dayNet(group.events);

  return (
    <div
      id={`day-${group.date}`}
      ref={cardRef}
      className={`rounded-lg border ${hasNegative ? 'border-red-300 bg-red-50/30' : isToday ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}
    >
      <div className={`flex items-center justify-between px-4 py-2 border-b ${hasNegative ? 'border-red-200' : 'border-border/50'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold tabular-nums ${isToday ? 'text-primary' : isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
            {format(d, 'd MMM', { locale: pl })}
          </span>
          <span className="text-xs text-muted-foreground capitalize">
            {format(d, 'EEEE', { locale: pl })}
          </span>
          {isToday && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              dziś
            </span>
          )}
        </div>
        <span className={`text-xs font-semibold tabular-nums ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
          {net >= 0 ? '+' : ''}{fmt(net)}
        </span>
      </div>
      <div className="px-4">
        {group.events.map((ev, i) => (
          <EventRow key={`${ev.type}-${ev.label}-${i}`} event={ev} hasBalance={hasBalance} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BalanceInfoTooltip — card ⓘ tooltip
// ---------------------------------------------------------------------------

function BalanceInfoTooltip() {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        onClick={() => setShow(v => !v)}
        aria-label="Informacje o saldzie"
      >
        <IconInfo className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border border-border bg-popover p-3 shadow-lg text-xs text-muted-foreground"
          onClick={e => e.stopPropagation()}
        >
          Prognoza salda na każdy dzień miesiąca — na podstawie faktur sprzedażowych, sprzedaży gotówkowej, kosztów stałych, faktur dostawców i obowiązków podatkowych. Saldo bankowe (opcjonalne) to punkt startowy — bez niego harmonogram pokazuje przepływy względem zera.
          <button
            type="button"
            className="mt-2 block text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
            onClick={() => setShow(false)}
          >
            Zamknij
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CashFlowChart
// ---------------------------------------------------------------------------

interface ChartDay {
  label: string;       // "1", "2" … "31"
  net: number;         // daily net (positive = in, negative = out)
  balance: number | null; // closing balance if has_balance
}

interface CashFlowChartProps {
  month: string;
  groups: DayGroup[];
  hasBalance: boolean;
}

function CashFlowChart({ month, groups, hasBalance }: CashFlowChartProps) {
  const firstDay = parseISO(`${month}-01`);
  const totalDays = getDaysInMonth(firstDay);
  const byDate = new Map<string, DayGroup>(groups.map(g => [g.date, g]));

  const chartData: ChartDay[] = Array.from({ length: totalDays }, (_, i) => {
    const day = i + 1;
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const group = byDate.get(dateStr);
    const net = group ? dayNet(group.events) : 0;
    const lastEv = group ? group.events[group.events.length - 1] : null;
    const balance = hasBalance && lastEv?.running_balance != null ? lastEv.running_balance : null;
    return { label: String(day), net, balance };
  });

  // Only render days that have events (or all if balance, for the line)
  const activeDays = hasBalance ? chartData : chartData.filter(d => d.net !== 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const net = payload.find((p: any) => p.dataKey === 'net')?.value ?? 0;
    const balance = payload.find((p: any) => p.dataKey === 'balance')?.value;
    return (
      <div className="rounded-lg border border-border bg-popover p-2.5 shadow-lg text-xs">
        <p className="font-semibold mb-1">{label} {format(parseISO(`${month}-01`), 'MMM', { locale: pl })}</p>
        <div className={`flex justify-between gap-4 ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
          <span>Zmiana</span>
          <span className="font-semibold tabular-nums">{net >= 0 ? '+' : ''}{fmt(net)}</span>
        </div>
        {balance != null && (
          <div className={`flex justify-between gap-4 mt-0.5 ${balance < 0 ? 'text-red-600' : 'text-foreground'}`}>
            <span>Saldo</span>
            <span className="font-semibold tabular-nums">{fmt(balance)}</span>
          </div>
        )}
      </div>
    );
  };

  if (activeDays.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Brak danych do wykresu w tym miesiącu.
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-lg border border-border bg-card p-4">
      <p className="mb-1 text-xs font-medium text-foreground">Dzienna zmiana przepływów</p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Każdy słupek = jeden dzień. <span className="text-green-700 font-medium">Zielony</span> — dzień zakończył się na plusie (więcej wpłynęło niż wyszło). <span className="text-red-600 font-medium">Czerwony</span> — dzień na minusie.{hasBalance ? ' Linia pokazuje stan konta po każdym dniu.' : ''}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground, #6b7280)' }}
            tickLine={false}
            axisLine={false}
            interval={6}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground, #6b7280)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmtShort(v)}
            width={45}
          />
          <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-muted, #f3f4f6)', opacity: 0.5 }} />
          <ReferenceLine y={0} stroke="var(--color-border, #e5e7eb)" strokeWidth={1} />

          {/* Daily net bars */}
          <Bar dataKey="net" name="Zmiana" radius={[2, 2, 0, 0]} maxBarSize={20} opacity={0.85}>
            {chartData.map((entry, i) => (
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              <Cell key={i} fill={entry.net >= 0 ? '#4ade80' : '#f87171'} />
            ))}
          </Bar>

          {/* Balance line — only when has_balance */}
          {hasBalance && (
            <Line
              dataKey="balance"
              name="Saldo"
              type="monotone"
              stroke="#818cf8"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-green-300 opacity-85" />Dzień na plusie</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-300 opacity-85" />Dzień na minusie</span>
        {hasBalance && <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-indigo-300" />Saldo</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WaterfallChart
// ---------------------------------------------------------------------------

interface WaterfallEntry {
  name: string;
  invisible: number;   // transparent offset bar
  positive: number;    // green bar (income)
  negative: number;    // red bar (cost, stored as positive, drawn downward)
  isTotal?: boolean;   // opening / closing totals
  rawNet: number;
  balance: number;
}

interface WaterfallChartProps {
  month: string;
  groups: DayGroup[];
  hasBalance: boolean;
  openingBalance: number;
}

function WaterfallChart({ month, groups, hasBalance, openingBalance }: WaterfallChartProps) {
  const monthLabel = format(parseISO(`${month}-01`), 'MMM', { locale: pl });

  // Build steps: only days with events
  const steps: WaterfallEntry[] = [];
  let running = openingBalance;

  // Opening bar (only when has_balance)
  if (hasBalance) {
    steps.push({
      name: 'Start',
      invisible: 0,
      positive: openingBalance >= 0 ? openingBalance : 0,
      negative: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      isTotal: true,
      rawNet: 0,
      balance: openingBalance,
    });
  }

  for (const g of groups) {
    const net = dayNet(g.events);
    if (net === 0) continue;
    const day = parseInt(g.date.slice(8), 10);
    const prev = running;
    running += net;

    let invisible: number;
    let positive: number;
    let negative: number;

    if (net > 0) {
      invisible = prev;
      positive = net;
      negative = 0;
    } else {
      invisible = running; // bottom of the red bar
      positive = 0;
      negative = Math.abs(net);
    }

    steps.push({
      name: `${day} ${monthLabel}`,
      invisible,
      positive,
      negative,
      rawNet: net,
      balance: running,
    });
  }

  // Closing total
  steps.push({
    name: 'Koniec',
    invisible: 0,
    positive: running >= 0 ? running : 0,
    negative: running < 0 ? Math.abs(running) : 0,
    isTotal: true,
    rawNet: 0,
    balance: running,
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const entry = steps.find(s => s.name === label);
    if (!entry) return null;
    return (
      <div className="rounded-lg border border-border bg-popover p-2.5 shadow-lg text-xs">
        <p className="font-semibold mb-1">{label}</p>
        {entry.isTotal ? (
          <div className={`flex justify-between gap-4 font-bold ${entry.balance < 0 ? 'text-red-600' : 'text-foreground'}`}>
            <span>Saldo</span>
            <span className="tabular-nums">{fmt(entry.balance)}</span>
          </div>
        ) : (
          <>
            <div className={`flex justify-between gap-4 ${entry.rawNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              <span>Zmiana</span>
              <span className="font-semibold tabular-nums">{entry.rawNet >= 0 ? '+' : ''}{fmt(entry.rawNet)}</span>
            </div>
            <div className={`flex justify-between gap-4 mt-0.5 ${entry.balance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              <span>{hasBalance ? 'Saldo po' : 'Łącznie'}</span>
              <span className="tabular-nums">{fmt(entry.balance)}</span>
            </div>
          </>
        )}
      </div>
    );
  };

  if (steps.length <= (hasBalance ? 2 : 1)) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Brak danych do wykresu w tym miesiącu.
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-lg border border-border bg-card p-4">
      <p className="mb-1 text-xs font-medium text-foreground">Jak buduje się wynik miesiąca</p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Każdy krok to dzień, w którym coś się działo. <span className="text-green-700 font-medium">Zielony blok</span> unosi się w górę — wpłynęły pieniądze. <span className="text-red-600 font-medium">Czerwony</span> opada w dół — wyszły koszty. Na końcu widać gdzie skończył miesiąc.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={steps} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: 'var(--color-muted-foreground, #6b7280)' }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-muted-foreground, #6b7280)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmtShort(v)}
            width={45}
          />
          <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-muted, #f3f4f6)', opacity: 0.5 }} />
          <ReferenceLine y={0} stroke="#e5e7eb" strokeWidth={1} />

          {/* Invisible offset bar */}
          <Bar dataKey="invisible" stackId="wf" fill="transparent" legendType="none" />
          {/* Positive (green) bar */}
          <Bar dataKey="positive" stackId="wf" fill="#4ade80" radius={[2, 2, 0, 0]} maxBarSize={28} />
          {/* Negative (red) bar — drawn on top of invisible offset */}
          <Bar dataKey="negative" stackId="wf" fill="#f87171" radius={[2, 2, 0, 0]} maxBarSize={28} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-green-300 opacity-85" />Wpływ</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-red-300 opacity-85" />Koszt</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function HarmonogramPage() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'calendar' | 'chart' | 'waterfall'>('calendar');

  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useHarmonogramQuery(currentMonth);
  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = format(parseISO(`${currentMonth}-01`), 'LLLL yyyy', { locale: pl });

  // Refs map for each DayCard — used to scroll on calendar click
  const dayCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setCardRef = useCallback((date: string) => (el: HTMLDivElement | null) => {
    if (el) dayCardRefs.current.set(date, el);
    else dayCardRefs.current.delete(date);
  }, []);

  function scrollToDay(date: string) {
    const el = dayCardRefs.current.get(date);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.outline = '2px solid var(--color-primary, #6366f1)';
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 1200);
    }
  }

  function prevMonth() {
    setCurrentMonth(m => format(subMonths(parseISO(`${m}-01`), 1), 'yyyy-MM'));
  }
  function nextMonth() {
    setCurrentMonth(m => format(addMonths(parseISO(`${m}-01`), 1), 'yyyy-MM'));
  }

  function handleBalanceModalClose() {
    setShowBalanceModal(false);
    const companyId = user?.current_company ?? '';
    queryClient.invalidateQueries({ queryKey: cashFlowKeys.harmonogram(companyId) });
  }

  const groups = data ? groupByDay(data.events) : [];
  const hasNegativeBalance = data && data.min_balance < 0;

  // Anchor separator: find last group index where all events are before_anchor
  const anchorInMonth = Boolean(
    data?.anchor_date &&
    data.anchor_date >= `${currentMonth}-01` &&
    data.anchor_date <= `${currentMonth}-31`
  );
  const lastBeforeAnchorIdx = anchorInMonth
    ? groups.reduce((acc, g, i) => g.events.every(e => e.before_anchor) ? i : acc, -1)
    : -1;

  // Saldo card helpers
  const anchorDateLabel = data?.anchor_date
    ? format(parseISO(data.anchor_date), 'd MMM', { locale: pl })
    : null;
  const daysAgo = data?.balance_updated_at
    ? differenceInCalendarDays(new Date(), parseISO(data.balance_updated_at))
    : null;
  const daysAgoText =
    daysAgo === 0 ? 'dziś' :
    daysAgo === 1 ? 'wczoraj' :
    daysAgo != null ? `${daysAgo} dni temu` : null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-4">
      {/* Back + title */}
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/cash-flow"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="h-4 w-4" />
          Saldo i Podatki
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-semibold tracking-tight">Harmonogram płatności</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        Co wpłynie i co trzeba zapłacić — dzień po dniu.
      </p>

      <PageExplainer
        summary="Jak są liczone te kwoty?"
        items={[
          {
            icon: '📅',
            label: 'Data = kiedy pieniądze realnie się ruszają.',
            description: 'Faktura od dostawcy wystawiona w lipcu z terminem 10 sierpnia → pojawi się w sierpniu. Faktura sprzedażowa z terminem 20 września → pojawi się we wrześniu.',
          },
          {
            icon: '🟢',
            label: 'Przychody B2B',
            description: 'Opłacone faktury — wg daty wpłynięcia. Nieopłacone — wg terminu płatności, nawet jeśli faktura pochodzi z poprzedniego miesiąca.',
          },
          {
            icon: '💵',
            label: 'Sprzedaż gotówkowa (B2C)',
            description: 'Wpisy ze sprzedaży gotówkowej — wg daty wpisu.',
          },
          {
            icon: '🔴',
            label: 'Koszty',
            description: 'Koszty stałe (czynsz, leasing) wg dnia miesiąca. Faktury dostawców wg terminu płatności. Wydatki gotówkowe wg daty zakupu. ZUS i VAT wg ustawowego terminu.',
          },
          {
            icon: '💰',
            label: 'Saldo (opcjonalne)',
            description: 'Jeśli podasz stan konta, harmonogram pokaże ile realnie będziesz mieć w każdym dniu. Bez salda widać tylko kierunek przepływów.',
          },
        ]}
        example="Sierpień: faktury kosztowe wystawione w sierpniu z terminem we wrześniu NIE pomniejszają salda sierpniowego — pojawią się w harmonogramie we wrześniu. Dlatego wynik tutaj różni się od Saldo i Podatki, które liczy koszty wg daty wystawienia."
        exampleLabel="Dlaczego wynik różni się od zakładki Przegląd?"
      />

      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-md p-1.5 hover:bg-muted">
          <IconChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-base font-semibold capitalize">{monthLabel}</span>
        <button onClick={nextMonth} className="rounded-md p-1.5 hover:bg-muted">
          <IconChevronRight className="h-5 w-5" />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Ładowanie…
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Nie udało się załadować harmonogramu.
        </div>
      )}

      {data && (
        <>
          {/* Summary cards — 2×2 grid */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            {/* Wpływa card */}
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Wpływa</p>
              <p className="mt-1 text-base font-bold tabular-nums text-green-700">+{fmt(data.total_in)}</p>
              {data.expected_in > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">{fmt(data.confirmed_in)} pewne + {fmt(data.expected_in)} oczekuje</p>
              )}
            </div>

            {/* Koszty card */}
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Koszty</p>
              <p className="mt-1 text-base font-bold tabular-nums text-red-600">−{fmt(data.total_out)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                ZUS, VAT, koszty stałe, faktury
              </p>
            </div>

            {/* Saldo card — 3 states */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {data.has_balance && anchorDateLabel
                    ? `Saldo na ${anchorDateLabel}`
                    : data.has_balance
                      ? 'Saldo startowe'
                      : 'Saldo'}
                </p>
                <BalanceInfoTooltip />
              </div>
              <p className="mt-1 text-base font-bold tabular-nums text-foreground">
                {data.has_balance ? fmt(data.opening_balance) : '—'}
              </p>
              {data.has_balance && data.vat_balance > 0 && (
                <p className="mt-0.5 text-[10px] text-amber-600 font-medium" title="Środki zablokowane na rachunku VAT (split payment) — nie możesz ich swobodnie używać">
                  🔒 {fmt(data.vat_balance)} VAT
                </p>
              )}
              {data.has_balance && daysAgoText && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  zaktualizowane {daysAgoText}
                </p>
              )}
              {!data.has_balance && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  opcjonalne — dodaj dla kwot bezwzgl.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowBalanceModal(true)}
                className="mt-2 text-[10px] font-medium text-primary hover:underline"
                data-testid={data.has_balance ? 'update-balance-btn' : 'add-balance-btn'}
              >
                {data.has_balance ? 'Zaktualizuj' : 'Dodaj'}
              </button>
            </div>

            {/* Przepływ netto / Saldo końca card */}
            <div className={`rounded-lg border p-3 ${hasNegativeBalance ? 'border-red-300 bg-red-50' : 'border-border bg-card'}`}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {data.has_balance ? 'Saldo końca' : 'Przepływ netto'}
              </p>
              <p className={`mt-1 text-base font-bold tabular-nums ${hasNegativeBalance ? 'text-red-600' : data.closing_balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {data.closing_balance >= 0 ? '+' : ''}{fmt(data.closing_balance)}
              </p>
              {!data.has_balance && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">wpływy minus koszty w tym miesiącu</p>
              )}
              {hasNegativeBalance && data.has_balance && data.min_balance_date && (
                <p className="mt-1 text-[10px] font-medium text-red-600">
                  Min: {fmt(data.min_balance)} ({format(parseISO(data.min_balance_date), 'd MMM', { locale: pl })})
                </p>
              )}
            </div>
          </div>

          {/* Negative balance warning */}
          {hasNegativeBalance && data.has_balance && (
            <div className="mb-4 flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
              <IconTrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="text-sm">
                <p className="font-semibold text-red-700">Uwaga: saldo może być ujemne</p>
                <p className="mt-0.5 text-red-600">
                  Najniższe saldo w tym miesiącu: <strong>{fmt(data.min_balance)}</strong>
                  {data.min_balance_date && ` (${format(parseISO(data.min_balance_date), 'd MMMM', { locale: pl })})`}.
                  Sprawdź, czy oczekiwane przychody wpłyną na czas.
                </p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="mb-3 flex gap-1 rounded-lg border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${activeTab === 'calendar' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Kalendarz
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chart')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${activeTab === 'chart' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Zmiany
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('waterfall')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${activeTab === 'waterfall' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Narastająco
            </button>
          </div>

          {/* Calendar view */}
          {activeTab === 'calendar' && (
            <>
              <CalendarGrid
                month={currentMonth}
                groups={groups}
                today={today}
                hasBalance={data.has_balance}
                anchorDate={data.anchor_date}
                onDayClick={scrollToDay}
              />
              <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />Wpłynęło / opłacone</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" />Oczekiwane przychody</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />Planowane wydatki</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Po terminie</span>
              </div>
            </>
          )}

          {/* Bar chart view */}
          {activeTab === 'chart' && (
            <CashFlowChart
              month={currentMonth}
              groups={groups}
              hasBalance={data.has_balance}
            />
          )}

          {/* Waterfall view */}
          {activeTab === 'waterfall' && (
            <WaterfallChart
              month={currentMonth}
              groups={groups}
              hasBalance={data.has_balance}
              openingBalance={data.opening_balance}
            />
          )}

          {/* Day-by-day list */}
          {groups.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Brak zaplanowanych płatności w tym miesiącu.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g, i) => (
                <Fragment key={g.date}>
                  <DayCard
                    group={g}
                    today={today}
                    hasBalance={data.has_balance}
                    cardRef={setCardRef(g.date)}
                  />
                  {anchorInMonth && i === lastBeforeAnchorIdx && (
                    <AnchorSeparator anchorDate={data.anchor_date!} />
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </>
      )}

      {/* Balance update modal */}
      <TaxConfigSetup open={showBalanceModal} onClose={handleBalanceModalClose} />
    </div>
  );
}
