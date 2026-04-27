import { type FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useGenerateInvoiceFromOrderMutation } from '@/query/use-invoices';
import { useOrderListQuery, useOrderQuery, type OrderListFilters } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { InvoicePaymentMethod } from '@/types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatDisplayDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

const PAYMENT_OPTIONS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Przelew' },
  { value: 'cash', label: 'Gotówka' },
  { value: 'card', label: 'Karta' },
];

export function InvoiceCreatePage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoiceCreatePageContent />;
}

function InvoiceCreatePageContent() {
  const navigate = useNavigate();

  const [listPage, setListPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');

  const [issueDate, setIssueDate] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('transfer');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const h = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setListPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(h);
  }, [searchInput]);

  const listFilters: OrderListFilters = {
    without_invoice: true,
    ordering: '-delivery_date',
    ...(search ? { search } : {}),
  };

  const { data: listData, isFetching: listLoading, isError: listError, error: listErr } =
    useOrderListQuery(listPage, listFilters);
  const orders = listData?.results ?? [];
  const count = listData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const { data: orderDetail, isFetching: detailLoading } = useOrderQuery(
    selectedOrderId || undefined,
    Boolean(selectedOrderId),
  );

  useEffect(() => {
    if (!orderDetail || orderDetail.id !== selectedOrderId) return;
    const issue = todayLocalISO();
    const sale = orderDetail.delivery_date.slice(0, 10);
    const termsRaw = orderDetail.customer_payment_terms;
    const terms =
      typeof termsRaw === 'number' && Number.isFinite(termsRaw) ? termsRaw : 14;
    setIssueDate(issue);
    setSaleDate(sale);
    setDueDate(addDaysIso(issue, terms));
    setPaymentMethod('transfer');
    setFormError(null);
  }, [orderDetail, selectedOrderId]);

  const generate = useGenerateInvoiceFromOrderMutation();

  const formReady =
    Boolean(selectedOrderId) &&
    Boolean(orderDetail && orderDetail.id === selectedOrderId) &&
    Boolean(issueDate && saleDate && dueDate);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedOrderId) {
      setFormError('Wybierz zamówienie.');
      return;
    }
    generate.mutate(
      {
        orderId: selectedOrderId,
        body: {
          issue_date: issueDate,
          sale_date: saleDate,
          due_date: dueDate,
          payment_method: paymentMethod,
        },
      },
      {
        onSuccess: (inv) => navigate(`/invoices/${inv.id}`),
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Nie udało się utworzyć faktury';
          setFormError(msg);
        },
      },
    );
  };

  const listErrMsg =
    listError && listErr instanceof Error ? listErr.message : 'Nie udało się załadować zamówień';

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Nowa faktura z zamówienia</h1>
        <Link to="/invoices" className="text-sm text-primary hover:underline">
          ← Lista faktur
        </Link>
      </div>

      <Card className="mx-auto w-full max-w-4xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">1. Zamówienie</CardTitle>
          <p className="text-sm text-muted-foreground">
            Potwierdzone lub dostarczone zamówienia bez wystawionej faktury.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="invoice-create-order-search" className="text-sm font-medium">
              Szukaj (numer, klient)
            </label>
            <Input
              id="invoice-create-order-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="np. numer zamówienia…"
            />
          </div>
          {listError ? <p className="text-sm text-destructive">{listErrMsg}</p> : null}
          <div className="space-y-2">
            <label htmlFor="invoice-create-order-select" className="text-sm font-medium">
              Wybierz zamówienie
            </label>
            <select
              id="invoice-create-order-select"
              className={selectClassName}
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              disabled={listLoading}
            >
              <option value="">— wybierz —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.order_number ?? o.id.slice(0, 8)} · {o.customer_name} · dostawa{' '}
                  {formatDisplayDate(o.delivery_date)}
                </option>
              ))}
            </select>
          </div>
          {listLoading ? <p className="text-sm text-muted-foreground">Ładowanie listy…</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Strona {listPage} / {totalPages} ({count} wyników)
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={listPage <= 1 || listLoading}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
              >
                Wstecz
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={listPage >= totalPages || listLoading}
                onClick={() => setListPage((p) => p + 1)}
              >
                Dalej
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedOrderId ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Card className="mx-auto w-full max-w-4xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">2. Dane faktury</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="inv-issue" className="text-sm font-medium">
                  Data wystawienia
                </label>
                <Input
                  id="inv-issue"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="inv-sale" className="text-sm font-medium">
                  Data sprzedaży
                </label>
                <Input
                  id="inv-sale"
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="inv-due" className="text-sm font-medium">
                  Termin płatności
                </label>
                <Input
                  id="inv-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="inv-pm" className="text-sm font-medium">
                  Forma płatności
                </label>
                <select
                  id="inv-pm"
                  className={selectClassName}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)}
                >
                  {PAYMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card className="mx-auto w-full max-w-4xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">3. Pozycje (z zamówienia)</CardTitle>
              {detailLoading ? (
                <p className="text-sm text-muted-foreground">Ładowanie pozycji…</p>
              ) : null}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Produkt</th>
                    <th className="py-2 pr-2 font-medium">Ilość</th>
                    <th className="py-2 pr-2 font-medium">Cena netto</th>
                    <th className="py-2 pr-2 font-medium">VAT</th>
                    <th className="py-2 pr-2 font-medium text-right">Netto</th>
                    <th className="py-2 font-medium text-right">Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {(orderDetail?.items ?? []).map((it) => (
                    <tr key={it.id} className="border-b border-border/60">
                      <td className="py-2 pr-2">{it.product_name}</td>
                      <td className="py-2 pr-2 tabular-nums">
                        {it.quantity_delivered && Number(it.quantity_delivered) > 0
                          ? it.quantity_delivered
                          : it.quantity}{' '}
                        {it.product_unit}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">{formatMoney(it.unit_price_net)}</td>
                      <td className="py-2 pr-2 tabular-nums">{it.vat_rate}%</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {formatMoney(it.line_total_net)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatMoney(it.line_total_gross)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!detailLoading &&
              orderDetail &&
              (!orderDetail.items || orderDetail.items.length === 0) ? (
                <p className="text-sm text-muted-foreground">Brak pozycji.</p>
              ) : null}
            </CardContent>
          </Card>

          {formError ? (
            <p className="mx-auto max-w-4xl text-sm text-destructive">{formError}</p>
          ) : null}

          <div className="mx-auto flex max-w-4xl justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
              Anuluj
            </Button>
            <Button type="submit" loading={generate.isPending} disabled={!formReady}>
              Utwórz fakturę
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
