import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery, useSwitchCompanyMutation } from '@/query/use-companies';

/**
 * Shows the current company name as a clickable button that opens a dropdown
 * listing all companies the user belongs to. Clicking switches the active company.
 */
export function CompanySwitcher() {
  const { user, isLoading: authLoading, refreshUser } = useAuth();
  const { data: companies, isPending: companiesLoading, isError } = useMyCompaniesQuery();
  const switchMutation = useSwitchCompanyMutation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (authLoading || companiesLoading) {
    return (
      <p className="mt-1 truncate text-sm text-muted-foreground" aria-live="polite">
        Ładowanie…
      </p>
    );
  }

  if (isError) {
    return (
      <p className="mt-1 text-sm text-destructive" role="alert">
        Nie udało się załadować nazwy firmy
      </p>
    );
  }

  const list = (companies ?? []) as { id: string; name: string; is_demo?: boolean }[];
  const currentId = user?.current_company ?? null;
  const current = list.find((c) => c.id === currentId) ?? list[0];
  const label = current?.name ?? '—';

  // Single company — no switching needed
  if (list.length <= 1) {
    return (
      <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
        {label}
      </p>
    );
  }

  async function handleSwitch(companyId: string) {
    setOpen(false);
    if (companyId === currentId) return;
    await switchMutation.mutateAsync(companyId);
    await refreshUser();
  }

  return (
    <div ref={containerRef} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 truncate text-left text-sm text-muted-foreground hover:text-foreground"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
      >
        <span className="truncate">{label}</span>
        {current?.is_demo && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            Demo
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="shadow-apple-md absolute left-0 z-50 mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1"
        >
          {list.map((company) => (
            <li key={company.id} role="option" aria-selected={company.id === currentId}>
              <button
                type="button"
                onClick={() => void handleSwitch(company.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  company.id === currentId ? 'font-medium text-primary' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{company.name}</span>
                {company.is_demo && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    Demo
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
