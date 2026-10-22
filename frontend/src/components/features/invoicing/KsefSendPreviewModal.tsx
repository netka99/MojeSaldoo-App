import { Button } from '@/components/ui/Button';
import type { InvoicePreviewPayload } from '@/types';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
function fmtDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : plDate.format(d);
}

interface Props {
  preview: InvoicePreviewPayload;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function KsefSendPreviewModal({ preview, onConfirm, onCancel, loading = false }: Props) {
  const { invoice, totals, company, customer } = preview;
  const sellerName = company?.name ?? preview.seller.name;
  const sellerNip = company?.nip ?? preview.seller.nip ?? '—';
  const buyerName = customer?.name ?? preview.buyer.name;
  const buyerNip = customer?.nip ?? preview.buyer.nip ?? '—';

  const annotations = [
    invoice.annotation_mpp && 'MPP',
    invoice.annotation_kasowa && 'Kasowa',
    invoice.annotation_odwrotne && 'Odwrotne obciążenie',
    invoice.annotation_zwolnienie && 'Zwolnienie z VAT',
    invoice.annotation_marza && 'Marża',
    invoice.annotation_tp && 'Podmioty powiązane (TP)',
    invoice.annotation_fp && 'Faktura uproszczona (FP)',
    invoice.annotation_oss && 'OSS',
  ].filter(Boolean) as string[];

  const lines = preview.items ?? preview.lines ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ksef-preview-title"
    >
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="ksef-preview-title" className="text-base font-semibold text-slate-900">
          Podgląd danych przed wysłaniem do KSeF
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Sprawdź czy poniższe dane są poprawne. Po wysłaniu nie można edytować faktury.
        </p>

        <div className="mt-4 space-y-4 text-sm">

          {/* Nagłówek */}
          <Section title="Dokument">
            <Row label="Numer faktury" value={invoice.invoice_number || '—'} />
            <Row label="Typ" value={invoice.ksef_invoice_type ?? 'VAT'} />
            <Row label="Data wystawienia" value={fmtDate(invoice.issue_date)} />
            <Row label="Data sprzedaży" value={fmtDate(invoice.sale_date)} />
            {invoice.sale_date_to && (
              <Row label="Data sprzedaży do" value={fmtDate(invoice.sale_date_to)} />
            )}
            <Row label="Waluta" value={preview.meta?.currency ?? 'PLN'} />
          </Section>

          {/* Sprzedawca */}
          <Section title="Sprzedawca">
            <Row label="Nazwa" value={sellerName} />
            <Row label="NIP" value={sellerNip} />
          </Section>

          {/* Nabywca */}
          <Section title="Nabywca">
            <Row label="Nazwa" value={buyerName} />
            <Row label="NIP" value={buyerNip} />
          </Section>

          {/* Pozycje */}
          <Section title={`Pozycje (${lines.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-1 pr-3 font-medium">Nazwa</th>
                    <th className="pb-1 pr-3 text-right font-medium">Ilość</th>
                    <th className="pb-1 pr-3 text-right font-medium">VAT</th>
                    <th className="pb-1 text-right font-medium">Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const name = 'product_name' in l ? l.product_name : l.product_name;
                    const qty = 'quantity' in l ? l.quantity : '—';
                    const vat = 'vat_rate' in l ? l.vat_rate : '—';
                    const gross = 'line_gross' in l ? l.line_gross : '—';
                    return (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 pr-3">{name}</td>
                        <td className="py-1 pr-3 text-right">{qty}</td>
                        <td className="py-1 pr-3 text-right">{vat}%</td>
                        <td className="py-1 text-right">{gross}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Kwota */}
          {totals && (
            <Section title="Kwota">
              <Row label="Netto" value={`${totals.subtotal_net} ${preview.meta?.currency ?? 'PLN'}`} />
              <Row label="VAT" value={`${totals.vat_amount} ${preview.meta?.currency ?? 'PLN'}`} />
              <Row label="Brutto łącznie" value={`${totals.total_gross} ${preview.meta?.currency ?? 'PLN'}`} bold />
            </Section>
          )}

          {/* Płatność */}
          <Section title="Płatność">
            <Row label="Forma" value={invoice.payment_method_label} />
            <Row
              label="Termin"
              value={invoice.due_date_description || fmtDate(invoice.due_date)}
            />
            {company?.bank_account_iban && (
              <Row label="IBAN" value={company.bank_account_iban} />
            )}
          </Section>

          {/* Adnotacje */}
          {annotations.length > 0 && (
            <Section title="Adnotacje">
              <div className="flex flex-wrap gap-1.5">
                {annotations.map((a) => (
                  <span key={a} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {a}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Dodatkowe informacje */}
          {invoice.additional_info && invoice.additional_info.length > 0 && (
            <Section title="Dodatkowe informacje (DodatkowyOpis)">
              {invoice.additional_info.map((r, i) => (
                <Row key={i} label={r.label} value={r.value} />
              ))}
            </Section>
          )}

          {/* WZ */}
          {invoice.show_wz_numbers && invoice.wz_numbers && invoice.wz_numbers.length > 0 && (
            <Section title="Dokumenty WZ">
              <p className="text-slate-700">{invoice.wz_numbers.join(', ')}</p>
            </Section>
          )}

          {/* Uwagi */}
          {invoice.notes && (
            <Section title="Uwagi">
              <p className="whitespace-pre-wrap text-slate-700">{invoice.notes}</p>
            </Section>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <Button
            type="button"
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
          >
            Wyślij do KSeF
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Wróć
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1.5">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={bold ? 'font-semibold text-slate-900' : 'text-right text-slate-800'}>
        {value}
      </span>
    </div>
  );
}
