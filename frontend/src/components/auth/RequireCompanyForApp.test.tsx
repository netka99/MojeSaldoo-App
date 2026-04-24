/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireCompanyForApp } from './RequireCompanyForApp';

const useMyCompaniesQueryMock = vi.hoisted(() =>
  vi.fn(() => ({
    isPending: true,
    isSuccess: false,
    isError: false,
    data: undefined,
  })),
);

vi.mock('@/query/use-companies', () => ({
  useMyCompaniesQuery: () => useMyCompaniesQueryMock(),
}));

function renderHarness(path = '/app') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireCompanyForApp />}>
          <Route path="/app" element={<div data-testid="app-shell">App</div>} />
        </Route>
        <Route path="/onboarding" element={<div data-testid="onboarding">Onboarding</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireCompanyForApp', () => {
  beforeEach(() => {
    useMyCompaniesQueryMock.mockReset();
    useMyCompaniesQueryMock.mockReturnValue({
      isPending: true,
      isSuccess: false,
      isError: false,
      data: undefined,
    });
  });

  it('shows loading while companies are pending', () => {
    renderHarness();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  it('redirects to /onboarding when the user has no companies', async () => {
    useMyCompaniesQueryMock.mockReturnValue({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [],
    });

    renderHarness();
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  it('renders child routes when the user has at least one company', async () => {
    useMyCompaniesQueryMock.mockReturnValue({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [{ id: 'c1', name: 'A' } as never],
    });

    renderHarness();
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument());
  });

  it('renders child routes on query error (fail open)', async () => {
    useMyCompaniesQueryMock.mockReturnValue({
      isPending: false,
      isSuccess: false,
      isError: true,
      data: undefined,
    });

    renderHarness();
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument());
  });
});
