import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useOrderListQuery, useOrderProductSummaryQuery, buildOrderListApiFilters } from '@/query/use-orders';
import { formatMoneyGross } from '@/lib/order-utils';
import { ORDER_STATUS_LABELS_PL, orderStatusOptions } from '@/constants/orderStatusPl';
import {
  ReportExpandIcon,
  ReportShell,
  formatReportDate,
  reportButtonClass,
  reportLabelClass,
  reportPresetClass,
  reportRowClass,
  reportSubtitleClass,
  reportTableClass,
  reportTdClass,
  reportTdMutedClass,
  reportThClass,
  reportTitleClass,
  statusRedClass,
} from '@/lib/reportSurface';
import type { Order, OrderStatus } from '@/types';

const PAGE_SIZE = 20;

/** Trial field surface for this list only. White fill, a light lilac edge. */
const filterControlClass =
  'border-[#D4D2EE] bg-white font-normal text-slate-900 placeholder:text-slate-500 focus:border-primary focus:bg-white';
const orderNumberClass = 'text-sm font-medium text-primary hover:underline';
const orderMoneyClass = 'text-sm font-medium tabular-nums text-slate-900';

function startOfMonthIso(now = new Date()) {
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodPresets(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { label: 'Ten miesiąc', from: toIsoDate(new Date(y, m, 1)), to: toIsoDate(new Date(y, m + 1, 0)) },
    { label: 'Poprzedni', from: toIsoDate(new Date(y, m - 1, 1)), to: toIsoDate(new Date(y, m, 0)) },
    { label: 'Ten rok', from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

function plnFmt(v: string | number | null | undefined) {
  if (v == null || v === '') return '—';
  return formatMoneyGross(v);
}

function fmtQty(v: string | number, unit: string) {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  const shown = Number.isFinite(n) ? n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : String(v);
  return unit ? `${shown} ${unit}` : shown;
}

function orderCountLabel(count: number) {
  if (count === 1) return '1 zamówienie';
  const n = count % 10;
  const n100 = count % 100;
  if (n >= 2 && n <= 4 && (n100 < 10 || n100 >= 20)) return `${count} zamówienia`;
  return `${count} zamówień`;
}

function orderStatusTextClass(status: OrderStatus) {
  switch (status) {
    case 'delivered':
    case 'invoiced':
      return 'text-sm font-normal text-emerald-700';
    case 'cancelled':
      return 'text-sm font-normal text-red-600';
    case 'partially_delivered':
      return 'text-sm font-normal text-amber-700';
    default:
      return 'text-sm font-normal text-slate-600';
  }
}

const docMissingClass = 'text-sm text-slate-400';

function docLinkClass(number: string, kind: 'delivery' | 'invoice') {
  const tone =
    kind === 'invoice' ? 'text-sky-700' : number.startsWith('ZW/') ? 'text-amber-700' : 'text-emerald-700';
  return `text-sm font-normal ${tone} hover:underline`;
}

type WzDoc = { id: string; number: string; corrections?: { id: string; number: string }[] };
type InvoiceDoc = { id: string; number: string; has_correction?: boolean };

function DocumentLinks({
  docs,
  href,
  kind,
}: {
  docs: WzDoc[] | InvoiceDoc[] | undefined;
  href: (id: string) => string;
  kind: 'delivery' | 'invoice';
}) {
  if (!docs?.length) return <span className={docMissingClass}>—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {(docs as WzDoc[]).map((doc) => (
        <span key={doc.id} className="flex flex-col gap-0">
          <Link
            to={href(doc.id)}
            className={docLinkClass(doc.number, kind)}
            onClick={(event) => event.stopPropagation()}
          >
            {doc.number}
          </Link>
          {doc.corrections?.map((kor) => (
            <Link
              key={kor.id}
              to={`/delivery/${kor.id}`}
              className="text-sm font-normal text-purple-600 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {kor.number}
            </Link>
          ))}
        </span>
      ))}
    </span>
  );
}

function MobileDocLine({
  label,
  docs,
  href,
  kind,
}: {
  label: string;
  docs: WzDoc[] | InvoiceDoc[] | undefined;
  href: (id: string) => string;
  kind: 'delivery' | 'invoice';
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      {(docs as WzDoc[])?.length ? (
        (docs as WzDoc[]).map((doc) => (
          <span key={doc.id} className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
            <Link
              to={href(doc.id)}
              className={docLinkClass(doc.number, kind)}
              onClick={(event) => event.stopPropagation()}
            >
              {doc.number}
            </Link>
            {doc.corrections?.map((kor) => (
              <Link
                key={kor.id}
                to={`/delivery/${kor.id}`}
                className="text-sm font-normal text-purple-600 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {kor.number}
              </Link>
            ))}
          </span>
        ))
      ) : (
        <span className={docMissingClass}>—</span>
      )}
    </p>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function SelectChevron() {
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function AccordionChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M8 6h12M8 12h12M8 18h12" strokeLinecap="round" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" strokeWidth={2.4} />
    </svg>
  );
}

function OrderItems({ order, compact = false }: { order: Order; compact?: boolean }) {
  if (!order.items?.length) {
    return <p className="px-3 py-2 text-sm text-slate-500">Brak pozycji na tym zamówieniu.</p>;
  }
  return (
    <ul
      className={cn(
        'grid items-baseline gap-x-6 gap-y-2 border-l border-[#D4D2EE] pl-3 text-sm',
        compact
          ? 'w-max max-w-full grid-cols-[fit-content(22rem)_max-content_max-content]'
          : 'w-full grid-cols-[minmax(0,1fr)_max-content_max-content]',
      )}
      aria-label={`Pozycje zamówienia ${order.order_number ?? ''}`}
    >
      <li className="col-span-3 grid grid-cols-subgrid text-xs font-normal text-slate-500">
        <span>produkt</span>
        <span className="min-w-16 text-right">ilość</span>
        <span className="min-w-[4.75rem] text-right">brutto</span>
      </li>
      {order.items.map((item) => (
        <li key={item.id} className="col-span-3 grid grid-cols-subgrid items-baseline">
          <span className={cn('font-normal text-slate-600', compact ? 'min-w-56' : 'min-w-0')}>{item.product_name}</span>
          <span className="min-w-16 text-right font-normal tabular-nums text-slate-500">
            {fmtQty(item.quantity, item.product_unit)}
          </span>
          <span className={cn('min-w-[4.75rem] text-right', orderMoneyClass)}>{plnFmt(item.line_total_gross)}</span>
        </li>
      ))}
    </ul>
  );
}

export function OrderListPage() {
  const navigate = useNavigate();
  const defaultDateFrom = startOfMonthIso();
  const presets = periodPresets();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const filters = buildOrderListApiFilters(search, status, dateFrom, dateTo);
  const apiParams = { ...filters, ordering: '-delivery_date' as const };

  const { data, isLoading, isError } = useOrderListQuery(page, apiParams);
  const { data: summary, isLoading: summaryLoading } = useOrderProductSummaryQuery(apiParams, summaryOpen);

  const orders = data?.results ?? [];
  const count = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasResults = !isLoading && !isError && orders.length > 0;
  const filtersDirty = Boolean(search || status || dateTo || dateFrom !== defaultDateFrom);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPreset(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setDateFrom(startOfMonthIso());
    setDateTo('');
    setPage(1);
  }

  return (
    <ReportShell>
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
          aria-label="Wróć"
        >
          <BackIcon />
        </button>
        <div className="min-w-0">
          <h1 className={reportTitleClass}>Lista zamówień</h1>
          <p className={reportSubtitleClass}>
            {isLoading && !data ? 'Ładowanie…' : data ? orderCountLabel(count) : 'Zamówienia z wybranego okresu'}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 md:rounded-3xl md:px-5">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Okres">
          {presets.map((preset) => {
            const active = dateFrom === preset.from && dateTo === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.from, preset.to)}
                className={cn(
                  reportPresetClass,
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
                aria-pressed={active}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full sm:w-auto">
            <span className={reportLabelClass}>Od</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              aria-label="Data dostawy od"
              className={cn('date-pill w-full sm:w-52', filterControlClass)}
            />
          </label>
          <label className="block w-full sm:w-auto">
            <span className={reportLabelClass}>Do</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              aria-label="Data dostawy do"
              className={cn('date-pill w-full sm:w-52', filterControlClass)}
            />
          </label>
          <label className="block w-full sm:w-56">
            <span className={reportLabelClass}>Status</span>
            <div className="relative">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as '' | OrderStatus);
                  setPage(1);
                }}
                aria-label="Status zamówienia"
                className={cn('select-pill w-full', filterControlClass)}
              >
                <option value="">Wszystkie statusy</option>
                {orderStatusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Szukaj po kliencie lub numerze…"
              aria-label="Szukaj po kliencie lub numerze"
              className={cn('field-ios w-full pl-9', filterControlClass)}
            />
          </div>
          {filtersDirty && (
            <button type="button" onClick={clearFilters} className={reportButtonClass}>
              Wyczyść filtry
            </button>
          )}
        </div>
      </section>

      {isLoading && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 md:rounded-3xl">
          Ładowanie…
        </p>
      )}

      {isError && (
        <p className={cn('rounded-2xl border px-4 py-3 text-sm text-red-700', statusRedClass)} role="alert">
          Nie udało się wczytać zamówień.
        </p>
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 md:rounded-3xl">
          Brak zamówień spełniających kryteria.
        </p>
      )}

      {hasResults && (
        <div className="flex flex-col gap-2 md:hidden">
          {orders.map((order) => {
            const open = expandedIds.has(order.id);
            return (
              <div key={order.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div
                  className={cn('flex cursor-pointer items-start gap-1 px-2 py-3', open && 'bg-slate-50')}
                  onClick={() => toggleExpanded(order.id)}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(order.id);
                    }}
                    aria-expanded={open}
                    aria-label={open ? 'Zwiń pozycje' : 'Pokaż pozycje'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500"
                  >
                    <ReportExpandIcon open={open} />
                  </button>
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        to={`/orders/${order.id}`}
                        className={orderNumberClass}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {order.order_number || 'Bez numeru'}
                      </Link>
                      <span className={cn('shrink-0', orderStatusTextClass(order.status))}>
                        {ORDER_STATUS_LABELS_PL[order.status]}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-normal text-slate-600">{order.customer_name || '—'}</p>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-sm font-normal text-slate-500">{formatReportDate(order.delivery_date)}</p>
                        <div className="mt-1 flex flex-col gap-0.5">
                          <MobileDocLine label="WZ" docs={order.wz_numbers} href={(id) => `/delivery/${id}`} kind="delivery" />
                          <MobileDocLine label="Faktura" docs={order.invoice_numbers} href={(id) => `/invoices/${id}`} kind="invoice" />
                        </div>
                      </div>
                      <p className={cn('shrink-0', orderMoneyClass)}>{plnFmt(order.total_gross)}</p>
                    </div>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-slate-100 px-3 py-3 pl-11">
                    <OrderItems order={order} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasResults && (
        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block md:rounded-3xl">
          <div className="overflow-x-auto">
            <table className={cn(reportTableClass, 'min-w-full')} aria-label="Lista zamówień">
              <thead>
                <tr>
                  <th scope="col" className="w-8 border-b border-slate-200 bg-white px-2 py-3" />
                  <th scope="col" className={reportThClass}>Numer</th>
                  <th scope="col" className={reportThClass}>Klient</th>
                  <th scope="col" className={reportThClass}>Data dostawy</th>
                  <th scope="col" className={cn(reportThClass, 'text-right')}>Brutto</th>
                  <th scope="col" className={reportThClass}>Status</th>
                  <th scope="col" className={reportThClass}>WZ</th>
                  <th scope="col" className={reportThClass}>Faktura</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const open = expandedIds.has(order.id);
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={cn(reportRowClass, 'cursor-pointer', open && 'bg-slate-50')}
                        onClick={() => toggleExpanded(order.id)}
                      >
                        <td className="w-8 px-2 py-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(order.id);
                            }}
                            aria-expanded={open}
                            aria-label={open ? 'Zwiń pozycje' : 'Pokaż pozycje'}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <ReportExpandIcon open={open} />
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Link
                            to={`/orders/${order.id}`}
                            className={orderNumberClass}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {order.order_number || 'Bez numeru'}
                          </Link>
                        </td>
                        <td className={cn(reportTdClass, 'max-w-[240px] truncate')}>{order.customer_name || '—'}</td>
                        <td className={reportTdMutedClass}>{formatReportDate(order.delivery_date)}</td>
                        <td className={cn('whitespace-nowrap px-3 py-3 text-right', orderMoneyClass)}>{plnFmt(order.total_gross)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={orderStatusTextClass(order.status)}>{ORDER_STATUS_LABELS_PL[order.status]}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <DocumentLinks docs={order.wz_numbers} href={(id) => `/delivery/${id}`} kind="delivery" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <DocumentLinks docs={order.invoice_numbers} href={(id) => `/invoices/${id}`} kind="invoice" />
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={8} className="border-b border-slate-100 px-3 py-3 pl-14">
                            <OrderItems order={order} compact />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasResults && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
            <div>
              <p className="text-sm text-slate-500">Suma brutto</p>
              {totalPages > 1 && (
                <p className="text-xs text-slate-500">Wszystkie zamówienia z filtra, nie tylko ta strona</p>
              )}
            </div>
            <p className={orderMoneyClass}>{plnFmt(data?.total_gross_sum)}</p>
          </div>
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-expanded={summaryOpen}
            className="flex w-full items-center justify-between gap-3 border-t border-slate-200 px-4 py-3.5 text-left hover:bg-slate-50/60 md:px-5"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                <ListIcon />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Zestawienie produktów</p>
                <p className="text-xs text-slate-500">Suma ilości i wartości dla bieżących filtrów</p>
              </div>
            </div>
            <AccordionChevron open={summaryOpen} />
          </button>
          {summaryOpen && (
            <div className="border-t border-slate-200">
              {summaryLoading && (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Ładowanie…</p>
              )}
              {!summaryLoading && summary && summary.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Brak danych.</p>
              )}
              {!summaryLoading && summary && summary.length > 0 && (
                <div className="overflow-x-auto">
                  <table className={cn(reportTableClass, 'min-w-full')} aria-label="Zestawienie produktów">
                    <thead>
                      <tr>
                        <th scope="col" className={reportThClass}>Produkt</th>
                        <th scope="col" className={cn(reportThClass, 'text-right')}>Ilość</th>
                        <th scope="col" className={cn(reportThClass, 'text-right')}>Wartość brutto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row) => (
                        <tr key={row.product_name} className={reportRowClass}>
                          <td className={reportTdClass}>{row.product_name}</td>
                          <td className={cn(reportTdMutedClass, 'text-right')}>{fmtQty(row.total_quantity, row.unit)}</td>
                          <td className={cn('whitespace-nowrap px-3 py-3 text-right', orderMoneyClass)}>{plnFmt(row.total_gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center" aria-label="Paginacja">
          <p className="text-center text-sm text-slate-500 sm:text-left">
            Strona <span className="font-semibold tabular-nums text-slate-900">{page}</span> z{' '}
            <span className="font-semibold tabular-nums text-slate-900">{totalPages}</span>
          </p>
          <div className="flex justify-center gap-2 sm:justify-end">
            <button
              type="button"
              className={cn(reportButtonClass, 'disabled:cursor-not-allowed disabled:opacity-50')}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Poprzednia
            </button>
            <button
              type="button"
              className={cn(reportButtonClass, 'disabled:cursor-not-allowed disabled:opacity-50')}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Następna
            </button>
          </div>
        </nav>
      )}
    </ReportShell>
  );
}
