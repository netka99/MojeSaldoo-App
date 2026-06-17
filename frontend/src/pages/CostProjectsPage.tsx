import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { buildExportUrl } from '@/services/cost-allocation.service';
import {
  useCreateCostProjectMutation,
  useCostProjectsQuery,
  useDeleteCostProjectMutation,
  useUpdateCostProjectMutation,
} from '@/query/use-cost-allocation';
import type { CostProject } from '@/types/cost-allocation.types';
import { authStorage } from '@/services/api';

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
];

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border border-border shrink-0"
      style={{ backgroundColor: color || '#6B7280' }}
    />
  );
}

function ProjectRow({ project, onEdit }: { project: CostProject; onEdit: (p: CostProject) => void }) {
  const deleteMutation = useDeleteCostProjectMutation();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <ColorDot color={project.color} />
        <span className="font-medium text-sm text-foreground truncate">{project.name}</span>
        {project.code && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground">
            {project.code}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" onClick={() => onEdit(project)}>
          Edytuj
        </Button>
        <Button
          size="sm"
          variant="outline"
          loading={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate(project.id)}
          className="text-destructive hover:bg-destructive/10"
        >
          Usuń
        </Button>
      </div>
    </div>
  );
}

interface ProjectFormProps {
  initial?: CostProject;
  onCancel: () => void;
  onSaved: () => void;
}

function ProjectForm({ initial, onCancel, onSaved }: ProjectFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [color, setColor] = useState(initial?.color ?? '#3B82F6');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateCostProjectMutation();
  const updateMutation = useUpdateCostProjectMutation();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Nazwa projektu jest wymagana.');
      return;
    }
    try {
      if (initial) {
        await updateMutation.mutateAsync({ id: initial.id, data: { name: name.trim(), code: code.trim(), color } });
      } else {
        await createMutation.mutateAsync({ name: name.trim(), code: code.trim(), color });
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setError(msg || 'Nie udało się zapisać projektu.');
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <Input
        label="Nazwa projektu"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="np. Projekt budowlany 2026"
        autoFocus
      />
      <Input
        label="Kod (opcjonalny)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="np. BUDO-26"
        className="font-mono"
      />
      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">Kolor</p>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                borderColor: color === c ? 'currentColor' : 'transparent',
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-6 w-6 cursor-pointer rounded border border-border p-0"
            title="Własny kolor"
          />
          <ColorDot color={color} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
        <Button type="submit" loading={isPending}>
          {initial ? 'Zapisz' : 'Dodaj projekt'}
        </Button>
      </div>
    </form>
  );
}

function ExportPanel() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleExport = (fmt: 'xlsx' | 'csv') => {
    setDropdownOpen(false);
    const token = authStorage.getAccessToken();
    const url = buildExportUrl(dateFrom || undefined, dateTo || undefined, fmt);
    const filename = fmt === 'xlsx' ? 'adnotacje_kosztowe.xlsx' : 'adnotacje_kosztowe.csv';
    void fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(`Błąd eksportu: ${err}`));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Eksport dla księgowości</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pobierz zestawienie ze wszystkimi opisanymi fakturami i pozycjami.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Od"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
          <Input
            label="Do"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
          <div className="relative pt-5">
            <div className="flex">
              <Button
                className="rounded-r-none border-r-0"
                onClick={() => handleExport('xlsx')}
              >
                Wyeksportuj
              </Button>
              <button
                type="button"
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center rounded-r-md border border-l-0 border-primary bg-primary px-2 text-primary-foreground hover:bg-primary/90 focus:outline-none"
                aria-label="Wybierz format"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {dropdownOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-md border border-border bg-background shadow-md">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => handleExport('xlsx')}
                >
                  <span>XLSX</span>
                  <span className="text-xs text-muted-foreground">(Excel)</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => handleExport('csv')}
                >
                  <span>CSV</span>
                  <span className="text-xs text-muted-foreground">(tekstowy)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CostProjectsPage() {
  const { data: projects = [], isPending, isError } = useCostProjectsQuery();
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<CostProject | null>(null);

  const closeForm = () => {
    setShowForm(false);
    setEditingProject(null);
  };

  return (
    <div className="max-w-2xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">
          Adnotacje kosztowe
        </h1>
        {!showForm && !editingProject && (
          <Button onClick={() => setShowForm(true)}>+ Nowy projekt</Button>
        )}
      </div>

      {/* Inline project form */}
      {(showForm || editingProject) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editingProject ? 'Edytuj projekt' : 'Nowy projekt'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectForm
              initial={editingProject ?? undefined}
              onCancel={closeForm}
              onSaved={closeForm}
            />
          </CardContent>
        </Card>
      )}

      {/* Project list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Projekty / centra kosztów</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isPending && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
          {isError && <p className="text-sm text-destructive">Błąd pobierania projektów.</p>}
          {!isPending && projects.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              Brak projektów. Dodaj pierwszy, aby opisywać pozycje faktur.
            </p>
          )}
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              onEdit={(proj) => { setShowForm(false); setEditingProject(proj); }}
            />
          ))}
        </CardContent>
      </Card>

      <ExportPanel />
    </div>
  );
}
