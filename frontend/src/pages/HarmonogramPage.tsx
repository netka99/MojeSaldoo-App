import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { format, addMonths, subMonths, parseISO, getDaysInMonth, getDay, startOfMonth } from 'date-fns';
import { pl } from 'date-fns/locale';

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

import { useHarmonogramQuery } from '@/query/use-cashflow';
import type { HarmonogramEvent } from '@/types/cashflow.types';

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
  onDayClick: (date: string) => void;
}

function CalendarGrid({ month, groups, today, onDayClick }: CalendarGridProps) {
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
          const closingBalance = group ? group.events[group.events.length - 1].running_balance : null;
          const isToday = dateStr === today;
          const isPast = dateStr < today;
          const hasNeg = group?.events.some(e => e.running_balance < 0) ?? false;
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

                {/* Closing balance */}
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
                  className={`absolute z-20 w-52 rounded-lg border border-border bg-popover p-3 shadow-lg text-xs ${
                    colIdx >= 4 ? 'right-0' : 'left-0'
                  } ${isLastRow ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                  style={{ pointerEvents: 'none' }}
                >
                  <p className="mb-2 font-semibold text-foreground capitalize">
                    {format(parseISO(dateStr), 'd MMMM', { locale: pl })}
                    <span className={`ml-2 font-bold ${net! >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {net! >= 0 ? '+' : ''}{fmt(net!)}
                    </span>
                  </p>
                  <div className="space-y-1.5">
                    {group.events.map((ev, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(ev.status, ev.direction)}`} />
                        <span className="flex-1 truncate text-muted-foreground">{ev.label}</span>
                        <span className={`shrink-0 font-semibold tabular-nums ${ev.direction === 'in' ? 'text-green-700' : 'text-foreground'}`}>
                          {ev.direction === 'in' ? '+' : '−'}{fmt(ev.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className={`mt-2 border-t border-border/50 pt-2 flex justify-between text-[10px] ${closingBalance! < 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                    <span>Stan na koniec dnia</span>
                    <span className="tabular-nums font-semibold">{fmt(closingBalance!)}</span>
                  </div>
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

function EventRow({ event }: { event: HarmonogramEvent }) {
  const isIn = event.direction === 'in';
  const isNegBal = event.running_balance < 0;

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 ${isNegBal ? 'bg-red-50/50' : ''}`}>
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${statusDot(event.status, event.direction)}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{event.label}</p>
        {event.sublabel && (
          <p className="truncate text-xs text-muted-foreground">{event.sublabel}</p>
        )}
        <p className="text-xs text-muted-foreground/70">{eventTypeLabel(event.type)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold tabular-nums ${isIn ? 'text-green-700' : 'text-foreground'}`}>
          {isIn ? '+' : '−'}{fmt(event.amount)}
        </p>
        <p className={`text-xs tabular-nums ${isNegBal ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
          {isNegBal ? '⚠ ' : ''}{fmt(event.running_balance)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayCard
// ---------------------------------------------------------------------------

interface DayCardProps {
  group: DayGroup;
  today: string;
  cardRef: (el: HTMLDivElement | null) => void;
}

function DayCard({ group, today, cardRef }: DayCardProps) {
  const d = parseISO(group.date);
  const isToday = group.date === today;
  const isPast = group.date < today;
  const hasNegative = group.events.some(e => e.running_balance < 0);
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
          <EventRow key={`${ev.type}-${ev.label}-${i}`} event={ev} />
        ))}
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
      // Brief highlight pulse
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

  const groups = data ? groupByDay(data.events) : [];
  const hasNegativeBalance = data && data.min_balance < 0;

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
      <p className="mb-5 text-sm text-muted-foreground">
        Co wpłynie i co trzeba zapłacić — dzień po dniu.
      </p>

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
          {/* Summary cards */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo otwarcia</p>
              <p className="mt-1 text-base font-bold tabular-nums text-foreground">{fmt(data.opening_balance)}</p>
              {!data.has_balance && (
                <p className="mt-1 text-[10px] text-muted-foreground">Uzupełnij saldo konta w ustawieniach</p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Wpływa</p>
              <p className="mt-1 text-base font-bold tabular-nums text-green-700">+{fmt(data.total_in)}</p>
              {data.expected_in > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">{fmt(data.confirmed_in)} pewne + {fmt(data.expected_in)} oczekuje</p>
              )}
            </div>
            <div className={`rounded-lg border p-3 ${hasNegativeBalance ? 'border-red-300 bg-red-50' : 'border-border bg-card'}`}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo końca</p>
              <p className={`mt-1 text-base font-bold tabular-nums ${hasNegativeBalance ? 'text-red-600' : 'text-foreground'}`}>
                {fmt(data.closing_balance)}
              </p>
              {hasNegativeBalance && data.min_balance_date && (
                <p className="mt-1 text-[10px] font-medium text-red-600">
                  Min: {fmt(data.min_balance)} ({format(parseISO(data.min_balance_date), 'd MMM', { locale: pl })})
                </p>
              )}
            </div>
          </div>

          {/* Negative balance warning */}
          {hasNegativeBalance && (
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

          {/* No balance info */}
          {!data.has_balance && (
            <div className="mb-4 flex gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <IconInfo className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Dodaj stan konta w{' '}
                <Link to="/cash-flow" className="font-medium text-foreground underline underline-offset-2">
                  Saldo i Podatki → Ustawienia podatkowe
                </Link>
                , żeby zobaczyć realny harmonogram przepływów.
              </p>
            </div>
          )}

          {/* Calendar grid */}
          <CalendarGrid
            month={currentMonth}
            groups={groups}
            today={today}
            onDayClick={scrollToDay}
          />

          {/* Legend */}
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />Wpłynęło / opłacone</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" />Oczekiwane przychody</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />Planowane wydatki</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Po terminie</span>
          </div>

          {/* Day-by-day list */}
          {groups.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Brak zaplanowanych płatności w tym miesiącu.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(g => (
                <DayCard
                  key={g.date}
                  group={g}
                  today={today}
                  cardRef={setCardRef(g.date)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
