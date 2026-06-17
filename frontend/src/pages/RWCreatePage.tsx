import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { useCreateRwMutation } from '@/query/use-delivery';
import { productService } from '@/services/product.service';
import { warehouseService } from '@/services/warehouse.service';
import type { Product } from '@/types';
import type { RwReason } from '@/types/delivery.types';

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 300;

const RW_REASONS: RwReason[] = ['Strata', 'Próbka', 'Uszkodzenie', 'Inne'];

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

interface RwLine {
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

export function RWCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const createRw = useCreateRwMutation();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(todayIso);
  const [notes, setNotes] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [reason, setReason] = useState<RwReason | ''>('');
  const [lines, setLines] = useState<RwLine[]>([]);
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
    queryKey: ['products', 'rw-create', companyId, productSearchDebounced] as const,
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
    if (!reason) {
      setSubmitError('Wybierz powód odpisu.');
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
      const doc = await createRw.mutateAsync({
        from_warehouse_id: fromWarehouseId,
        reason,
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
            : 'Nie udało się utworzyć RW.';
      setSubmitError(msg);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-4 pb-3 pt-10">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.92 }}
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
              aria-label="Wróć"
            >
              <ChevronLeftIcon />
            </motion.button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Nowy odpis RW</h1>
              <p className="text-[13px] text-muted-foreground">Rozchód wewnętrzny</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {submitError && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}

        {/* document fields */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <h2 className="mb-4 text-[15px] font-semibold text-foreground">Dane dokumentu</h2>

          <div className="space-y-4">
            {/* warehouse */}
            <div>
              <label htmlFor="from_warehouse" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Magazyn <span className="text-destructive">*</span>
              </label>
              <select
                id="from_warehouse"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className={cn(
                  'h-10 w-full rounded-xl border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30',
                  !fromWarehouseId ? 'border-destructive/40' : 'border-border',
                )}
              >
                <option value="">— wybierz magazyn —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            {/* reason */}
            <div>
              <label htmlFor="reason" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Powód odpisu <span className="text-destructive">*</span>
              </label>
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as RwReason)}
                className={cn(
                  'h-10 w-full rounded-xl border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30',
                  !reason ? 'border-destructive/40' : 'border-border',
                )}
              >
                <option value="">— wybierz powód —</option>
                {RW_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* date */}
            <div>
              <label htmlFor="issue_date" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Data wystawienia
              </label>
              <input
                id="issue_date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* notes */}
            <div>
              <label htmlFor="notes" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Uwagi
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Opcjonalne uwagi…"
                className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </section>

        {/* items */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">
              Pozycje{lines.length > 0 && ` (${lines.length})`}
            </h2>
          </div>

          {/* product search */}
          <div ref={searchRef} className="relative mb-4">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <input
                type="search"
                placeholder="Wyszukaj i dodaj produkt…"
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setShowProductSearch(true);
                }}
                onFocus={() => setShowProductSearch(true)}
                className="h-10 w-full rounded-xl border border-border bg-secondary pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="Wyszukaj produkt"
              />
            </div>

            {showProductSearch && (
              <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-xl border border-border bg-card shadow-lg">
                {productsLoading && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Ładowanie…</p>
                )}
                {!productsLoading && searchProducts.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Brak wyników</p>
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
                        'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-muted',
                        alreadyAdded && 'opacity-40',
                      )}
                    >
                      <span className="font-medium text-foreground">{p.name}</span>
                      {alreadyAdded ? (
                        <span className="text-xs text-muted-foreground">dodano</span>
                      ) : (
                        <PlusIcon />
                      )}
                    </button>
                  );
                })}
                <div ref={sentinelRef} className="h-1" aria-hidden />
                {isFetchingNextPage && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Ładowanie…</p>
                )}
              </div>
            )}
          </div>

          {/* lines */}
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Wyszukaj produkty powyżej, aby dodać pozycje do RW.
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, i) => (
                <motion.div
                  key={line.product.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-foreground">{line.product.name}</p>
                    <p className="text-[12px] text-muted-foreground">{line.product.unit || 'szt.'}</p>
                  </div>

                  <div className="w-24 shrink-0">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateQty(line.product.id, e.target.value)}
                      aria-label={`Ilość — ${line.product.name}`}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-right text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(line.product.id)}
                    aria-label={`Usuń ${line.product.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"
                  >
                    <TrashIcon />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* fixed bottom bar */}
      <div
        className={cn(
          'fixed left-0 right-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur-xl',
          'bottom-[calc(83px+env(safe-area-inset-bottom))] md:bottom-0 md:left-64',
        )}
      >
        <div className="mx-auto max-w-3xl">
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => void onSubmit()}
            disabled={createRw.isPending || lines.length === 0 || !fromWarehouseId || !reason}
            className="w-full rounded-xl bg-primary py-3.5 text-[16px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {createRw.isPending ? 'Tworzenie RW…' : `Utwórz RW (${lines.length} poz.)`}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
