import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { useCreateMmMutation } from '@/query/use-delivery';
import { productService } from '@/services/product.service';
import { warehouseService } from '@/services/warehouse.service';
import type { Product } from '@/types';

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function pageFromDrfNext(next: string | null): number | undefined {
  if (!next) return undefined;
  try {
    const u = new URL(next, 'http://localhost');
    const p = u.searchParams.get('page');
    return p ? Number(p) : undefined;
  } catch {
    return undefined;
  }
}

interface MmLine {
  product: Product;
  quantity: string;
}

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function MMCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const createMm = useCreateMmMutation();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(todayIso);
  const [notes, setNotes] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [lines, setLines] = useState<MmLine[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);
  const productSearchDebounced = useDebouncedValue(productSearch, DEBOUNCE_MS);

  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!companyId) return;
    warehouseService
      .fetchList({ page_size: 100, is_active: true })
      .then((res) => setWarehouses(res.results.map((w) => ({ id: w.id, name: w.name }))))
      .catch(() => {});
  }, [companyId]);

  const {
    data: productPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: productsLoading,
  } = useInfiniteQuery({
    queryKey: ['products', 'mm-create', companyId, productSearchDebounced] as const,
    queryFn: ({ pageParam }) =>
      productService.fetchList({
        page: pageParam as number,
        page_size: PAGE_SIZE,
        search: productSearchDebounced.trim() || undefined,
        is_active: true,
        ordering: 'name',
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => pageFromDrfNext(last.next),
    enabled: Boolean(companyId) && showProductSearch,
  });

  const searchProducts = useMemo(
    () => productPages?.pages.flatMap((p) => p.results) ?? [],
    [productPages],
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '100px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowProductSearch(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addProduct = (product: Product) => {
    setLines((prev) => {
      if (prev.some((l) => l.product.id === product.id)) return prev;
      return [...prev, { product, quantity: '1' }];
    });
    setProductSearch('');
    setShowProductSearch(false);
  };

  const removeLine = (productId: string) => {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  };

  const updateQty = (productId: string, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.product.id === productId ? { ...l, quantity: value } : l)),
    );
  };

  const onSubmit = async () => {
    setSubmitError(null);
    if (!fromWarehouseId) {
      setSubmitError('Wybierz magazyn źródłowy.');
      return;
    }
    if (!toWarehouseId) {
      setSubmitError('Wybierz magazyn docelowy.');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setSubmitError('Magazyn źródłowy i docelowy muszą być różne.');
      return;
    }
    if (lines.length === 0) {
      setSubmitError('Dodaj co najmniej jeden produkt.');
      return;
    }
    const invalidQty = lines.find((l) => {
      const q = parseFloat(l.quantity);
      return !Number.isFinite(q) || q <= 0;
    });
    if (invalidQty) {
      setSubmitError(`Nieprawidłowa ilość dla: ${invalidQty.product.name}`);
      return;
    }

    try {
      const doc = await createMm.mutateAsync({
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        issue_date: issueDate,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: parseFloat(l.quantity).toFixed(3),
        })),
      });
      navigate(`/delivery/${doc.id}`);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'detail' in e
            ? String((e as { detail: unknown }).detail)
            : 'Nie udało się utworzyć MM.';
      setSubmitError(msg);
    }
  };

  const warehouseSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    exclude?: string,
  ) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label} <span className="text-destructive">*</span>
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'select-pill w-full',
            !value && 'border-dashed border-[#D4D2EE]',
          )}
        >
          <option value="">— wybierz magazyn —</option>
          {warehouses
            .filter((w) => !exclude || w.id !== exclude)
            .map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {/* header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
            aria-label="Wróć"
          >
            <ChevronLeftIcon />
          </button>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 md:text-xl">Nowe MM</h1>
            <p className="text-xs text-slate-500">Przesunięcie międzymagazynowe</p>
          </div>
        </div>

        {submitError && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}

        {/* document fields */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:rounded-3xl">
          <div className="flex items-center gap-2.5 pb-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
                <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 12H8" strokeLinecap="round" />
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-slate-900">Dane dokumentu</h2>
          </div>

          <div className="space-y-4">
            {warehouseSelect('from_warehouse', 'Magazyn źródłowy', fromWarehouseId, setFromWarehouseId, toWarehouseId)}
            {warehouseSelect('to_warehouse', 'Magazyn docelowy', toWarehouseId, setToWarehouseId, fromWarehouseId)}

            <div>
              <label htmlFor="issue_date" className="mb-1.5 block text-sm font-medium text-slate-800">
                Data wystawienia
              </label>
              <input
                id="issue_date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="date-pill w-full"
              />
            </div>

            <div>
              <label htmlFor="notes" className="mb-1.5 block text-sm font-medium text-slate-800">
                Uwagi
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Opcjonalne uwagi…"
                className="field-ios-tall w-full"
              />
            </div>
          </div>
        </section>

        {/* items */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:rounded-3xl">
          <div className="flex items-center gap-2.5 pb-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" />
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-slate-900">
              Pozycje{lines.length > 0 && ` (${lines.length})`}
            </h2>
          </div>

          {/* product search */}
          <div ref={searchRef} className="relative mb-4">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                viewBox="0 0 24 24" fill="none" aria-hidden
              >
                <path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <input
                type="search"
                placeholder="Wyszukaj i dodaj produkt…"
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setShowProductSearch(true); }}
                onFocus={() => setShowProductSearch(true)}
                className="field-ios w-full pl-9"
                aria-label="Wyszukaj produkt"
              />
            </div>

            {showProductSearch && (
              <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-apple-md">
                {productsLoading && <p className="px-3 py-2 text-sm text-slate-500">Ładowanie…</p>}
                {!productsLoading && searchProducts.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-500">Brak wyników</p>
                )}
                {searchProducts.map((p) => {
                  const alreadyAdded = lines.some((l) => l.product.id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addProduct(p)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50',
                        alreadyAdded && 'opacity-40',
                      )}
                    >
                      <span className="font-medium text-slate-900">{p.name}</span>
                      {alreadyAdded ? (
                        <span className="text-xs text-slate-500">dodano</span>
                      ) : (
                        <PlusIcon />
                      )}
                    </button>
                  );
                })}
                <div ref={sentinelRef} className="h-1" aria-hidden />
                {isFetchingNextPage && <p className="px-3 py-2 text-xs text-slate-500">Ładowanie…</p>}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Wyszukaj produkty powyżej, aby dodać pozycje do MM.
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line) => (
                <div
                  key={line.product.id}
                  className="rounded-xl border border-[#AEAEB2] bg-[#F2F2F7] p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{line.product.name}</p>
                      <p className="text-xs text-slate-600">{line.product.unit || 'szt.'}</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateQty(line.product.id, e.target.value)}
                      aria-label={`Ilość — ${line.product.name}`}
                      className="field-ios-sm w-24 bg-white text-right"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(line.product.id)}
                      aria-label={`Usuń ${line.product.name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* fixed bottom bar */}
      <div
        className="fixed bottom-[calc(83px+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-xl md:bottom-0 md:left-64"
      >
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={createMm.isPending || lines.length === 0 || !fromWarehouseId || !toWarehouseId}
            className="w-full rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {createMm.isPending ? 'Tworzenie MM…' : `Utwórz MM (${lines.length} poz.)`}
          </button>
        </div>
      </div>
    </div>
  );
}
