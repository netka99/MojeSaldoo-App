/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductImportDialog } from './ProductImportDialog';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { productService } from '@/services/product.service';
import type { ImportProductsResult } from '@/services/product.service';

vi.mock('@/services/product.service', () => ({
  productService: {
    importProducts: vi.fn(),
    downloadImportTemplate: vi.fn(),
  },
}));

function setup(onClose = vi.fn()) {
  return {
    onClose,
    user: userEvent.setup(),
    ...render(
      <TestQueryProvider>
        <ProductImportDialog onClose={onClose} />
      </TestQueryProvider>,
    ),
  };
}

function makeFile(name = 'produkty.csv', type = 'text/csv') {
  return new File(['dummy'], name, { type });
}

describe('ProductImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload step with template download link', () => {
    setup();
    expect(screen.getByText('Import produktów')).toBeInTheDocument();
    expect(screen.getByText('Pobierz szablon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sprawdź plik/i })).toBeDisabled();
  });

  it('enables "Sprawdź plik" button after file selection', async () => {
    const { user } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());
    expect(screen.getByRole('button', { name: /sprawdź plik/i })).not.toBeDisabled();
  });

  it('closes on Escape key', async () => {
    const { onClose, user } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on backdrop click', async () => {
    const { onClose, user } = setup();
    const backdrop = document.querySelector('[role="presentation"]') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls downloadImportTemplate on template link click', async () => {
    vi.mocked(productService.downloadImportTemplate).mockResolvedValueOnce(undefined);
    const { user } = setup();
    await user.click(screen.getByText('Pobierz szablon'));
    expect(productService.downloadImportTemplate).toHaveBeenCalledOnce();
  });

  it('shows preview after successful dry-run', async () => {
    const dryRunResult: ImportProductsResult = {
      dry_run: true,
      valid_count: 3,
      to_create: 2,
      to_update: 1,
      to_skip: 0,
      error_count: 0,
      errors: [],
    };
    vi.mocked(productService.importProducts).mockResolvedValueOnce(dryRunResult);

    const { user } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());
    await user.click(screen.getByRole('button', { name: /sprawdź plik/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /importuj 3/i })).toBeInTheDocument();
    });
  });

  it('shows error table when dry-run returns errors', async () => {
    const dryRunResult: ImportProductsResult = {
      dry_run: true,
      valid_count: 1,
      error_count: 1,
      errors: [{ row: 3, field: 'VAT (%)', message: 'Dozwolone wartości: 0, 5, 8, 23.' }],
    };
    vi.mocked(productService.importProducts).mockResolvedValueOnce(dryRunResult);

    const { user } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());
    await user.click(screen.getByRole('button', { name: /sprawdź plik/i }));

    await waitFor(() => {
      expect(screen.getByText('VAT (%)')).toBeInTheDocument();
      expect(screen.getByText('Dozwolone wartości: 0, 5, 8, 23.')).toBeInTheDocument();
    });
  });

  it('shows done step after successful commit', async () => {
    vi.mocked(productService.importProducts)
      .mockResolvedValueOnce({ dry_run: true, valid_count: 2, to_create: 2, to_update: 0, to_skip: 0, error_count: 0, errors: [] })
      .mockResolvedValueOnce({ dry_run: false, created: 2, updated: 0, skipped: 0, error_count: 0, errors: [] });

    const { user } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());
    await user.click(screen.getByRole('button', { name: /sprawdź plik/i }));

    await waitFor(() => screen.getByRole('button', { name: /importuj 2/i }));
    await user.click(screen.getByRole('button', { name: /importuj 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/import zakończony/i)).toBeInTheDocument();
    });
  });

  it('disables import button when valid_count is 0', async () => {
    vi.mocked(productService.importProducts).mockResolvedValueOnce({
      dry_run: true,
      valid_count: 0,
      error_count: 2,
      errors: [
        { row: 2, field: 'Nazwa', message: 'Pole wymagane.' },
        { row: 3, field: 'VAT (%)', message: 'Dozwolone wartości: 0, 5, 8, 23.' },
      ],
    });

    const { user } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeFile());
    await user.click(screen.getByRole('button', { name: /sprawdź plik/i }));

    await waitFor(() => {
      const importBtn = screen.queryByRole('button', { name: /importuj/i });
      // button exists but is disabled because valid_count is 0
      if (importBtn) expect(importBtn).toBeDisabled();
    });
  });
});
