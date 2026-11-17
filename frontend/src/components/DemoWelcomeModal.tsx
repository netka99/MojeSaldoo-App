import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { useAuth } from '@/context/AuthContext';

const STORAGE_KEY = 'demo_welcome_shown';

/**
 * Full-screen modal shown once to new users who land on the demo company.
 * Prompts them to either start onboarding or browse demo data first.
 * Dismissed state is stored in localStorage so it only shows once.
 */
export function DemoWelcomeModal() {
  const { user } = useAuth();
  const { data: companies } = useMyCompaniesQuery();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  const list = (companies ?? []) as { id: string; name: string; is_demo?: boolean }[];
  const currentId = user?.current_company ?? null;
  const current = list.find((c) => c.id === currentId);
  const hasRealCompany = list.some((c) => !c.is_demo);

  useEffect(() => {
    // Show only when: active company is demo AND no real company exists yet AND not shown before
    if (
      current?.is_demo &&
      !hasRealCompany &&
      !sessionStorage.getItem(STORAGE_KEY)
    ) {
      setVisible(true);
    }
  }, [current, hasRealCompany]);

  if (!visible) return null;

  function dismiss() {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  function goToOnboarding() {
    dismiss();
    navigate('/onboarding');
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-welcome-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-apple-float">
        {/* Icon */}
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-3xl">
          🏭
        </div>

        <h2 id="demo-welcome-title" className="text-xl font-bold text-slate-900">
          Witaj w MojeSaldoo!
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Żebyś mógł od razu zobaczyć jak działa aplikacja, przygotowaliśmy dla Ciebie{' '}
          <strong>przykładowe dane</strong> — faktury, klientów, produkty i zamówienia.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Kiedy będziesz gotowy, skonfiguruj <strong>swoją firmę</strong> — zajmie to 2 minuty.
        </p>

        <div className="mt-7 flex flex-col gap-3">
          <button
            type="button"
            onClick={goToOnboarding}
            className="w-full rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Skonfiguruj swoją firmę →
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-2xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Najpierw przejrzyj dane demo
          </button>
        </div>
      </div>
    </div>
  );
}
