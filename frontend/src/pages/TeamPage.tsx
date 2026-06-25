import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import {
  useRolesQuery,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useMembersQuery,
  useAddMemberMutation,
  useUpdateMemberMutation,
  useRemoveMemberMutation,
} from '@/query/use-team';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { CompanyRoleDefinition, TeamMember, UserPermissions } from '@/types';

// ---------------------------------------------------------------------------
// Permission groups (shown as collapsible sections in role editor)
// ---------------------------------------------------------------------------
type PermEntry = { key: keyof UserPermissions; label: string; description: string };

const PERMISSION_GROUPS: { group: string; items: PermEntry[] }[] = [
  {
    group: 'Sprzedaż',
    items: [
      { key: 'can_manage_customers', label: 'Klienci', description: 'Dodawanie i edycja klientów, cenniki' },
      { key: 'can_manage_orders', label: 'Zamówienia', description: 'Tworzenie i edycja zamówień' },
    ],
  },
  {
    group: 'Magazyn',
    items: [
      { key: 'can_manage_products', label: 'Produkty (katalog)', description: 'Tworzenie i edycja produktów, stanów i cen' },
      { key: 'can_manage_warehouses', label: 'Magazyny', description: 'Zarządzanie magazynami' },
      { key: 'can_manage_inventory', label: 'Inwentaryzacja', description: 'Tworzenie i zamykanie dokumentów INW' },
      { key: 'can_manage_stock_moves', label: 'Odpisy RW / przesunięcia MM', description: 'Odpisy materiałowe i przesunięcia między magazynami' },
    ],
  },
  {
    group: 'Dokumenty dostawy',
    items: [
      { key: 'can_manage_delivery', label: 'Dostawa (WZ/ZW)', description: 'Tworzenie dokumentów wydania i zwrotu' },
      { key: 'can_access_routes', label: 'Trasy vana', description: 'Dostęp do tras i rozliczenia vana' },
    ],
  },
  {
    group: 'Faktury',
    items: [
      { key: 'can_manage_invoices', label: 'Faktury i KSeF', description: 'Wystawianie, edycja faktur i wysyłka do KSeF' },
      { key: 'can_access_ksef_inbox', label: 'Odebrane faktury KSeF', description: 'Przychodzące faktury od dostawców (OPEX)' },
    ],
  },
  {
    group: 'Zakupy',
    items: [
      { key: 'can_manage_purchasing', label: 'Dostawcy i PZ', description: 'Dostawcy, dokumenty przyjęcia towaru (PZ)' },
    ],
  },
  {
    group: 'Księgowość',
    items: [
      { key: 'can_manage_accounting', label: 'Adnotacje kosztowe', description: 'Opisywanie faktur kosztowych i zarządzanie projektami' },
    ],
  },
  {
    group: 'Produkcja',
    items: [
      { key: 'can_manage_production', label: 'Produkcja i receptury', description: 'Zlecenia produkcji, receptury' },
    ],
  },
  {
    group: 'Administracja',
    items: [
      { key: 'can_view_reports', label: 'Raporty', description: 'Raporty finansowe i analityczne' },
      { key: 'can_manage_team', label: 'Zarządzanie zespołem', description: 'Dodawanie i usuwanie pracowników, edycja ról' },
      { key: 'can_manage_settings', label: 'Ustawienia firmy', description: 'Moduły, przepływ dokumentów, KSeF' },
    ],
  },
  {
    group: 'Ogólne',
    items: [
      { key: 'can_see_prices', label: 'Widoczność cen', description: 'Ceny jednostkowe i kwoty na wszystkich dokumentach' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Toggle switch (reused from CompanySettingsPage)
// ---------------------------------------------------------------------------
function PermSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        !checked && 'border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600',
        checked && 'border-blue-600 bg-blue-600 dark:border-sky-500 dark:bg-sky-600',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 translate-x-0.5 transform rounded-full bg-white shadow transition duration-200',
          checked && 'translate-x-5',
        )}
        aria-hidden
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Role detail / edit panel (shown inline below the role card)
// ---------------------------------------------------------------------------
function RoleEditPanel({
  role,
  companyId,
  onClose,
}: {
  role: CompanyRoleDefinition;
  companyId: string;
  onClose: () => void;
}) {
  const [perms, setPerms] = useState<UserPermissions>(() => ({ ...role.permissions }));
  const [name, setName] = useState(role.name);
  const [error, setError] = useState<string | null>(null);
  const updateRole = useUpdateRoleMutation(companyId);

  const handleSave = async () => {
    setError(null);
    try {
      await updateRole.mutateAsync({ roleId: role.id, data: { name, ...perms } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="role-name-edit">
          Nazwa roli
        </label>
        <Input
          id="role-name-edit"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs text-sm"
          disabled={role.is_admin}
        />
      </div>

      <div className="space-y-4">
        {PERMISSION_GROUPS.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/40">
              {items.map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{label}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{description}</p>
                  </div>
                  <PermSwitch
                    id={`perm-${role.id}-${key}`}
                    checked={role.is_admin ? true : perms[key]}
                    onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
                    disabled={role.is_admin}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!role.is_admin && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => void handleSave()} disabled={updateRole.isPending}>
            {updateRole.isPending ? 'Zapisywanie…' : 'Zapisz'}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
        </div>
      )}
      {role.is_admin && (
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={onClose}>
            Zamknij
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles section
// ---------------------------------------------------------------------------
function RolesSection({ companyId }: { companyId: string }) {
  const { data: roles, isPending, isError } = useRolesQuery(companyId);
  const createRole = useCreateRoleMutation(companyId);
  const deleteRole = useDeleteRoleMutation(companyId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateError(null);
    try {
      await createRole.mutateAsync({ name: newName.trim() });
      setNewName('');
      setShowCreate(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Nie udało się utworzyć roli');
    }
  };

  const handleDelete = async (role: CompanyRoleDefinition) => {
    setDeleteError(null);
    if (!confirm(`Usunąć rolę „${role.name}"?`)) return;
    try {
      await deleteRole.mutateAsync(role.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Nie udało się usunąć roli');
    }
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Ładowanie ról…</p>;
  if (isError) return <p className="text-sm text-destructive">Nie udało się wczytać ról.</p>;

  return (
    <section aria-labelledby="roles-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="roles-heading" className="text-lg font-semibold">Role i uprawnienia</h2>
          <p className="text-sm text-muted-foreground">
            Utwórz role dla pracowników i skonfiguruj, do jakich części systemu mają dostęp.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          + Nowa rola
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <label className="mb-1 block text-xs font-medium" htmlFor="new-role-name">Nazwa roli</label>
          <div className="flex gap-2">
            <Input
              id="new-role-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="np. Kierowca, Magazynier"
              className="max-w-xs text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            />
            <Button size="sm" onClick={() => void handleCreate()} disabled={createRole.isPending || !newName.trim()}>
              {createRole.isPending ? 'Tworzenie…' : 'Utwórz'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowCreate(false); setNewName(''); }}>
              Anuluj
            </Button>
          </div>
          {createError && (
            <p className="mt-2 text-sm text-destructive" role="alert">{createError}</p>
          )}
        </div>
      )}

      {deleteError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {deleteError}
        </p>
      )}

      <ul className="space-y-2">
        {(roles ?? []).map((role) => (
          <li key={role.id}>
            <div className="rounded-lg border border-border bg-surface-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{role.name}</span>
                  {role.is_admin && (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      Pełny dostęp
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {role.member_count} {role.member_count === 1 ? 'os.' : 'os.'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExpandedId(expandedId === role.id ? null : role.id)}
                  >
                    {expandedId === role.id ? 'Zwiń' : (role.is_admin ? 'Podgląd' : 'Edytuj')}
                  </Button>
                  {!role.is_admin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleDelete(role)}
                      disabled={deleteRole.isPending}
                    >
                      Usuń
                    </Button>
                  )}
                </div>
              </div>
              {expandedId === role.id && (
                <RoleEditPanel
                  role={role}
                  companyId={companyId}
                  onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add member dialog
// ---------------------------------------------------------------------------
function AddMemberForm({
  companyId,
  roles,
  onClose,
}: {
  companyId: string;
  roles: CompanyRoleDefinition[];
  onClose: () => void;
}) {
  const addMember = useAddMemberMutation(companyId);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    password: '',
    company_role_id: roles.find((r) => !r.is_admin)?.id ?? roles[0]?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await addMember.mutateAsync({
        ...form,
        email: form.email.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać pracownika');
    }
  };

  const nonAdminRoles = roles.filter((r) => !r.is_admin);

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="add-first-name">Imię</label>
          <Input id="add-first-name" value={form.first_name} onChange={set('first_name')} required className="text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="add-last-name">
            Nazwisko <span className="font-normal text-muted-foreground">(opcjonalne)</span>
          </label>
          <Input id="add-last-name" value={form.last_name} onChange={set('last_name')} className="text-sm" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="add-username">Login (nazwa użytkownika)</label>
        <Input id="add-username" value={form.username} onChange={set('username')} required autoComplete="off" className="text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="add-email">
          E-mail <span className="font-normal text-muted-foreground">(opcjonalny)</span>
        </label>
        <Input id="add-email" type="email" value={form.email} onChange={set('email')} className="text-sm" placeholder="opcjonalny — pomocny przy resetowaniu hasła" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="add-password">Hasło tymczasowe</label>
        <Input
          id="add-password"
          type="password"
          value={form.password}
          onChange={set('password')}
          required
          minLength={8}
          className="text-sm"
          placeholder="min. 8 znaków"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="add-role">Rola</label>
        <select
          id="add-role"
          value={form.company_role_id}
          onChange={set('company_role_id')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {nonAdminRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
          {nonAdminRoles.length === 0 && (
            <option value="" disabled>Najpierw utwórz rolę w zakładce Role</option>
          )}
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={addMember.isPending || nonAdminRoles.length === 0}>
          {addMember.isPending ? 'Dodawanie…' : 'Dodaj pracownika'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Member edit panel
// ---------------------------------------------------------------------------
function MemberEditPanel({
  member,
  companyId,
  onClose,
}: {
  member: TeamMember;
  companyId: string;
  onClose: () => void;
}) {
  const updateMember = useUpdateMemberMutation(companyId);
  const [form, setForm] = useState({
    first_name: member.user.first_name,
    last_name: member.user.last_name,
    email: member.user.email ?? '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setError(null);
    if (form.password && form.password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.');
      return;
    }
    try {
      await updateMember.mutateAsync({
        membershipId: member.id,
        data: {
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email.trim() || null,
          ...(form.password ? { password: form.password } : {}),
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor={`edit-fn-${member.id}`}>Imię</label>
          <Input id={`edit-fn-${member.id}`} value={form.first_name} onChange={set('first_name')} required className="text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor={`edit-ln-${member.id}`}>
            Nazwisko <span className="font-normal text-muted-foreground">(opcjonalne)</span>
          </label>
          <Input id={`edit-ln-${member.id}`} value={form.last_name} onChange={set('last_name')} className="text-sm" />
        </div>
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium" htmlFor={`edit-email-${member.id}`}>
          E-mail <span className="font-normal text-muted-foreground">(opcjonalny)</span>
        </label>
        <Input
          id={`edit-email-${member.id}`}
          type="email"
          value={form.email}
          onChange={set('email')}
          className="text-sm"
          placeholder="opcjonalny — pomocny przy resetowaniu hasła"
        />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium" htmlFor={`edit-pw-${member.id}`}>
          Nowe hasło <span className="font-normal text-muted-foreground">(opcjonalne — pozostaw puste, by nie zmieniać)</span>
        </label>
        <div className="relative">
          <Input
            id={`edit-pw-${member.id}`}
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            className="pr-9 text-sm"
            placeholder="min. 8 znaków"
            autoComplete="new-password"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={updateMember.isPending}>
          {updateMember.isPending ? 'Zapisywanie…' : 'Zapisz'}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>Anuluj</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members section
// ---------------------------------------------------------------------------
function MembersSection({ companyId }: { companyId: string }) {
  const { data: members, isPending, isError } = useMembersQuery(companyId);
  const { data: roles } = useRolesQuery(companyId);
  const updateMember = useUpdateMemberMutation(companyId);
  const removeMember = useRemoveMemberMutation(companyId);
  const { user: currentUser } = useAuth();

  const [showAdd, setShowAdd] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChangeRole = async (membershipId: string, company_role_id: string) => {
    setError(null);
    try {
      await updateMember.mutateAsync({ membershipId, data: { company_role_id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zmienić roli');
    }
  };

  const handleRemove = async (member: TeamMember) => {
    setError(null);
    const name = `${member.user.first_name} ${member.user.last_name}`.trim() || member.user.username;
    if (!confirm(`Usunąć pracownika ${name} z firmy?`)) return;
    try {
      await removeMember.mutateAsync(member.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się usunąć pracownika');
    }
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Ładowanie pracowników…</p>;
  if (isError) return <p className="text-sm text-destructive">Nie udało się wczytać pracowników.</p>;

  const nonAdminRoles = (roles ?? []).filter((r) => !r.is_admin);

  return (
    <section aria-labelledby="members-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="members-heading" className="text-lg font-semibold">Pracownicy</h2>
          <p className="text-sm text-muted-foreground">
            Dodawaj konta dla pracowników i przypisuj im role.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          + Dodaj pracownika
        </Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nowy pracownik</CardTitle>
            <CardDescription>
              Utwórz konto i udostępnij pracownikowi dane logowania.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddMemberForm
              companyId={companyId}
              roles={roles ?? []}
              onClose={() => setShowAdd(false)}
            />
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {(members ?? []).map((m) => {
          const isSelf = m.user.id === currentUser?.id;
          const fullName = `${m.user.first_name} ${m.user.last_name}`.trim() || m.user.username;
          return (
            <li key={m.id}>
              <div className={cn(
                'rounded-lg border border-border bg-surface-card p-3 shadow-sm',
                !m.is_active && 'opacity-50',
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{fullName}</span>
                    {isSelf && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        Ty
                      </span>
                    )}
                    {!m.is_active && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600 dark:bg-red-900 dark:text-red-300">
                        Nieaktywny
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground">{m.user.email} · @{m.user.username}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {m.company_role?.is_admin ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        Administrator
                      </span>
                    ) : (
                      <select
                        aria-label="Zmień rolę"
                        value={m.company_role?.id ?? ''}
                        onChange={(e) => void handleChangeRole(m.id, e.target.value)}
                        disabled={isSelf || updateMember.isPending}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {nonAdminRoles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}

                    {!isSelf && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedMemberId(expandedMemberId === m.id ? null : m.id)}
                      >
                        {expandedMemberId === m.id ? 'Zwiń' : 'Edytuj'}
                      </Button>
                    )}

                    {!isSelf && !m.company_role?.is_admin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleRemove(m)}
                        disabled={removeMember.isPending}
                      >
                        Usuń
                      </Button>
                    )}
                  </div>
                </div>
                {expandedMemberId === m.id && (
                  <MemberEditPanel
                    member={m}
                    companyId={companyId}
                    onClose={() => setExpandedMemberId(null)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page root with tabs
// ---------------------------------------------------------------------------
type Tab = 'members' | 'roles';

export function TeamPage() {
  const { user } = useAuth();
  const resolved = useResolvedCompanyId();
  const [tab, setTab] = useState<Tab>('members');

  if (resolved.state === 'loading') {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      </div>
    );
  }

  if (resolved.state !== 'ready') return null;

  const canManageTeam = user?.is_company_admin || user?.permissions?.can_manage_team;
  if (!canManageTeam) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Zespół</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nie masz uprawnień do zarządzania zespołem.
        </p>
      </div>
    );
  }

  const { companyId } = resolved;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Zespół</h1>
        <p className="text-sm text-muted-foreground">
          Zarządzaj pracownikami i definiuj, do jakich funkcji mają dostęp.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {(['members', 'roles'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'members' ? 'Pracownicy' : 'Role'}
          </button>
        ))}
      </div>

      {tab === 'members' && <MembersSection companyId={companyId} />}
      {tab === 'roles' && <RolesSection companyId={companyId} />}
    </div>
  );
}
