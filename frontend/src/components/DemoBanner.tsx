import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery, useDeleteDemoCompanyMutation, useResetDemoCompanyMutation, useSwitchCompanyMutation } from '@/query/use-companies';

/**
 * Yellow banner shown when the active company is a demo company.
 * Lets the user switch back to their real company or delete the demo company.
 */
export function DemoBanner() {
  const { user, refreshUser } = useAuth();
  const { data: companies } = useMyCompaniesQuery();
  const deleteDemoMutation = useDeleteDemoCompanyMutation();
  const resetDemoMutation = useResetDemoCompanyMutation();
  const switchMutation = useSwitchCompanyMutation();
  const [resetDone, setResetDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Hide the confirmation message after 4 seconds
  useEffect(() => {
    if (!resetDone) return;
    const t = setTimeout(() => setResetDone(false), 4000);
    return () => clearTimeout(t);
  }, [resetDone]);

  const list = (companies ?? []) as { id: string; name: string; is_demo?: boolean }[];
  const currentId = user?.current_company ?? null;
  const current = list.find((c) => c.id === currentId);

  if (!current?.is_demo) return null;

  const realCompany = list.find((c) => !c.is_demo);

  async function handleDelete() {
    await deleteDemoMutation.mutateAsync();
    if (realCompany) {
      await switchMutation.mutateAsync(realCompany.id);
    }
    await refreshUser();
  }

  async function handleReset() {
    setConfirmOpen(false);
    await resetDemoMutation.mutateAsync();
    await refreshUser();
    setResetDone(true);
  }

  async function handleSwitch() {
    if (realCompany) {
      await switchMutation.mutateAsync(realCompany.id);
      await refreshUser();
    }
  }

  return (
    <>
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
    >
      {resetDone ? (
        <span className="flex items-center gap-1.5 font-medium text-emerald-700">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Dane demo zostały zresetowane do stanu początkowego.
        </span>
      ) : (
        <span className="font-medium">Przeglądasz przykładowe dane.</span>
      )}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={resetDemoMutation.isPending}
          className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
        >
          {resetDemoMutation.isPending ? 'Resetowanie…' : 'Resetuj dane demo'}
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleteDemoMutation.isPending || switchMutation.isPending}
          className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
        >
          Usuń dane demo
        </button>
        {realCompany && (
          <button
            type="button"
            onClick={() => void handleSwitch()}
            disabled={switchMutation.isPending}
            className="font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Przełącz na swoją firmę →
          </button>
        )}
      </div>
    </div>

    {confirmOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmOpen(false)} />
        <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-apple-md">
          <h2 className="text-base font-semibold text-slate-900">Zresetować dane demo?</h2>
          <p className="mt-2 text-sm text-slate-500">
            Wszystkie zmiany wprowadzone w danych demo zostaną usunięte i zastąpione oryginalnymi danymi przykładowymi. Tej operacji nie można cofnąć.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={resetDemoMutation.isPending}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {resetDemoMutation.isPending ? 'Resetowanie…' : 'Tak, resetuj'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
