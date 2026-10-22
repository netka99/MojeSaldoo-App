/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { CertificateUploadPage } from './CertificateUploadPage';

const refreshUser = vi.fn();
const updateCompanyMutateAsync = vi.fn().mockResolvedValue({});

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    is_staff: false,
    current_company: 'c1-uuid' as string | null,
    ksef_environment: 'demo' as 'test' | 'demo' | 'production',
  },
}));

const certState = vi.hoisted(() => ({
  status: {
    uploaded: false,
    valid: false,
    expired: false,
    not_yet_valid: false,
    certificate_filename: null as string | null,
    key_filename: null as string | null,
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    refreshUser,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}));

vi.mock('@/hooks/useResolvedCompanyId', () => ({
  useResolvedCompanyId: () => ({
    state: 'ready',
    companyId: 'c1-uuid',
    company: { name: 'Test Firma' },
  }),
}));

vi.mock('@/query/use-certificate', () => ({
  useKsefCertificateStatusQuery: () => ({
    data: certState.status,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useKsefCertificateUploadMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useKsefCertificateDeleteMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/query/use-invoices', () => ({
  useKsefSessionQuery: () => ({ data: { active: false }, refetch: vi.fn() }),
  useKsefAuthenticateMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useKsefClearSessionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/query/use-companies', () => ({
  useUpdateCompanyMutation: () => ({
    mutateAsync: updateCompanyMutateAsync,
    isPending: false,
  }),
}));

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <CertificateUploadPage />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  authState.user.is_staff = false;
  authState.user.ksef_environment = 'demo';
  certState.status = {
    uploaded: false,
    valid: false,
    expired: false,
    not_yet_valid: false,
    certificate_filename: null,
    key_filename: null,
  };
  vi.clearAllMocks();
  updateCompanyMutateAsync.mockResolvedValue({});
});

describe('CertificateUploadPage — KSeF environment', () => {
  it('shows Demo and Produkcja options for regular user', () => {
    renderPage();
    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Produkcja').length).toBeGreaterThan(0);
    expect(screen.queryByText('Testowe')).not.toBeInTheDocument();
  });

  it('shows Testowe option for staff user', () => {
    authState.user.is_staff = true;
    renderPage();
    expect(screen.getByText('Testowe')).toBeInTheDocument();
    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Produkcja').length).toBeGreaterThan(0);
  });

  it('current environment radio is checked', () => {
    authState.user.ksef_environment = 'demo';
    renderPage();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const demoRadio = radios.find((r) => r.value === 'demo');
    expect(demoRadio?.checked).toBe(true);
  });

  it('calls updateCompany when environment is changed', async () => {
    authState.user.ksef_environment = 'demo';
    renderPage();
    const user = userEvent.setup();
    const prodRadio = screen.getAllByRole('radio').find(
      (r) => (r as HTMLInputElement).value === 'production',
    ) as HTMLInputElement;
    await user.click(prodRadio);
    await waitFor(() => {
      expect(updateCompanyMutateAsync).toHaveBeenCalledWith({
        companyId: 'c1-uuid',
        data: { name: '', ksef_environment: 'production' },
      });
    });
  });
});

describe('CertificateUploadPage — saved files', () => {
  it('shows the stored filenames and hides the file pickers', () => {
    certState.status = {
      uploaded: true,
      valid: true,
      expired: false,
      not_yet_valid: false,
      certificate_filename: 'firma.pem',
      key_filename: 'klucz.key',
    };
    renderPage();
    expect(screen.getByText('firma.pem')).toBeInTheDocument();
    expect(screen.getByText('klucz.key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zamień pliki' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wyślij certyfikat' })).not.toBeInTheDocument();
  });

  it('reveals the file pickers after Zamień pliki', async () => {
    certState.status = {
      uploaded: true,
      valid: true,
      expired: false,
      not_yet_valid: false,
      certificate_filename: 'firma.pem',
      key_filename: 'klucz.key',
    };
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Zamień pliki' }));
    expect(screen.getByRole('button', { name: 'Wyślij certyfikat' })).toBeInTheDocument();
    expect(screen.getAllByText('Nie wybrano pliku')).toHaveLength(2);
  });
});
