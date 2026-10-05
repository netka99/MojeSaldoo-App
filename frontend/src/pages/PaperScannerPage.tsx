/**
 * PaperScannerPage — upload / photograph a paper invoice, extract header fields
 * via backend OCR, then create a purchase document (FZ/PAR) and optionally a PZ
 * (goods receipt) from the scanned data.
 *
 * Route: /ksef/scan-paper
 * Module gate: ksef
 *
 * Architecture: one unified list of lines (UnifiedLine). Each line represents a
 * position on the document (for cost/VAT). If the user optionally assigns it to
 * a product in the catalog, that line also goes to PZ on save. No duplicate entry.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Navigate, useNavigate } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { useCreatePzMutation } from '@/query/use-delivery';
import { useAllSuppliersQuery } from '@/query/use-suppliers';
import { useKsefScanPaperMutation } from '@/query/use-invoices';
import { useCreatePurchaseDocumentMutation, useSetPurchaseDocCategoryMutation, useSetLinecategoriesMutation } from '@/query/use-purchase-documents';
import { useOpexCategoriesQuery } from '@/query/use-cashflow';
import { productService } from '@/services/product.service';
import { supplierService } from '@/services/supplier.service';
import { warehouseService } from '@/services/warehouse.service';
import { useSilentWarehouse } from '@/hooks/useSilentWarehouse';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { VatDeductionToggles, type VatDeduction } from '@/components/features/cashflow/VatDeductionToggles';
import { IosToggle } from '@/components/ui/IosToggle';
import type { PurchaseDocDocType } from '@/services/purchase-document.service';

function ocrDocToSubType(docType?: string): 'fz' | 'par' {
  if (!docType) return 'fz';
  if (docType === 'paragon') return 'par';
  return 'fz';
}

/* ── helpers ─────────────────────────────────────────────────────── */

/* ── types ───────────────────────────────────────────────────────── */

/**
 * Single unified line: represents one position on the document.
 * Used for cost/VAT (always) and optionally for PZ stock receipt
 * (when catalogProduct is assigned).
 */
interface UnifiedLine {
  id: number;
  product_name: string;
  quantity: string;
  unit: string;
  unit_price_gross: string;
  vat_rate: string;
  /** Raw string typed into the "Brutto razem" field — takes priority over computed display. */
  line_total_gross?: string;
}

/* ── icons ───────────────────────────────────────────────────────── */

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── ProductNameInput: text input with catalog autocomplete ──────── */

function ProductNameInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    try {
      const res = await productService.fetchList({ search: q, page_size: 8, is_active: true, ordering: 'name' });
      const names = res.results.map((p) => p.name);
      setSuggestions(names);
      if (names.length > 0) {
        const r = inputRef.current?.getBoundingClientRect();
        if (r) setDropStyle({ position: 'fixed', top: r.bottom + 2, left: r.left, width: r.width, zIndex: 9999 });
        setOpen(true);
      } else {
        setOpen(false);
      }
    } catch {
      setSuggestions([]); setOpen(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchSuggestions(v), 250);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Nazwa produktu"
        className="h-9 w-full rounded-lg border border-border bg-secondary px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && createPortal(
        <div
          style={dropStyle}
          className="overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(name); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-[13px] hover:bg-muted"
            >
              {name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── CategoryModal ───────────────────────────────────────────────── */

function CategoryModal({
  docId,
  items,
  categories,
  onSave,
  onSkip,
  saving,
}: {
  docId: string;
  items: Array<{ id: string; product_name: string }>;
  categories: Array<{ id: string; slug: string; name: string }>;
  onSave: (docCategory: string | null, lineCategories: Record<string, string>) => void;
  onSkip: () => void;
  saving: boolean;
}) {
  const [docCat, setDocCat] = useState('');
  const [lineCats, setLineCats] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((it) => [it.id, ''])),
  );

  // When doc category changes, apply to all lines that haven't been set individually
  const handleDocCat = (slug: string) => {
    setDocCat(slug);
    setLineCats((prev) =>
      Object.fromEntries(
        items.map((it) => [it.id, prev[it.id] || slug]),
      ),
    );
  };

  const handleSave = () => {
    const nonEmpty = Object.fromEntries(
      Object.entries(lineCats).filter(([, v]) => v),
    );
    onSave(docCat || null, nonEmpty);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card shadow-2xl max-h-[85vh] flex flex-col">
        {/* header */}
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-base font-semibold">Kategoria kosztów</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Przypisz kategorię, żeby dokument trafił do właściwej rubryki w KPiR.
          </p>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* document-level */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
              Cały dokument
            </label>
            <select
              value={docCat}
              onChange={(e) => handleDocCat(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— wybierz kategorię —</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* per-line (only if multiple lines or any differ) */}
          {items.length > 1 && (
            <div>
              <p className="mb-2 text-[12px] text-muted-foreground">
                Różne kategorie na pozycje (opcjonalnie):
              </p>
              <div className="space-y-2">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[13px]">{it.product_name}</span>
                    <select
                      value={lineCats[it.id] ?? ''}
                      onChange={(e) => setLineCats((prev) => ({ ...prev, [it.id]: e.target.value }))}
                      className="h-9 w-40 rounded-lg border border-border bg-secondary px-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">jak dokument</option>
                      {categories.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Pomiń
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !docCat}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Zapisuję…' : 'Zapisz kategorię'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── main page ───────────────────────────────────────────────────── */

export function PaperScannerPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  return <PaperScannerPageInner />;
}

function PaperScannerPageInner() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const createPz = useCreatePzMutation();
  const scanMutation = useKsefScanPaperMutation();
  const createPurchaseDoc = useCreatePurchaseDocumentMutation();
  const setCategoryMutation = useSetPurchaseDocCategoryMutation();
  const setLineCategoriesMutation = useSetLinecategoriesMutation();
  const { data: opexCategories = [] } = useOpexCategoriesQuery();

  /* ── stock vs cost-only ──────────────────────────────────────── */
  const purchasingEnabled = useModuleGuard('purchasing');
  const productionEnabled = useModuleGuard('production');
  const { silent, warehouseId: defaultWarehouseId } = useSilentWarehouse();
  const canAcceptToStock = purchasingEnabled || productionEnabled || !silent;
  const [acceptToStock, setAcceptToStock] = useState(true);

  /* ── image state ─────────────────────────────────────────────── */
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageFullscreen, setImageFullscreen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── extracted / editable header fields ─────────────────────── */
  const todayIso = new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(todayIso);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [sellerNip, setSellerNip] = useState('');
  const [notes, setNotes] = useState('');
  const [storedFilename, setStoredFilename] = useState('');

  /* ── purchase-doc specific state ────────────────────────────── */
  const [totalGross, setTotalGross] = useState('');
  const [totalNet, setTotalNet] = useState('');
  const [totalVat, setTotalVat] = useState('');
  const [vatDeduction, setVatDeduction] = useState<VatDeduction>('full');
  const [isPrivate, setIsPrivate] = useState(false);
  const [buyerNipWarning, setBuyerNipWarning] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ uuid: string; document_number: string; supplier_name: string } | null>(null);
  const [ocrParVat, setOcrParVat] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'transfer' | 'cash' | 'card'>('cash');
  const [docSubType, setDocSubType] = useState<'fz' | 'par'>('par');

  /* ── PZ / warehouse state ────────────────────────────────────── */
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [fromSupplierId, setFromSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierCreating, setSupplierCreating] = useState(false);
  const supplierRef = useRef<HTMLDivElement>(null);

  /* ── unified lines (one source of truth) ────────────────────── */
  const [unifiedLines, setUnifiedLines] = useState<UnifiedLine[]>([]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitErrorRef = useRef<HTMLParagraphElement>(null);
  const setSubmitErrorAndScroll = (msg: string | null) => {
    setSubmitError(msg);
    if (msg) setTimeout(() => submitErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const [scanError, setScanError] = useState<string | null>(null);
  const [sellerNameNormalized, setSellerNameNormalized] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  // Category modal state — shown after successful save
  const [categoryModal, setCategoryModal] = useState<{
    docId: string;
    items: Array<{ id: string; product_name: string }>;
  } | null>(null);

  /* warehouses */
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!companyId) return;
    warehouseService
      .fetchList({ page_size: 100, is_active: true })
      .then((res) => setWarehouses(res.results.map((w) => ({ id: w.id, name: w.name }))))
      .catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (defaultWarehouseId && !toWarehouseId) setToWarehouseId(defaultWarehouseId);
  }, [defaultWarehouseId, toWarehouseId]);

  /* suppliers */
  const { data: suppliers = [] } = useAllSuppliersQuery(Boolean(companyId));

  /* close supplier dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) {
        setSupplierOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── sum mismatch detection ──────────────────────────────────── */
  const linesGrossTotal = unifiedLines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.unit_price_gross) || 0;
    return sum + qty * price;
  }, 0);
  const docGross = parseFloat(totalGross) || 0;
  const sumMismatch =
    unifiedLines.length > 0 && docGross > 0 && Math.abs(linesGrossTotal - docGross) > 0.02;

  /* ── image selection ─────────────────────────────────────────── */
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    // Clear all form state so previous scan doesn't bleed into new document
    setScanError(null);
    setSubmitError(null);
    setFormVisible(true);
    setInvoiceNumber('');
    setSellerName('');
    setSellerNip('');
    setSellerNameNormalized(false);
    setSupplierSearch('');
    setFromSupplierId('');
    setNotes('');
    setIssueDate(todayIso);
    setUnifiedLines([]);
    setTotalGross('');
    setTotalNet('');
    setTotalVat('');
    setStoredFilename('');
    setOcrParVat(false);
    setBuyerNipWarning(null);
    setDuplicateWarning(null);
    setVatDeduction('full');
    setIsPrivate(false);
  };

  /* ── OCR scan ────────────────────────────────────────────────── */
  const onScan = async () => {
    if (!imageFile) return;
    setScanError(null);
    setSubmitError(null);
    try {
      const result = await scanMutation.mutateAsync(imageFile);
      if (result.invoice_number) setInvoiceNumber(result.invoice_number);
      if (result.seller_name) setSellerName(result.seller_name);
      setSellerNameNormalized(result.seller_name_normalized ?? false);
      if (result.seller_nip) setSellerNip(result.seller_nip);
      if (result.issue_date) setIssueDate(result.issue_date);
      if (result.invoice_number) setNotes(`Skan: ${result.invoice_number}`);
      if (result.seller_name) setSupplierSearch(result.seller_name);
      if (result.total_gross) setTotalGross(result.total_gross);
      if (result.total_net) setTotalNet(result.total_net);
      if (result.total_vat) setTotalVat(result.total_vat);
      if (result.stored_filename) setStoredFilename(result.stored_filename);
      if (result.doc_type) setDocSubType(ocrDocToSubType(result.doc_type));
      const parVat = Boolean(result.buyer_nip_matches_company);
      setOcrParVat(parVat);
      if (result.buyer_nip && result.buyer_nip_matches_company === false) {
        setBuyerNipWarning('Na dokumencie jest inny NIP nabywcy niż NIP tej firmy — VAT nie zostanie odliczony.');
      } else {
        setBuyerNipWarning(null);
      }
      if (result.possible_duplicate) {
        setDuplicateWarning(result.possible_duplicate);
      } else {
        setDuplicateWarning(null);
      }
      if (result.lines?.length) {
        setUnifiedLines(result.lines.map((l, i) => ({
          id: i,
          product_name: l.name,
          quantity: l.quantity || '1',
          unit: l.unit || 'szt',
          unit_price_gross: l.unit_price || '',
          vat_rate: l.vat_rate || '',
        })));
        // keep acceptToStock as whatever user set (or default true)
      } else {
        setUnifiedLines([]);
        // don't touch acceptToStock — preserve user's selection
      }
    } catch {
      setScanError('Nie udało się przetworzyć obrazu. Wypełnij pola ręcznie.');
    }
  };

  /* ── line management ─────────────────────────────────────────── */
  const updateLine = (id: number, field: keyof Omit<UnifiedLine, 'id'>, value: string) => {
    setUnifiedLines((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      // When directly editing unit price, clear the total override
      if (field === 'unit_price_gross') return { ...l, [field]: value, line_total_gross: undefined };
      // When editing quantity while a total override exists, recompute unit price from that total
      if (field === 'quantity' && l.line_total_gross !== undefined) {
        const qty = parseFloat(value) || 1;
        const total = parseFloat(l.line_total_gross) || 0;
        return { ...l, quantity: value, unit_price_gross: (total / qty).toFixed(4) };
      }
      return { ...l, [field]: value };
    }));
  };

  const removeLine = (id: number) => {
    setUnifiedLines((prev) => prev.filter((l) => l.id !== id));
  };

  /* ── submit: always cost doc, optionally PZ ──────────────────── */
  const onSubmitAll = async () => {
    setSubmitError(null);
    const takeStock = canAcceptToStock && acceptToStock && !isPrivate;
    if (takeStock && !toWarehouseId) {
      setSubmitErrorAndScroll(silent ? 'Brak magazynu głównego — odśwież stronę i spróbuj ponownie.' : 'Wybierz magazyn docelowy.');
      return;
    }

    const filledLines = unifiedLines.filter((l) => l.product_name.trim());

    const missingVat = filledLines.filter((l) => l.vat_rate === '');
    const missingQty = filledLines.filter((l) => !parseFloat(l.quantity));
    const missingPrice = filledLines.filter((l) => !parseFloat(l.unit_price_gross));
    const invalid = [
      missingVat.length > 0 && `brak VAT: ${missingVat.map((l) => l.product_name || '(bez nazwy)').join(', ')}`,
      missingQty.length > 0 && `brak ilości: ${missingQty.map((l) => l.product_name || '(bez nazwy)').join(', ')}`,
      missingPrice.length > 0 && `brak ceny: ${missingPrice.map((l) => l.product_name || '(bez nazwy)').join(', ')}`,
    ].filter(Boolean);
    if (invalid.length > 0) {
      setSubmitErrorAndScroll(`Uzupełnij pozycje — ${invalid.join(' · ')}`);
      return;
    }

    const isParWithCompanyNip = docSubType === 'par' && ocrParVat;
    const docType: PurchaseDocDocType = docSubType === 'par' ? (isParWithCompanyNip ? 'PAR_VAT' : 'PAR') : 'FZ';

    let savedDoc: { id: string; items?: { id: string; product_name: string }[] } | null = null;
    try {
      savedDoc = await createPurchaseDoc.mutateAsync({
        doc_type: docType,
        supplier_name: sellerName,
        supplier_nip: sellerNip,
        document_number: invoiceNumber,
        issue_date: issueDate || null,
        payment_method: paymentMethod,
        total_gross: totalGross || '0.00',
        total_net: totalNet || '0.00',
        total_vat: totalVat || '0.00',
        vat_deduction: isPrivate ? 'none' : docType === 'PAR' ? 'none' : vatDeduction,
        is_private: isPrivate,
        notes: notes.trim(),
        ocr_raw_filename: storedFilename || imageFile?.name || '',
        ...(filledLines.length > 0 && {
          items_write: filledLines.map((l) => ({
            product_name: l.product_name,
            unit: l.unit || 'szt',
            quantity: l.quantity || '1',
            unit_price_gross: l.unit_price_gross || '0',
            vat_rate: l.vat_rate || '',
          })),
        }),
      });
    } catch (e: unknown) {
      setSubmitErrorAndScroll(e instanceof Error ? e.message : 'Nie udało się zapisać dokumentu.');
      return;
    }

    if (takeStock && filledLines.length > 0) {
      // Auto-resolve each line to a catalog product: search by name, create if not found
      const resolvedItems: { product_id: string; quantity_planned: string; unit_cost?: string }[] = [];
      for (const line of filledLines) {
        const qty = parseFloat(line.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        try {
          const results = await productService.fetchList({ search: line.product_name.trim(), page_size: 1, is_active: true });
          let productId: string;
          if (results.results.length > 0) {
            productId = results.results[0].id;
          } else {
            const created = await productService.createItem({
              name: line.product_name.trim(),
              description: null, unit: line.unit || 'szt',
              price_net: '0.00', price_gross: '0.00', vat_rate: '23',
              sku: null, barcode: null, pkwiu: '', track_batches: false,
              min_stock_alert: '0', shelf_life_days: null, is_resalable: false,
              markup_percent: null, avg_cost: null, avg_cost_source: null,
              avg_cost_updated_at: null, last_cost: null, is_active: true, is_service: false,
            });
            productId = created.id;
          }
          resolvedItems.push({
            product_id: productId,
            quantity_planned: qty.toFixed(2),
            unit_cost: line.unit_price_gross ? parseFloat(line.unit_price_gross).toFixed(4) : undefined,
          });
        } catch {
          // skip lines that fail to resolve — don't block the whole PZ
        }
      }

      if (resolvedItems.length > 0) {
        try {
          await createPz.mutateAsync({
            to_warehouse_id: toWarehouseId,
            from_supplier_id: fromSupplierId || null,
            issue_date: issueDate,
            notes: notes.trim() || undefined,
            items: resolvedItems,
          });
        } catch (e: unknown) {
          const msg =
            e instanceof Error ? e.message
            : typeof e === 'object' && e !== null && 'detail' in e
              ? String((e as { detail: unknown }).detail)
              : 'Nie udało się przyjąć towaru na stan.';
          setSubmitErrorAndScroll(`Zapisano koszt, ale nie przyjęto na stan: ${msg}`);
          return;
        }
      }
    }

    // Open category modal before navigating away
    if (savedDoc) {
      setCategoryModal({
        docId: savedDoc.id,
        items: (savedDoc.items ?? []).map((it) => ({ id: it.id, product_name: it.product_name })),
      });
    } else {
      navigate('/purchase-documents');
    }
  };

  /* ── category modal handlers ─────────────────────────────────── */
  const handleCategorySave = async (docCategory: string | null, lineCategories: Record<string, string>) => {
    if (!categoryModal) return;
    try {
      if (docCategory) {
        await setCategoryMutation.mutateAsync({ id: categoryModal.docId, category: docCategory });
      }
      if (Object.keys(lineCategories).length > 0) {
        await setLineCategoriesMutation.mutateAsync({ id: categoryModal.docId, lineCategories });
      }
    } finally {
      setCategoryModal(null);
      navigate(`/purchase-documents?newDoc=${categoryModal.docId}`);
    }
  };

  const handleCategorySkip = () => {
    const docId = categoryModal?.docId;
    setCategoryModal(null);
    navigate(`/purchase-documents?newDoc=${docId ?? ''}`);
  };

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <>
    <div className="min-h-screen bg-background pb-32">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-4 pb-3 pt-10">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.92 }}
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
              aria-label="Wróć"
            >
              <ChevronLeftIcon />
            </motion.button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Skanuj fakturę papierową</h1>
              <p className="text-[13px] text-muted-foreground">Zrób zdjęcie lub wgraj plik — pola zostaną wypełnione automatycznie</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── fullscreen image lightbox ─────────────────────────────── */}
      {imageFullscreen && imagePreviewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setImageFullscreen(false)}
        >
          <img
            src={imagePreviewUrl}
            alt="Powiększony podgląd faktury"
            className="max-h-full max-w-full object-contain"
            style={{ touchAction: 'pinch-zoom' }}
          />
          <button
            type="button"
            onClick={() => setImageFullscreen(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            aria-label="Zamknij"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {/* ── image upload ────────────────────────────────────────── */}
        <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
          <h2 className="mb-4 text-[15px] font-semibold text-foreground">Zdjęcie dokumentu</h2>

          {imagePreviewUrl ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setImageFullscreen(true)}
                className="relative w-full cursor-zoom-in"
                aria-label="Powiększ zdjęcie"
              >
                <img
                  src={imagePreviewUrl}
                  alt="Podgląd faktury"
                  className="max-h-64 w-full rounded-xl object-contain border border-border bg-muted"
                />
                <span className="absolute bottom-2 right-2 rounded-lg bg-black/50 px-2 py-1 text-[11px] text-white">
                  Dotknij, aby powiększyć
                </span>
              </button>
              {imageFile && (
                <p className="text-[12px] text-muted-foreground truncate">
                  <span className="font-medium">Plik:</span> {imageFile.name}
                  <span className="ml-2 text-muted-foreground/60">({(imageFile.size / 1024).toFixed(0)} KB)</span>
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Zmień zdjęcie
                </button>
                <button
                  type="button"
                  onClick={() => void onScan()}
                  disabled={scanMutation.isPending}
                  className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {scanMutation.isPending ? 'Skanuję…' : 'Odczytaj dane (OCR)'}
                </button>
              </div>
              {scanError && (
                <p className="text-[13px] text-amber-600">{scanError}</p>
              )}
              {scanMutation.isSuccess && (
                <p className="text-[13px] text-green-600">Dane odczytane — sprawdź i uzupełnij poniżej.</p>
              )}
              <p className="text-[11px] text-muted-foreground/70">
                Zdjęcie jest używane wyłącznie do odczytu danych i nie jest przechowywane na serwerze.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5"
            >
              <UploadIcon />
              <span className="text-sm font-medium">Kliknij, aby wybrać zdjęcie lub plik PDF</span>
              <span className="text-xs">JPG, PNG, WEBP, PDF</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                <CameraIcon />
                Na telefonie: aparat uruchomi się automatycznie
              </span>
            </button>
          )}

          {/* hidden file input — no capture so user can choose camera or gallery */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onFileChange}
            aria-label="Wybierz zdjęcie faktury"
          />
        </section>

        {/* ── extracted header fields ──────────────────────────────── */}
        {formVisible && (
          <>
            {submitError && (
              <p
                ref={submitErrorRef}
                className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {submitError}
              </p>
            )}

            <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
              <h2 className="mb-4 text-[15px] font-semibold text-foreground">Dane dokumentu</h2>

              <div className="space-y-4">
                {/* warehouse — only when accepting to stock and managing locations */}
                {canAcceptToStock && acceptToStock && !silent && !isPrivate && (
                  <div>
                    <label htmlFor="to_warehouse" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                      Magazyn docelowy <span className="text-destructive">*</span>
                    </label>
                    <select
                      id="to_warehouse"
                      value={toWarehouseId}
                      onChange={(e) => setToWarehouseId(e.target.value)}
                      className={cn(
                        'h-10 w-full rounded-xl border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30',
                        !toWarehouseId ? 'border-destructive/40' : 'border-border',
                      )}
                    >
                      <option value="">— wybierz magazyn —</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* supplier combobox */}
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Dostawca
                  </label>
                  <div ref={supplierRef} className="relative">
                    {fromSupplierId ? (
                      <div className="flex h-10 items-center justify-between rounded-xl border border-border bg-secondary px-3">
                        <span className="text-sm text-foreground">
                          {suppliers.find((s) => s.id === fromSupplierId)?.name ?? supplierSearch}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setFromSupplierId(''); setSupplierSearch(''); }}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="Szukaj lub utwórz dostawcę…"
                        value={supplierSearch}
                        onChange={(e) => { setSupplierSearch(e.target.value); setSupplierOpen(true); }}
                        onFocus={() => setSupplierOpen(true)}
                        className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    )}
                    {supplierOpen && !fromSupplierId && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                        <button
                          type="button"
                          onClick={() => { setFromSupplierId(''); setSupplierOpen(false); setSupplierSearch(''); }}
                          className="flex w-full items-center px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
                        >
                          — brak / nieznany —
                        </button>
                        {suppliers
                          .filter((s) => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                          .map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => { setFromSupplierId(s.id); setSupplierSearch(s.name); setSupplierOpen(false); }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                              <span>{s.name}</span>
                              <CheckIcon />
                            </button>
                          ))}
                        {supplierSearch.trim() && (
                          <button
                            type="button"
                            disabled={supplierCreating}
                            onClick={async () => {
                              setSupplierCreating(true);
                              try {
                                const newS = await supplierService.createItem({
                                  name: supplierSearch.trim(),
                                  nip: sellerNip || undefined,
                                });
                                setFromSupplierId(newS.id);
                                setSupplierSearch(newS.name);
                                setSupplierOpen(false);
                              } catch {
                                // ignore
                              } finally {
                                setSupplierCreating(false);
                              }
                            }}
                            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
                          >
                            <span className="text-lg leading-none">+</span>
                            {supplierCreating ? 'Tworzę…' : `Utwórz: „${supplierSearch.trim()}"`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* issue date */}
                <div>
                  <label htmlFor="issue_date" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Data wystawienia
                  </label>
                  <input
                    id="issue_date"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* invoice number */}
                <div>
                  <label htmlFor="invoice_number" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Numer faktury
                  </label>
                  <input
                    id="invoice_number"
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="np. FV/2026/001"
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* seller NIP */}
                <div>
                  <label htmlFor="seller_nip" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    NIP dostawcy
                  </label>
                  <input
                    id="seller_nip"
                    type="text"
                    value={sellerNip}
                    onChange={(e) => setSellerNip(e.target.value)}
                    placeholder="10 cyfr"
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {docSubType === 'par' && (
                    <p className="mt-1 text-[11px]">
                      {ocrParVat
                        ? <span className="font-medium text-orange-600">→ Paragon z NIP tej firmy — odliczenie VAT</span>
                        : <span className="text-muted-foreground">→ Paragon bez NIP nabywcy — koszt, bez odliczenia VAT</span>
                      }
                    </p>
                  )}
                </div>

                {/* seller name */}
                <div>
                  <label htmlFor="seller_name" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Nazwa dostawcy
                  </label>
                  <input
                    id="seller_name"
                    type="text"
                    value={sellerName}
                    onChange={(e) => { setSellerName(e.target.value); setSellerNameNormalized(false); }}
                    placeholder="np. Firma ABC Sp. z o.o."
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {sellerNameNormalized && (
                    <p className="mt-1 text-[12px] text-amber-600">
                      Nazwa uzupełniona automatycznie na podstawie NIP — sprawdź, czy jest prawidłowa.
                    </p>
                  )}
                </div>

                {/* notes */}
                <div>
                  <label htmlFor="notes" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Notatki
                  </label>
                  <input
                    id="notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opcjonalnie"
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                {/* totals */}
                <div>
                  <label htmlFor="total_gross" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Kwota brutto (PLN) <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="total_gross"
                    type="number"
                    min="0"
                    step="0.01"
                    value={totalGross}
                    onChange={(e) => setTotalGross(e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="0.00"
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="total_net" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                      Netto
                    </label>
                    <input
                      id="total_net"
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalNet}
                      onChange={(e) => setTotalNet(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0.00"
                      className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="total_vat" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                      VAT
                    </label>
                    <input
                      id="total_vat"
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalVat}
                      onChange={(e) => setTotalVat(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0.00"
                      className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                {buyerNipWarning && (
                  <p className="text-[13px] text-amber-600">{buyerNipWarning}</p>
                )}

                {duplicateWarning && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
                    <p className="text-[13px] font-semibold text-amber-800">
                      ⚠ Ten dokument już jest w systemie
                    </p>
                    <p className="text-[12px] text-amber-700">
                      {duplicateWarning.supplier_name && `${duplicateWarning.supplier_name} · `}
                      Nr: {duplicateWarning.document_number}
                    </p>
                    <div className="flex items-center gap-3 pt-1">
                      <a
                        href="/purchase-documents"
                        className="text-[12px] font-medium text-amber-800 underline"
                      >
                        Przejdź do istniejącego →
                      </a>
                      <button
                        type="button"
                        onClick={() => setDuplicateWarning(null)}
                        className="text-[12px] text-amber-600 hover:text-amber-800 underline"
                      >
                        Mimo to dodaj nowy
                      </button>
                    </div>
                  </div>
                )}

                {docSubType !== 'par' || ocrParVat ? (
                  <VatDeductionToggles
                    deduction={vatDeduction}
                    isPrivate={isPrivate}
                    hidePrivate
                    onDeductionChange={setVatDeduction}
                    onPrivateChange={(v) => {
                      setIsPrivate(v);
                      if (v) setAcceptToStock(false);
                    }}
                  />
                ) : (
                  <VatDeductionToggles
                    deduction="none"
                    isPrivate={isPrivate}
                    hidePassengerCar
                    hidePrivate
                    onDeductionChange={setVatDeduction}
                    onPrivateChange={(v) => {
                      setIsPrivate(v);
                      if (v) setAcceptToStock(false);
                    }}
                  />
                )}

                <div>
                  <label htmlFor="payment_method" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                    Sposób płatności
                  </label>
                  <select
                    id="payment_method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as 'transfer' | 'cash' | 'card')}
                    className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="transfer">Przelew</option>
                    <option value="cash">Gotówka</option>
                    <option value="card">Karta</option>
                  </select>
                </div>

                {/* Doc sub-type override */}
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Typ dokumentu</p>
                  <div className="flex gap-2">
                    {([
                      { v: 'fz' as const, label: 'Faktura (FZ)' },
                      { v: 'par' as const, label: 'Paragon' },
                    ]).map(({ v, label }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setDocSubType(v)}
                        className={cn(
                          'flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium transition-all',
                          docSubType === v
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-secondary text-foreground hover:border-primary/40',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {docSubType === 'fz' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">→ Faktura zakupowa — znajdziesz ją w zakładce <strong>Faktury i PAR z NIP</strong></p>
                  )}
                </div>

                {canAcceptToStock && !isPrivate && (
                  <IosToggle
                    checked={acceptToStock}
                    onChange={setAcceptToStock}
                    label="Przyjmij towar na stan"
                    description="Wyłącz przy gazie, prądzie, paliwie, usłudze."
                  />
                )}
              </div>
            </section>

            {/* ── pozycje dokumentu ────────────────────────────────── */}
            <section className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[15px] font-semibold text-foreground">Pozycje</h2>
                </div>
                <div className="flex items-center gap-2">
                  {/* Bulk VAT setter */}
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1.5">
                    <span className="text-[12px] font-medium text-muted-foreground">VAT dla wszystkich:</span>
                    <select
                      className="bg-transparent text-[12px] font-semibold text-foreground focus:outline-none cursor-pointer"
                      defaultValue=""
                      onChange={(e) => {
                        const rate = e.target.value;
                        if (!rate) return;
                        setUnifiedLines((prev) => prev.map((l) => ({ ...l, vat_rate: rate })));
                        e.target.value = '';
                      }}
                    >
                      <option value="" disabled>wybierz…</option>
                      <option value="23">23%</option>
                      <option value="8">8%</option>
                      <option value="5">5%</option>
                      <option value="0">0%</option>
                      <option value="zw">zw</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUnifiedLines((prev) => [
                      ...prev,
                      { id: Date.now(), product_name: '', quantity: '1', unit: 'szt', unit_price_gross: '', vat_rate: '' },
                    ])}
                    className="rounded-lg border border-dashed border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    + Dodaj pozycję
                  </button>
                </div>
              </div>

              {/* sum mismatch alert */}
              {sumMismatch && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                  <span className="mt-0.5 shrink-0 text-base leading-none">⚠</span>
                  <span>
                    Suma pozycji ({linesGrossTotal.toFixed(2)} PLN) nie zgadza się z kwotą brutto dokumentu ({docGross.toFixed(2)} PLN).
                    Prawdopodobnie OCR nie wykrył wszystkich pozycji — dodaj brakujące ręcznie.
                  </span>
                </div>
              )}

              {unifiedLines.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Brak pozycji — kliknij „Odczytaj dane (OCR)" lub dodaj ręcznie.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[700px] space-y-2">
                    <div className="grid grid-cols-[minmax(160px,1fr)_4rem_3.5rem_4.5rem_4rem_4.5rem_4rem_4.5rem_2rem] gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Nazwa</span>
                      <span>Ilość</span>
                      <span>J.m.</span>
                      <span>Cena br./szt</span>
                      <span>VAT %</span>
                      <span className="text-right">Netto</span>
                      <span className="text-right">VAT zł</span>
                      <span className="text-right">Brutto razem</span>
                      <span />
                    </div>
                    {unifiedLines.map((line) => {
                      const qty = parseFloat(line.quantity) || 0;
                      const price = parseFloat(line.unit_price_gross) || 0;
                      const vat = parseFloat(line.vat_rate) || 0;
                      const lineTotal = qty * price;
                      const lineNet = lineTotal / (1 + vat / 100);
                      const lineVat = lineTotal - lineNet;
                      const lineNetStr = lineTotal > 0 ? lineNet.toFixed(2) : '—';
                      const lineVatStr = lineTotal > 0 ? lineVat.toFixed(2) : '—';
                      // Use raw typed total if available, otherwise derive from unit price
                      const lineTotalDisplay = line.line_total_gross !== undefined
                        ? line.line_total_gross
                        : (lineTotal > 0 ? lineTotal.toFixed(2) : '');
                      return (
                        <div key={line.id} className="grid grid-cols-[minmax(160px,1fr)_4rem_3.5rem_4.5rem_4rem_4.5rem_4rem_4.5rem_2rem] gap-1.5 items-start">
                          <ProductNameInput
                            value={line.product_name}
                            onChange={(name) => updateLine(line.id, 'product_name', name)}
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                            onWheel={(e) => e.currentTarget.blur()}
                            className={`h-9 rounded-lg border px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                              !parseFloat(line.quantity)
                                ? 'border-destructive bg-destructive/10 text-destructive placeholder:text-destructive/50'
                                : 'border-border bg-secondary text-foreground'
                            }`}
                          />
                          <input
                            type="text"
                            value={line.unit}
                            onChange={(e) => updateLine(line.id, 'unit', e.target.value)}
                            placeholder="szt"
                            className="h-9 rounded-lg border border-border bg-secondary px-2.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_price_gross}
                            onChange={(e) => updateLine(line.id, 'unit_price_gross', e.target.value)}
                            onWheel={(e) => e.currentTarget.blur()}
                            placeholder="0.00"
                            className={`h-9 rounded-lg border px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                              !parseFloat(line.unit_price_gross)
                                ? 'border-destructive bg-destructive/10 text-destructive placeholder:text-destructive/50'
                                : 'border-border bg-secondary text-foreground'
                            }`}
                          />
                          <select
                            value={line.vat_rate}
                            onChange={(e) => updateLine(line.id, 'vat_rate', e.target.value)}
                            className={`h-9 rounded-lg border px-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                              line.vat_rate === ''
                                ? 'border-destructive bg-destructive/10 text-destructive'
                                : 'border-border bg-secondary text-foreground'
                            }`}
                          >
                            <option value="" disabled>VAT?</option>
                            <option value="0">0%</option>
                            <option value="5">5%</option>
                            <option value="8">8%</option>
                            <option value="23">23%</option>
                          </select>
                          <span className="pt-2 text-right text-[12px] tabular-nums text-muted-foreground">
                            {lineNetStr}
                          </span>
                          <span className="pt-2 text-right text-[12px] tabular-nums text-muted-foreground">
                            {lineVatStr}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={lineTotalDisplay}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const total = parseFloat(raw);
                              const q = parseFloat(line.quantity) || 1;
                              // Store raw string so typing "5." doesn't get replaced mid-entry
                              setUnifiedLines((prev) => prev.map((l) => {
                                if (l.id !== line.id) return l;
                                if (raw === '') return { ...l, line_total_gross: undefined, unit_price_gross: '' };
                                const newPrice = !isNaN(total) ? (total / q).toFixed(4) : l.unit_price_gross;
                                return { ...l, line_total_gross: raw, unit_price_gross: newPrice };
                              }));
                            }}
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                const rounded = val.toFixed(2);
                                const q = parseFloat(line.quantity) || 1;
                                setUnifiedLines((prev) => prev.map((l) =>
                                  l.id === line.id
                                    ? { ...l, line_total_gross: rounded, unit_price_gross: (val / q).toFixed(4) }
                                    : l
                                ));
                              }
                            }}
                            placeholder="0.00"
                            title="Wpisz kwotę brutto całej pozycji — cena/szt zostanie obliczona automatycznie"
                            className="h-9 rounded-lg border border-primary/40 bg-primary/5 px-2 text-right text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="flex h-9 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="Usuń pozycję"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}

                    {/* Suma kontrolna */}
                    {unifiedLines.length > 0 && (() => {
                      const totals = unifiedLines.reduce((acc, l) => {
                        const qty = parseFloat(l.quantity) || 0;
                        const price = parseFloat(l.unit_price_gross) || 0;
                        const vat = parseFloat(l.vat_rate) || 0;
                        const gross = qty * price;
                        const net = gross / (1 + vat / 100);
                        return { gross: acc.gross + gross, net: acc.net + net, vat: acc.vat + (gross - net) };
                      }, { gross: 0, net: 0, vat: 0 });
                      return (
                        <div className="mt-2 flex justify-end gap-6 border-t border-border pt-2">
                          <span className="text-[13px] text-muted-foreground">
                            Netto: <span className="font-semibold tabular-nums text-foreground">{totals.net.toFixed(2)} PLN</span>
                          </span>
                          <span className="text-[13px] text-muted-foreground">
                            VAT: <span className="font-semibold tabular-nums text-foreground">{totals.vat.toFixed(2)} PLN</span>
                          </span>
                          <span className="text-[13px] text-muted-foreground">
                            Brutto: <span className="font-bold tabular-nums text-foreground">{totals.gross.toFixed(2)} PLN</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </section>

            {/* ── submit ───────────────────────────────────────────── */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={() => void onSubmitAll()}
                disabled={createPurchaseDoc.isPending || createPz.isPending || !!duplicateWarning}
                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
              >
                {createPurchaseDoc.isPending || createPz.isPending
                  ? 'Zapisuję…'
                  : docSubType === 'par' && ocrParVat
                    ? 'Zapisz PAR z NIP'
                    : docSubType === 'par'
                      ? 'Zapisz paragon'
                      : 'Zapisz fakturę'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
    {categoryModal && (
      <CategoryModal
        docId={categoryModal.docId}
        items={categoryModal.items}
        categories={opexCategories}
        onSave={(docCat, lineCats) => void handleCategorySave(docCat, lineCats)}
        onSkip={handleCategorySkip}
        saving={setCategoryMutation.isPending || setLineCategoriesMutation.isPending}
      />
    )}
    </>
  );
}
