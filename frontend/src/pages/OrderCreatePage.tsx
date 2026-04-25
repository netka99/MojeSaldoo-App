import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useCreateOrderMutation } from '@/query/use-orders';
import { useCustomerListQuery } from '@/query/use-customers';
import { useAuth } from '@/context/AuthContext';
import { authStorage } from '@/services/api';
import { productService } from '@/services/product.service';
import { cn } from '@/lib/utils';
import {
  lineTotalGross,
  lineTotalNet,
  parseDecimalInput,
  sumLines,
  toApiDecimalString,
  unitGrossFromNet,
} from '@/lib/order-form-math';
import type { Product } from '@/types';
import type { OrderCreate, OrderItemWrite } from '@/types';

const DEBOUNCE_MS = 300;
const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

type SelectedCustomer = { id: string; name: string };

type OrderDraftLine = {
  key: string;
  product: Product | null;
  quantity: string;
  unitPriceNet: string;
  discountPercent: string;
};

function createEmptyLine(): OrderDraftLine {
  return {
    key: crypto.randomUUID(),
    product: null,
    quantity: '1',
    unitPriceNet: '',
    discountPercent: '0',
  };
}

function formatPln(n: number): string {
  if (!Number.isFinite(n)) return pln.format(0);
  return pln.format(n);
}

type Step = 1 | 2 | 3;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function OrderCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const create = useCreateOrderMutation();

  const [step, setStep] = useState<Step>(1);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [customerInput, setCustomerInput] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerDebounce = useDebouncedValue(customerInput, DEBOUNCE_MS);
  const customerRef = useRef<HTMLDivElement>(null);
  const { data: customerData, isFetching: customersLoading } = useCustomerListQuery(1, customerDebounce);
  const customers = customerData?.results ?? [];

  const [deliveryDate, setDeliveryDate] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const [lines, setLines] = useState<OrderDraftLine[]>(() => [createEmptyLine()]);
  const [activeProductLineKey, setActiveProductLineKey] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const productDebounce = useDebouncedValue(productSearch, DEBOUNCE_MS);
  const { data: productData, isFetching: productsLoading } = useQuery({
    queryKey: ['products', 'order-form-picker', companyId, productDebounce] as const,
    queryFn: () =>
      productService.fetchList({
        page: 1,
        search: productDebounce.trim() || undefined,
        is_active: true,
        ordering: '-created_at',
      }),
    enabled: Boolean(companyId) && activeProductLineKey !== null,
  });
  const productResults = productData?.results ?? [];

  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setCustomerOpen(false);
      }
      const t = e.target as HTMLElement | null;
      if (activeProductLineKey && t && !t.closest?.(`[data-order-line="${activeProductLineKey}"]`)) {
        setActiveProductLineKey(null);
        setProductSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activeProductLineKey]);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const lineNetGross = (l: OrderDraftLine) => {
    const q = parseDecimalInput(l.quantity) ?? 0;
    const netU = parseDecimalInput(l.unitPriceNet);
    if (l.product == null || netU == null) return { net: 0, g: 0 };
    const vat = parseDecimalInput(String(l.product.vat_rate)) ?? 0;
    const disc = parseDecimalInput(l.discountPercent) ?? 0;
    return {
      net: lineTotalNet(q, netU, disc),
      g: lineTotalGross(q, netU, vat, disc),
    };
  };

  const { net: orderNet, gross: orderGross } = sumLines(lines, (l) => lineNetGross(l).net, (l) => lineNetGross(l).g);

  const validateStep1 = (): boolean => {
    if (!selectedCustomer) {
      setStepError('Wybierz klienta');
      return false;
    }
    if (!deliveryDate.trim()) {
      setStepError('Podaj datę dostawy');
      return false;
    }
    setStepError(null);
    return true;
  };

  const validateStep2 = (): boolean => {
    const filled = lines.filter((l) => l.product);
    if (filled.length === 0) {
      setStepError('Dodaj co najmniej jedną pozycję z produktem');
      return false;
    }
    for (const l of filled) {
      const q = parseDecimalInput(l.quantity);
      if (q == null || q <= 0) {
        setStepError('Ilość musi być większa niż zero');
        return false;
      }
      const p = parseDecimalInput(l.unitPriceNet);
      if (p == null || p < 0) {
        setStepError('Cena netto musi być uzupełniona');
        return false;
      }
    }
    setStepError(null);
    return true;
  };

  const buildPayload = (): OrderCreate => {
    const items: OrderItemWrite[] = lines
      .filter((l) => l.product)
      .map((l) => {
        const p = l.product!;
        const netU = parseDecimalInput(l.unitPriceNet)!;
        const vat = parseDecimalInput(String(p.vat_rate)) ?? 0;
        const grossU = unitGrossFromNet(netU, vat);
        return {
          product_id: p.id,
          quantity: toApiDecimalString(parseDecimalInput(l.quantity) ?? 0),
          unit_price_net: toApiDecimalString(netU),
          unit_price_gross: toApiDecimalString(grossU),
          vat_rate: toApiDecimalString(vat),
          discount_percent: toApiDecimalString(parseDecimalInput(l.discountPercent) ?? 0),
        };
      });
    return {
      customer_id: selectedCustomer!.id,
      delivery_date: deliveryDate,
      customer_notes: customerNotes.trim() || undefined,
      internal_notes: internalNotes.trim() || undefined,
      items,
    };
  };

  const goNext = () => {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    }
  };

  const goBack = () => {
    setStepError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const onSubmit = async () => {
    if (!validateStep1() || !validateStep2()) {
      setStep(1);
      return;
    }
    setSubmitError(null);
    try {
      const body = buildPayload();
      const order = await create.mutateAsync(body);
      navigate(`/orders/${order.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się utworzyć zamówienia');
    }
  };

  const onSelectCustomer = (c: { id: string; name: string }) => {
    setSelectedCustomer(c);
    setCustomerInput(c.name);
    setCustomerOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/orders')}>
          ← Lista zamówień
        </Button>
        <ol className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Kroki">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                  step === n
                    ? 'bg-primary text-primary-foreground'
                    : step > n
                      ? 'bg-muted-foreground/20 text-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
                aria-current={step === n ? 'step' : undefined}
              >
                {n}
              </span>
              <span className={cn('hidden sm:inline', step === n && 'font-medium text-foreground')}>
                {n === 1 ? 'Klient' : n === 2 ? 'Produkty' : 'Podsumowanie'}
              </span>
              {n < 3 && <span className="text-border">|</span>}
            </li>
          ))}
        </ol>
      </div>

      <h1 className="text-2xl font-semibold">Nowe zamówienie</h1>

      {(stepError || submitError) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {stepError || submitError}
        </p>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 1 — Klient i dostawa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div ref={customerRef} className="relative">
              <Input
                label="Klient"
                autoComplete="off"
                value={customerInput}
                onChange={(e) => {
                  setCustomerInput(e.target.value);
                  setSelectedCustomer(null);
                  setCustomerOpen(true);
                }}
                onFocus={() => setCustomerOpen(true)}
                placeholder="Wpisz nazwę, NIP…"
                id="order-customer-search"
                aria-label="Wyszukaj klienta"
                aria-expanded={customerOpen}
                aria-controls="order-customer-listbox"
                aria-autocomplete="list"
              />
              {customerOpen && (
                <ul
                  id="order-customer-listbox"
                  role="listbox"
                  className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
                >
                  {customersLoading && (
                    <li className="px-3 py-2 text-muted-foreground" role="status">
                      Ładowanie…
                    </li>
                  )}
                  {!customersLoading &&
                    customers.map((c) => (
                      <li key={c.id} role="option">
                        <button
                          type="button"
                          className="w-full cursor-pointer px-3 py-2 text-left hover:bg-muted"
                          onClick={() => onSelectCustomer(c)}
                        >
                          <span className="font-medium text-foreground">{c.name}</span>
                          {c.nip && <span className="ml-2 text-xs text-muted-foreground">NIP {c.nip}</span>}
                        </button>
                      </li>
                    ))}
                  {!customersLoading && customers.length === 0 && (
                    <li className="px-3 py-2 text-muted-foreground">Brak wyników</li>
                  )}
                </ul>
              )}
            </div>
            {selectedCustomer && <p className="text-sm text-muted-foreground">Wybrany: {selectedCustomer.name}</p>}
            <Input
              label="Data dostawy"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              id="order-delivery-date"
              required
            />
            <div>
              <label htmlFor="order-customer-notes" className="mb-2 block text-sm font-medium">
                Uwagi dla klienta (opcjonalnie)
              </label>
              <textarea
                id="order-customer-notes"
                className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label htmlFor="order-internal-notes" className="mb-2 block text-sm font-medium">
                Uwagi wewnętrzne (opcjonalnie)
              </label>
              <textarea
                id="order-internal-notes"
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" onClick={goNext}>
                Dalej
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 2 — Produkty</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Dodaj pozycje, ustaw ilości i ceny. Wartości brutto są liczone z VAT i rabatem.</p>
            <div className="space-y-4">
              {lines.map((line) => {
                const { net, g } = lineNetGross(line);
                const uNet = parseDecimalInput(line.unitPriceNet);
                const vat = line.product ? (parseDecimalInput(String(line.product.vat_rate)) ?? 0) : 0;
                const uG = uNet != null && line.product ? unitGrossFromNet(uNet, vat) : 0;
                return (
                  <div key={line.key} className="rounded-lg border border-border p-4" data-order-line={line.key}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="relative md:col-span-2">
                        <label className="mb-1 block text-sm font-medium">Produkt</label>
                        <div className="flex gap-2">
                          <input
                            className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                            value={
                              activeProductLineKey === line.key
                                ? productSearch
                                : line.product
                                  ? line.product.name
                                  : ''
                            }
                            onChange={(e) => {
                              if (line.product) {
                                setLines((prev) =>
                                  prev.map((l) => (l.key === line.key ? { ...l, product: null, unitPriceNet: '' } : l)),
                                );
                              }
                              setActiveProductLineKey(line.key);
                              setProductSearch(e.target.value);
                            }}
                            onFocus={() => {
                              setActiveProductLineKey(line.key);
                              if (line.product) {
                                setProductSearch(line.product.name);
                              } else {
                                setProductSearch('');
                              }
                            }}
                            placeholder="Szukaj produktu…"
                            autoComplete="off"
                            aria-label="Wyszukaj produkt"
                          />
                        </div>
                        {activeProductLineKey === line.key && (
                          <ul
                            className="absolute z-50 mt-1 max-h-48 w-full max-w-md overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
                            role="listbox"
                          >
                            {productsLoading && (
                              <li className="px-3 py-2 text-muted-foreground" role="status">
                                Ładowanie…
                              </li>
                            )}
                            {!productsLoading &&
                              productResults.map((p) => (
                                <li key={p.id} role="option">
                                  <button
                                    type="button"
                                    className="w-full cursor-pointer px-3 py-2 text-left hover:bg-muted"
                                    onClick={() => {
                                      setLines((prev) =>
                                        prev.map((l) =>
                                          l.key === line.key
                                            ? {
                                                ...l,
                                                product: p,
                                                unitPriceNet: String(p.price_net),
                                                discountPercent: l.discountPercent || '0',
                                              }
                                            : l,
                                        ),
                                      );
                                      setActiveProductLineKey(null);
                                      setProductSearch('');
                                    }}
                                  >
                                    {p.name}{' '}
                                    <span className="text-xs text-muted-foreground">({p.unit || '—'})</span>
                                  </button>
                                </li>
                              ))}
                            {!productsLoading && productResults.length === 0 && (
                              <li className="px-3 py-2 text-muted-foreground">Brak wyników</li>
                            )}
                          </ul>
                        )}
                      </div>
                      <Input
                        label="Ilość"
                        type="text"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity: v } : l)));
                        }}
                      />
                      <div>
                        <Input
                          label="Cena netto / j."
                          type="text"
                          inputMode="decimal"
                          value={line.unitPriceNet}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, unitPriceNet: v } : l)));
                          }}
                        />
                        {line.product && uNet != null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Brutto / j.: {formatPln(uG)} (VAT {String(line.product.vat_rate)}%)
                          </p>
                        )}
                      </div>
                      <Input
                        label="Rabat %"
                        type="text"
                        inputMode="decimal"
                        value={line.discountPercent}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, discountPercent: v } : l)));
                        }}
                      />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Wartość netto pozycji</p>
                        <p className="text-lg font-semibold">{formatPln(net)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Wartość brutto pozycji</p>
                        <p className="text-lg font-semibold text-primary">{formatPln(g)}</p>
                      </div>
                    </div>
                    {lines.length > 1 && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setLines((prev) => prev.filter((l) => l.key !== line.key));
                            if (activeProductLineKey === line.key) {
                              setActiveProductLineKey(null);
                            }
                          }}
                        >
                          Usuń wiersz
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines((prev) => [...prev, createEmptyLine()])}
              >
                Dodaj produkt
              </Button>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">Podsumowanie zamówienia</p>
              <div className="mt-2 flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Suma netto</p>
                  <p className="text-xl font-semibold">{formatPln(orderNet)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Suma brutto</p>
                  <p className="text-xl font-semibold text-primary">{formatPln(orderGross)}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={goBack}>
                Wstecz
              </Button>
              <Button type="button" onClick={goNext}>
                Dalej
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 3 — Przegląd i zatwierdzenie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Klient:</span>{' '}
                <span className="font-medium text-foreground">{selectedCustomer?.name}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Data dostawy:</span>{' '}
                <span className="font-medium text-foreground">{deliveryDate || '—'}</span>
              </p>
              {customerNotes.trim() && (
                <p>
                  <span className="text-muted-foreground">Uwagi (klient):</span> {customerNotes}
                </p>
              )}
              {internalNotes.trim() && (
                <p>
                  <span className="text-muted-foreground">Uwagi wewn.:</span> {internalNotes}
                </p>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2">Produkt</th>
                    <th className="px-3 py-2">Ilość</th>
                    <th className="px-3 py-2 text-right">Netto / j.</th>
                    <th className="px-3 py-2 text-right">Rabat %</th>
                    <th className="px-3 py-2 text-right">Netto</th>
                    <th className="px-3 py-2 text-right">Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {lines
                    .filter((l) => l.product)
                    .map((l) => {
                      const { net, g } = lineNetGross(l);
                      return (
                        <tr key={l.key} className="border-t border-border">
                          <td className="px-3 py-2">{l.product!.name}</td>
                          <td className="px-3 py-2">
                            {l.quantity} {l.product!.unit || ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {toApiDecimalString(parseDecimalInput(l.unitPriceNet) ?? 0)} zł
                          </td>
                          <td className="px-3 py-2 text-right">{l.discountPercent}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatPln(net)}</td>
                          <td className="px-3 py-2 text-right font-medium text-primary">{formatPln(g)}</td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-right">
                      Razem
                    </td>
                    <td className="px-3 py-2 text-right">{formatPln(orderNet)}</td>
                    <td className="px-3 py-2 text-right text-primary">{formatPln(orderGross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={goBack}>
                Wstecz
              </Button>
              <Button type="button" onClick={() => void onSubmit()} disabled={create.isPending}>
                {create.isPending ? 'Zapisywanie…' : 'Utwórz zamówienie'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
