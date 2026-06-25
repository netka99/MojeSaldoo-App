import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useSupplierListQuery } from '@/query/use-suppliers';
import { usePermission } from '@/hooks/usePermission';

function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function supplierCountLabel(n: number): string {
  if (n === 1) return '1 dostawca';
  if (n >= 2 && n <= 4) return `${n} dostawców`;
  return `${n} dostawców`;
}

export function SuppliersPage() {
  const navigate = useNavigate();
  const canPurchasing = usePermission('can_manage_purchasing');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const { data, isFetching, isError, error, refetch } = useSupplierListQuery(page, { search });
  const suppliers = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = data ? Math.ceil(data.count / 20) : 1;

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-4 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      {/* header */}
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Dostawcy
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isFetching && totalCount === 0 ? 'Ładowanie…' : supplierCountLabel(totalCount)}
          </p>
        </div>
        {canPurchasing && (
          <Button
            type="button"
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => navigate('/suppliers/new')}
            aria-label="Dodaj dostawcę"
          >
            <PlusIcon />
          </Button>
        )}
      </header>

      {/* search */}
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
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Szukaj dostawcy…"
          className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          aria-label="Szukaj dostawcy"
        />
      </div>

      {/* error */}
      {isError && (
        <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Nie udało się pobrać dostawców.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            Spróbuj ponownie
          </button>
        </div>
      )}

      {/* list */}
      {!isError && (
        <div className="space-y-2">
          {isFetching && suppliers.length === 0 && (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl bg-card p-4">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/50" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/2 rounded bg-muted/50" />
                    <div className="h-3 w-1/3 rounded bg-muted/35" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isFetching && suppliers.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {search ? 'Brak wyników dla tego wyszukiwania.' : 'Brak dostawców. Kliknij + aby dodać pierwszego.'}
            </p>
          )}

          {suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={canPurchasing ? () => navigate(`/suppliers/${s.id}/edit`) : undefined}
              className="flex w-full items-center gap-3 rounded-xl bg-card p-4 text-left shadow-[0_2px_8px_rgba(26,28,31,0.06)] hover:bg-muted/40 transition-colors"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-base font-semibold text-violet-700" aria-hidden>
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-foreground">{s.name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {[s.nip && `NIP: ${s.nip}`, s.city].filter(Boolean).join(' · ') || 'Brak danych'}
                </p>
              </div>
              <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ← Poprzednia
          </button>
          <span className="text-[13px] text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isFetching}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Następna →
          </button>
        </div>
      )}

      {/* PZ shortcut */}
      <div className="rounded-2xl border border-dashed border-border p-4 text-center">
        <p className="text-[13px] text-muted-foreground">
          Chcesz przyjąć towar?{' '}
          {canPurchasing ? (
            <button
              type="button"
              onClick={() => navigate('/delivery/new-pz')}
              className="font-medium text-primary hover:underline"
            >
              Utwórz dokument PZ
            </button>
          ) : (
            <span>Brak uprawnień do tworzenia PZ.</span>
          )}
        </p>
      </div>
    </div>
  );
}
