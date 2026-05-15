import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Customer } from '@/types';

const PAGE_SIZE = 20;

export type CustomerFilterPill = 'all' | 'company' | 'individual' | 'active';

export interface CustomerListProps {
  customers: Customer[];
  totalCount: number;
  page: number;
  onPageChange: (page: number) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
  onRowClick?: (customer: Customer) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się wczytać kontrahentów';
}

function isCompanyCustomer(c: Customer): boolean {
  return Boolean(c.company_name?.trim() || c.nip?.trim());
}

function firstLetter(name: string): string {
  const t = name.trim();
  if (!t) return '#';
  return t.charAt(0).toUpperCase();
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 21V8l8-4 8 4v13M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 380, damping: 28 },
  },
};

export function CustomerList({
  customers,
  totalCount,
  page,
  onPageChange,
  searchInput,
  onSearchInputChange,
  isFetching,
  isError,
  error,
  onRetry,
  onEdit,
  onDelete,
  onRowClick,
}: CustomerListProps) {
  const [pill, setPill] = useState<CustomerFilterPill>('all');

  const filteredByPill = useMemo(() => {
    return customers.filter((c) => {
      if (pill === 'active') return c.is_active;
      if (pill === 'company') return isCompanyCustomer(c);
      if (pill === 'individual') return !isCompanyCustomer(c);
      return true;
    });
  }, [customers, pill]);

  const grouped = useMemo(() => {
    const sorted = [...filteredByPill].sort((a, b) =>
      a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }),
    );
    const groups: Record<string, Customer[]> = {};
    sorted.forEach((c) => {
      const letter = firstLetter(c.name);
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(c);
    });
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }))
      .map((letter) => [letter, groups[letter]!] as const);
  }, [filteredByPill]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const activeOnPage = useMemo(() => customers.filter((c) => c.is_active).length, [customers]);

  const pills: { key: CustomerFilterPill; label: string }[] = [
    { key: 'all', label: 'Wszyscy' },
    { key: 'company', label: 'Firmy' },
    { key: 'individual', label: 'Osoby' },
    { key: 'active', label: 'Aktywni' },
  ];

  const showEmptyAfterFilter =
    !isFetching && !isError && customers.length > 0 && filteredByPill.length === 0;
  const showEmptyFromApi = !isFetching && !isError && customers.length === 0;

  return (
    <div className="space-y-4">
      <div className="hidden shadow-soft rounded-2xl bg-surface-card p-4 sm:block">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Podsumowanie
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums text-foreground">{totalCount}</p>
          {isFetching && <span className="text-xs text-muted-foreground">Aktualizacja…</span>}
        </div>
        <p className="mt-0.5 text-[13px] text-on-surface-variant">
          Łącznie w rejestrze{customers.length > 0 ? ` · aktywnych na stronie: ${activeOnPage}` : ''}
        </p>
      </div>

      {isError && (
        <div
          className="shadow-soft flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-destructive">{queryErrorMessage(error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          placeholder="Szukaj po nazwie, NIP lub mieście"
          aria-label="Szukaj kontrahentów po nazwie, NIP lub mieście"
          className="shadow-soft h-11 w-full rounded-xl border-0 bg-surface-card pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {pills.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPill(p.key)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              pill === p.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-card text-foreground shadow-soft',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {showEmptyFromApi && (
        <p className="py-12 text-center text-sm text-muted-foreground">Brak kontrahentów.</p>
      )}

      {showEmptyAfterFilter && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Brak kontrahentów dla tego filtra.
        </p>
      )}

      {grouped.length > 0 && (
        <motion.div
          className="space-y-6"
          variants={listVariants}
          initial="hidden"
          animate="show"
          key={`${page}-${pill}-${searchInput}`}
        >
          {grouped.map(([letter, rows]) => (
            <section key={letter} aria-label={`Kontrahenci — ${letter}`}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {letter}
              </h2>
              <ul className="flex flex-col gap-2">
                {rows.map((c) => {
                  const company = isCompanyCustomer(c);
                  const metaParts: string[] = [];
                  if (c.nip) metaParts.push(`NIP ${c.nip}`);
                  if (c.city?.trim()) metaParts.push(c.city);
                  const secondaryLine =
                    metaParts.length > 0 ? metaParts.join(' · ') : (c.email ?? '—');

                  const tertiary = c.phone?.trim() || null;

                  return (
                    <motion.li key={c.id} variants={rowVariants}>
                      <div
                        role={onRowClick ? 'button' : undefined}
                        tabIndex={onRowClick ? 0 : undefined}
                        aria-label={
                          onRowClick
                            ? `Otwórz edycję kontrahenta: ${c.name}`
                            : undefined
                        }
                        className={cn(
                          'shadow-soft flex w-full gap-3 rounded-2xl bg-surface-card p-3 text-left transition-colors active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                          onRowClick ? 'cursor-pointer hover:bg-surface-low/40' : 'cursor-default',
                        )}
                        onClick={() => onRowClick?.(c)}
                        onKeyDown={(e) => {
                          if (!onRowClick) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(c);
                          }
                        }}
                      >
                        <div
                          className={cn(
                            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                            company ? 'bg-primary-light text-primary' : 'bg-surface-low text-on-surface-variant',
                          )}
                          aria-hidden
                        >
                          {company ? (
                            <BuildingIcon className="h-5 w-5" />
                          ) : (
                            <UserIcon className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{c.name}</p>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                c.is_active
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {c.is_active ? 'Aktywny' : 'Nieaktywny'}
                            </span>
                          </div>
                          {c.company_name && (
                            <p className="truncate text-xs text-muted-foreground">{c.company_name}</p>
                          )}
                          <p className="mt-0.5 truncate text-[13px] text-on-surface-variant">
                            {secondaryLine}
                          </p>
                          {tertiary && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{tertiary}</p>
                          )}
                          {(onEdit || onDelete) && (
                            <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                              {onEdit && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => onEdit(c)}
                                >
                                  Edytuj
                                </Button>
                              )}
                              {onDelete && (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => onDelete(c)}
                                >
                                  Usuń
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        {onRowClick && (
                          <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          ))}
        </motion.div>
      )}

      {totalPages > 1 && !showEmptyFromApi && (
        <nav
          className="flex flex-col items-stretch justify-between gap-3 pt-2 sm:flex-row sm:items-center"
          aria-label="Paginacja"
        >
          <p className="text-center text-sm text-muted-foreground sm:text-left">
            Strona <span className="font-medium text-foreground">{page}</span> z{' '}
            <span className="font-medium text-foreground">{totalPages}</span>
          </p>
          <div className="flex justify-center gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => onPageChange(page - 1)}
            >
              Poprzednia
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => onPageChange(page + 1)}
            >
              Następna
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
