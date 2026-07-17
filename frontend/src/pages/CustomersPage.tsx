import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CustomerList } from '@/components/features/customers/CustomerList';
import { CustomerImportDialog } from '@/components/features/customers/CustomerImportDialog';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { useCustomerListQuery } from '@/query/use-customers';
import { usePermission } from '@/hooks/usePermission';

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function contractorCountLabel(count: number): string {
  if (count === 1) return '1 kontrahent';
  return `${count} kontrahentów`;
}

export function CustomersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageCustomers = usePermission('can_manage_customers');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const { data, isFetching, isError, error, refetch } = useCustomerListQuery(page, search);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const totalCount = data?.count ?? 0;

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-4 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shadow-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-card text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wstecz"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Klienci
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isFetching && totalCount === 0 ? 'Ładowanie…' : contractorCountLabel(totalCount)}
          </p>
        </div>
        {canManageCustomers && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setImportOpen(true)}
            >
              Importuj
            </Button>
            <Button
              type="button"
              size="icon"
              className="shrink-0 rounded-full"
              onClick={() => navigate('/customers/new')}
              aria-label="Dodaj kontrahenta"
            >
              <PlusIcon className="h-5 w-5" />
            </Button>
          </>
        )}
      </header>

      {importOpen && <CustomerImportDialog onClose={() => setImportOpen(false)} />}
      <CustomerList
        customers={data?.results ?? []}
        totalCount={totalCount}
        page={page}
        onPageChange={setPage}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(c) => navigate(`/customers/${c.id}?date=${new Date().toISOString().slice(0, 10)}`)}
      />
    </div>
  );
}
