import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useCreateSupplierMutation } from '@/query/use-suppliers';
import type { SupplierCreate } from '@/types';

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EMPTY: SupplierCreate = {
  name: '',
  nip: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  postal_code: '',
  country: 'Polska',
  payment_terms: 14,
  notes: '',
};

export function SupplierCreatePage() {
  const navigate = useNavigate();
  const create = useCreateSupplierMutation();
  const [form, setForm] = useState<SupplierCreate>(EMPTY);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = (field: keyof SupplierCreate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setSubmitError('Nazwa dostawcy jest wymagana.');
      return;
    }
    setSubmitError(null);
    try {
      await create.mutateAsync({
        ...form,
        name: form.name.trim(),
        payment_terms: Number(form.payment_terms) || 14,
      });
      navigate('/suppliers');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Nie udało się utworzyć dostawcy.');
    }
  };

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-5 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      {/* header */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shadow-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-card text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wróć"
        >
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Nowy dostawca
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Dodaj dostawcę do bazy</p>
        </div>
      </header>

      {submitError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {/* basic info */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <h2 className="mb-4 text-[14px] font-semibold text-foreground">Dane podstawowe</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                id="name"
                label="Nazwa *"
                value={form.name}
                onChange={set('name')}
                required
                autoFocus
              />
            </div>
            <Input id="nip" label="NIP" value={form.nip ?? ''} onChange={set('nip')} />
            <Input id="phone" label="Telefon" type="tel" value={form.phone ?? ''} onChange={set('phone')} />
            <div className="sm:col-span-2">
              <Input id="email" label="E-mail" type="email" value={form.email ?? ''} onChange={set('email')} />
            </div>
          </div>
        </section>

        {/* address */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <h2 className="mb-4 text-[14px] font-semibold text-foreground">Adres</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input id="street" label="Ulica i numer" value={form.street ?? ''} onChange={set('street')} />
            </div>
            <Input id="postal_code" label="Kod pocztowy" value={form.postal_code ?? ''} onChange={set('postal_code')} />
            <Input id="city" label="Miasto" value={form.city ?? ''} onChange={set('city')} />
            <div className="sm:col-span-2">
              <Input id="country" label="Kraj" value={form.country ?? 'Polska'} onChange={set('country')} />
            </div>
          </div>
        </section>

        {/* commercial */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <h2 className="mb-4 text-[14px] font-semibold text-foreground">Warunki handlowe</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="payment_terms"
              label="Termin płatności (dni)"
              type="number"
              min={0}
              value={String(form.payment_terms ?? 14)}
              onChange={(e) => setForm((p) => ({ ...p, payment_terms: Number(e.target.value) }))}
            />
          </div>
          <div className="mt-4">
            <label htmlFor="notes" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
              Uwagi
            </label>
            <textarea
              id="notes"
              value={form.notes ?? ''}
              onChange={set('notes')}
              rows={3}
              placeholder="Opcjonalne uwagi…"
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </section>

        {/* actions */}
        <div className="flex gap-3">
          <Button type="submit" disabled={create.isPending} className="flex-1">
            {create.isPending ? 'Zapisywanie…' : 'Zapisz dostawcę'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={create.isPending}>
            Anuluj
          </Button>
        </div>
      </form>
    </div>
  );
}
