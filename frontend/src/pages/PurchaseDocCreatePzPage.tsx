import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseDocumentService } from '@/services/purchase-document.service';
import { usePurchaseDocumentQuery } from '@/query/use-purchase-documents';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import { purchaseDocumentKeys } from '@/query/keys';

export function PurchaseDocCreatePzPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: doc, isLoading: docLoading } = usePurchaseDocumentQuery(id);
  const { data: warehousePage, isLoading: whLoading } = useWarehouseListQuery(1);
  const warehouses = warehousePage?.results ?? [];

  const [warehouseId, setWarehouseId] = useState('');

  const createPz = useMutation({
    mutationFn: ({ docId, whId }: { docId: string; whId: string }) =>
      purchaseDocumentService.createPz(docId, whId),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
      const pzDocs = res.data.pz_documents ?? [];
      const pzId = pzDocs[pzDocs.length - 1]?.id ?? res.data.pz_id;
      if (pzId) {
        navigate(`/delivery/${pzId}`);
      } else {
        navigate('/purchase-documents');
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const whId = warehouseId || warehouses[0]?.id;
    if (!id || !whId) return;
    createPz.mutate({ docId: id, whId });
  }

  if (docLoading || whLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-500">
        Ładowanie…
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <Link
        to="/purchase-documents"
        className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        ← Powrót do faktur
      </Link>

      <h1 className="mt-4 text-xl font-semibold text-gray-900">Utwórz dokument PZ</h1>

      {doc && (
        <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600 space-y-0.5">
          <p><span className="text-gray-400">Faktura:</span> <strong className="text-gray-800">{doc.document_number || '—'}</strong></p>
          <p><span className="text-gray-400">Wystawca:</span> {doc.supplier_name || '—'}</p>
          <p><span className="text-gray-400">Pozycji:</span> {doc.items.length}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Magazyn przyjęcia
          </label>
          {warehouses.length === 0 ? (
            <p className="text-sm text-red-500">Brak zdefiniowanych magazynów.</p>
          ) : warehouses.length === 1 ? (
            <p className="text-sm text-gray-800 font-medium">{warehouses[0].name ?? warehouses[0].code}</p>
          ) : (
            <select
              value={warehouseId || warehouses[0]?.id}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name ?? wh.code}
                </option>
              ))}
            </select>
          )}
        </div>

        {createPz.isError && (
          <p className="text-sm text-red-500">Błąd podczas tworzenia PZ. Spróbuj ponownie.</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={createPz.isPending || warehouses.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {createPz.isPending ? 'Tworzenie…' : 'Utwórz PZ'}
          </button>
          <Link
            to="/purchase-documents"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Anuluj
          </Link>
        </div>
      </form>
    </div>
  );
}
