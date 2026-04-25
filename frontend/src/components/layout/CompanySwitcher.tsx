import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery, useSwitchCompanyMutation } from '@/query/use-companies';
import { CreateCompanyDialog } from '@/components/features/company/CreateCompanyDialog';
import { cn } from '@/lib/utils';

const chevron = (
  <svg
    className="h-4 w-4 shrink-0 opacity-60"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden
  >
    <path
      fillRule="evenodd"
      d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

type CompanyRow = { id: string; name: string };

/**
 * Company selector for the app shell. With multiple companies, opens a list and switches via POST
 * `/companies/switch/`, then invalidates the query cache, refreshes the session user, and reloads
 * the page.
 */
export function CompanySwitcher() {
  const { pathname } = useLocation();
  /** Avoid duplicate "add company" next to the full form on Ustawienia firmy / Dane firmy. */
  const showAddCompanyInShell = pathname !== '/settings/company' && pathname !== '/settings/company-data';
  const { user, refreshUser, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { data: companies, isPending: companiesLoading, isError: companiesError } = useMyCompaniesQuery();
  const { mutateAsync: switchCompany, isPending: isSwitching } = useSwitchCompanyMutation();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const list = (companies ?? []) as CompanyRow[];
  const currentId = user?.current_company ?? null;
  const current = list.find((c) => c.id === currentId) ?? list[0];
  const currentLabel = current?.name ?? '—';
  const multiple = list.length > 1;
  /** Treat resolved first company as active when the session has no `current_company` yet. */
  const effectiveCurrentId = currentId ?? list[0]?.id ?? null;

  const onSwitch = useCallback(
    async (companyId: string) => {
      if (companyId === effectiveCurrentId) {
        setOpen(false);
        return;
      }
      setActionError(null);
      setOpen(false);
      try {
        await switchCompany(companyId);
        await queryClient.invalidateQueries();
        await refreshUser();
        window.location.reload();
      } catch {
        setActionError('Nie udało się przełączyć firmy. Spróbuj ponownie.');
      }
    },
    [effectiveCurrentId, switchCompany, queryClient, refreshUser],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (authLoading || companiesLoading) {
    return (
      <p className="mt-1 truncate text-sm text-muted-foreground" aria-live="polite">
        Ładowanie…
      </p>
    );
  }

  if (companiesError) {
    return (
      <p className="mt-1 text-sm text-destructive" role="alert">
        Nie udało się załadować listy firm
      </p>
    );
  }

  if (list.length === 0) {
    return (
      <p className="mt-1 truncate text-sm text-muted-foreground" title={undefined}>
        Brak przypisanych firm
      </p>
    );
  }

  if (!multiple) {
    return (
      <div className="mt-1 space-y-1.5">
        <p className="truncate text-sm text-muted-foreground" title={currentLabel}>
          {currentLabel}
        </p>
        {showAddCompanyInShell && (
          <CreateCompanyDialog
            triggerClassName="text-xs text-primary"
            triggerLabel="Dodaj kolejną firmę"
          />
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm text-foreground',
          'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSwitching && 'pointer-events-none opacity-60',
        )}
        onClick={() => {
          if (!isSwitching) {
            setOpen((o) => !o);
            setActionError(null);
          }
        }}
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Aktualna firma, otwórz listę by przełączyć"
        disabled={isSwitching}
      >
        <span className="min-w-0 flex-1 truncate" title={currentLabel}>
          {isSwitching ? 'Przełączanie…' : currentLabel}
        </span>
        {chevron}
      </button>

      {actionError && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {actionError}
        </p>
      )}

      {open && !isSwitching && (
        <ul
          id={listId}
          className="absolute left-0 right-0 z-[200] mt-1 max-h-60 overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-foreground shadow-lg dark:border-zinc-600 dark:bg-zinc-950"
          role="listbox"
          aria-label="Firmy"
        >
          {list.map((c) => {
            const isActive = c.id === effectiveCurrentId;
            return (
              <li key={c.id} role="presentation" className="list-none">
                <button
                  type="button"
                  role="option"
                  className={cn(
                    'w-full rounded-sm px-2 py-1.5 text-left text-sm',
                    isActive
                      ? 'bg-zinc-200 font-medium text-foreground dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  )}
                  aria-selected={isActive}
                  onClick={() => void onSwitch(c.id)}
                >
                  {c.name}
                </button>
              </li>
            );
          })}
          {showAddCompanyInShell && (
            <li className="list-none border-t border-zinc-200 p-1 pt-2 dark:border-zinc-600" role="presentation">
              <div className="px-1">
                <CreateCompanyDialog
                  triggerClassName="!text-left text-xs w-full"
                  triggerLabel="Dodaj kolejną firmę"
                  onBeforeOpen={() => {
                    setOpen(false);
                    setActionError(null);
                  }}
                />
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
