import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { cn } from '@/lib/utils';

const STORAGE_KEY_PREFIX = 'setup_nudge_dismissed_';

interface NudgeItem {
  label: string;
  description: string;
  to: string;
  done: boolean;
}

function useShouldShowNudge(companyId: string | null | undefined): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!companyId) return true;
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${companyId}`) === '1';
  });

  function dismiss() {
    if (companyId) localStorage.setItem(`${STORAGE_KEY_PREFIX}${companyId}`, '1');
    setDismissed(true);
  }

  return [!dismissed, dismiss];
}

export function SetupNudgeBar() {
  const { user } = useAuth();
  const companyId = user?.current_company;
  const { data: companies } = useMyCompaniesQuery();

  const [shouldShow, dismiss] = useShouldShowNudge(companyId);

  // Only show if onboarding was just completed (flag from the API) and not yet dismissed.
  const onboardingCompleted = user?.onboarding_completed === true;
  if (!onboardingCompleted || !shouldShow || !companyId) return null;

  const currentCompany = companies?.find((c) => c.id === companyId);
  const hasNip = Boolean(currentCompany?.nip?.trim());

  const items: NudgeItem[] = [
    {
      label: 'Dodaj produkty',
      description: 'Skonfiguruj swój katalog produktów',
      to: '/products/new',
      done: false,
    },
    {
      label: 'Dodaj klientów',
      description: 'Zaimportuj lub wpisz pierwszych klientów',
      to: '/customers/new',
      done: false,
    },
    {
      label: 'Uzupełnij dane firmy',
      description: 'NIP i adres potrzebne do fakturowania KSeF',
      to: '/settings/company-data',
      done: hasNip,
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  if (allDone) {
    dismiss();
    return null;
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Konfiguracja — {doneCount}/{items.length}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Uzupełnij poniższe, aby w pełni korzystać z aplikacji.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Zamknij pasek konfiguracji"
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            {item.done ? (
              <div className="flex items-center gap-2.5 opacity-60">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  ✓
                </span>
                <span className="text-sm font-medium text-foreground line-through">{item.label}</span>
              </div>
            ) : (
              <Link
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-1 py-0.5 no-underline',
                  'transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 text-primary/40">
                  &nbsp;
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <span className="ml-auto text-muted-foreground">›</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
