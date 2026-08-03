import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import {
  useAllOpexCategoriesQuery,
  useCreateOpexCategoryMutation,
  useUpdateOpexCategoryMutation,
  useDeleteOpexCategoryMutation,
} from '@/query/use-cashflow';
import type { OpexCategory } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------

function CategoryRow({ cat, onMoveUp, isFirst }: {
  cat: OpexCategory;
  onMoveUp: () => void;
  isFirst: boolean;
}) {
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const updateMutation = useUpdateOpexCategoryMutation();
  const deleteMutation = useDeleteOpexCategoryMutation();

  const startEdit = () => {
    setEditName(cat.name);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName.trim() || editName.trim() === cat.name) { setEditing(false); return; }
    await updateMutation.mutateAsync({ id: cat.id, data: { name: editName.trim() } });
    setEditing(false);
  };

  const toggleActive = () => {
    void updateMutation.mutateAsync({ id: cat.id, data: { is_active: !cat.is_active } });
  };

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    await deleteMutation.mutateAsync(cat.id);
  };

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${cat.is_active ? '' : 'opacity-50'}`}>
      {/* Move up */}
      <button
        type="button"
        onClick={onMoveUp}
        disabled={isFirst || updateMutation.isPending}
        className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-20 text-sm leading-none"
        title="Przesuń wyżej"
      >
        ↑
      </button>

      {/* Name — editable inline */}
      {editing ? (
        <input
          autoFocus
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => void saveEdit()}
          className="flex-1 rounded border border-primary bg-background px-2 py-0.5 text-sm focus:outline-none"
        />
      ) : (
        <span
          className="flex-1 cursor-pointer text-sm select-none"
          onClick={startEdit}
          title="Kliknij aby edytować"
        >
          {cat.name}
        </span>
      )}

      {/* Hide/show */}
      <button
        type="button"
        onClick={toggleActive}
        disabled={updateMutation.isPending}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        title={cat.is_active ? 'Ukryj kategorię' : 'Pokaż kategorię'}
      >
        {cat.is_active ? '👁' : '🙈'}
      </button>

      {/* Delete */}
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={deleteMutation.isPending}
        className={`shrink-0 text-xs font-medium transition-colors ${
          confirming ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'
        }`}
        title={confirming ? 'Kliknij ponownie aby usunąć' : 'Usuń kategorię'}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'Usuń?' : '✕'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main popup
// ---------------------------------------------------------------------------

interface OpexCategoryManagerProps {
  open: boolean;
  onClose: () => void;
}

export function OpexCategoryManager({ open, onClose }: OpexCategoryManagerProps) {
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: categories = [], isLoading } = useAllOpexCategoriesQuery();
  const createMutation = useCreateOpexCategoryMutation();
  const updateMutation = useUpdateOpexCategoryMutation();

  // Show all (including hidden) when in manager
  const allCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await createMutation.mutateAsync({ name: newName.trim() });
    setNewName('');
    inputRef.current?.focus();
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const cat = allCategories[index];
    const prev = allCategories[index - 1];
    // Swap sort_orders
    await Promise.all([
      updateMutation.mutateAsync({ id: cat.id, data: { sort_order: prev.sort_order } }),
      updateMutation.mutateAsync({ id: prev.id, data: { sort_order: cat.sort_order } }),
    ]);
  };

  useEffect(() => {
    if (open) setNewName('');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed right-6 top-16 z-[55] w-72 rounded-xl border border-border bg-background shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Kategorie kosztów</h2>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                aria-label="Zamknij"
              >
                ×
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-2">
              {isLoading && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Ładowanie…</p>
              )}
              {!isLoading && allCategories.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Brak kategorii.</p>
              )}
              {allCategories.map((cat, i) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  isFirst={i === 0}
                  onMoveUp={() => void handleMoveUp(i)}
                />
              ))}
            </div>

            {/* Add new */}
            <div className="border-t border-border px-3 py-3">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
                  placeholder="Nowa kategoria..."
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <Button
                  size="sm"
                  onClick={() => void handleAdd()}
                  disabled={!newName.trim() || createMutation.isPending}
                  loading={createMutation.isPending}
                >
                  Dodaj
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Kliknij nazwę aby edytować · ↑ przesuń wyżej · 👁 ukryj
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
