import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  useFixedCostsQuery,
  useCreateFixedCostMutation,
  useUpdateFixedCostMutation,
  useDeleteFixedCostMutation,
} from '@/query/use-fixed-costs';
import {
  FIXED_COST_CATEGORY_LABELS,
  type FixedCost,
  type FixedCostCategory,
  type FixedCostWrite,
} from '@/types/fixed-costs.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

const CATEGORIES = Object.entries(FIXED_COST_CATEGORY_LABELS) as [FixedCostCategory, string][];

/** Convert a YYYY-MM-DD date string to a readable month label. */
function monthLabel(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
}

/** Return first day of the current month as YYYY-MM-DD. */
function thisMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// ---------------------------------------------------------------------------
// Form (create & edit)
// ---------------------------------------------------------------------------

interface FormProps {
  initial?: FixedCost;
  onCancel: () => void;
  onSaved: () => void;
}

function FixedCostForm({ initial, onCancel, onSaved }: FormProps) {
  const [category, setCategory] = useState<FixedCostCategory>(
    initial?.category ?? 'inne',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(
    initial ? String(initial.amount_monthly) : '',
  );
  // active_from stored as YYYY-MM-DD but UI only needs YYYY-MM
  const [activeFrom, setActiveFrom] = useState(
    initial ? initial.active_from.slice(0, 7) : thisMonthIso().slice(0, 7),
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateFixedCostMutation();
  const updateMutation = useUpdateFixedCostMutation();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountNum = Number.parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      setError('Podaj prawidłową kwotę miesięczną (większą od zera).');
      return;
    }
    if (!activeFrom) {
      setError('Podaj miesiąc, od którego koszt obowiązuje.');
      return;
    }

    const payload: FixedCostWrite = {
      category,
      description: description.trim(),
      amount_monthly: amountNum.toFixed(2),
      active_from: activeFrom + '-01',
      is_active: isActive,
    };

    try {
      if (initial) {
        await updateMutation.mutateAsync({ id: initial.id, data: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onSaved();
    } catch {
      setError('Wystąpił błąd. Sprawdź dane i spróbuj ponownie.');
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Kategoria
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FixedCostCategory)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {CATEGORIES.map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Kwota miesięczna (PLN)
          </label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="np. 4500,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Opis (opcjonalnie)
          </label>
          <Input
            type="text"
            placeholder="np. Jan Kowalski, Biuro ul. Lipowa"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={255}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Aktywny od (miesiąc)
          </label>
          <input
            type="month"
            value={activeFrom}
            onChange={(e) => setActiveFrom(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="flex items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Aktywny
          </label>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
        <Button type="submit" loading={isPending}>
          {initial ? 'Zapisz zmiany' : 'Dodaj koszt'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function FixedCostRow({
  item,
  onEdit,
}: {
  item: FixedCost;
  onEdit: (item: FixedCost) => void;
}) {
  const deleteMutation = useDeleteFixedCostMutation();
  const toggleMutation = useUpdateFixedCostMutation();

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        !item.is_active && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {FIXED_COST_CATEGORY_LABELS[item.category]}
          </span>
          {!item.is_active && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Nieaktywny
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {pln.format(Number.parseFloat(item.amount_monthly))}
            <span className="ml-1 text-xs font-normal text-muted-foreground">/mies.</span>
          </span>
          {item.description && (
            <span className="truncate text-sm text-muted-foreground">{item.description}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          od {monthLabel(item.active_from)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          loading={toggleMutation.isPending}
          onClick={() =>
            toggleMutation.mutate({ id: item.id, data: { is_active: !item.is_active } })
          }
        >
          {item.is_active ? 'Dezaktywuj' : 'Aktywuj'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
          Edytuj
        </Button>
        <Button
          size="sm"
          variant="outline"
          loading={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate(item.id)}
          className="text-destructive hover:bg-destructive/10"
        >
          Usuń
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FixedCostsPage() {
  const { data: items = [], isLoading, isError } = useFixedCostsQuery();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);

  const activeItems = items.filter((i) => i.is_active);
  const monthlyTotal = activeItems.reduce(
    (sum, i) => sum + Number.parseFloat(i.amount_monthly),
    0,
  );

  // Group by category for the summary
  const byCategory = activeItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + Number.parseFloat(i.amount_monthly);
    return acc;
  }, {});

  const handleEdit = (item: FixedCost) => {
    setEditing(item);
    setShowForm(true);
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">
            Koszty Stałe i Kadry
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Miesięczne wydatki spoza KSeF — wynagrodzenia, ZUS, czynsz. Odejmowane od
            Wyniku Operacyjnego w raporcie P&amp;L.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            + Dodaj koszt
          </Button>
        )}
      </div>

      {/* Summary bar */}
      {activeItems.length > 0 && (
        <Card className="mb-6 border-primary/20 bg-primary/3">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-start gap-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Łączny koszt miesięczny
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-destructive">
                  {pln.format(monthlyTotal)}
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                {Object.entries(byCategory).map(([cat, total]) => (
                  <div key={cat}>
                    <p className="text-xs text-muted-foreground">
                      {FIXED_COST_CATEGORY_LABELS[cat as FixedCostCategory]}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">{pln.format(total)}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              To Twój miesięczny „koszt otwarcia drzwi" — kwota, którą firma musi pokryć
              zanim sprzedasz pierwszy produkt. Pojawia się w raporcie P&amp;L jako oddzielna
              linia.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Inline form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {editing ? 'Edytuj koszt stały' : 'Nowy koszt stały'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FixedCostForm
              initial={editing ?? undefined}
              onCancel={handleCancel}
              onSaved={handleSaved}
            />
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading && (
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">Błąd ładowania kosztów stałych.</p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nie dodano jeszcze żadnych kosztów stałych.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Dodaj wynagrodzenia, ZUS lub czynsz, aby zobaczyć realny wynik operacyjny w P&amp;L.
            </p>
          </CardContent>
        </Card>
      )}
      {!isLoading && items.length > 0 && (
        <div className="space-y-2">
          {/* Active first, then inactive */}
          {[...items]
            .sort((a, b) => Number(b.is_active) - Number(a.is_active))
            .map((item) => (
              <FixedCostRow key={item.id} item={item} onEdit={handleEdit} />
            ))}
        </div>
      )}
    </div>
  );
}
