/**
 * PageExplainer — collapsible info panel that explains how a page works.
 *
 * Usage:
 *   <PageExplainer
 *     summary="Co tu widać?"
 *     items={[...]}
 *     example="Faktura wystawiona 28 sierpnia..."
 *   />
 */

import { useState } from 'react';

export interface ExplainerItem {
  icon: string;        // emoji
  label: string;       // short bold label
  description: string; // plain text explanation
}

interface PageExplainerProps {
  summary: string;       // one-line summary shown when collapsed
  items: ExplainerItem[];
  example?: string;      // optional concrete example
  exampleLabel?: string; // label before example, default "Przykład"
}

export function PageExplainer({ summary, items, example, exampleLabel = 'Przykład' }: PageExplainerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-bold leading-none">
          ?
        </span>
        <span>{summary}</span>
        <span className="text-muted-foreground/50">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <ul className="space-y-2.5">
            {items.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-base leading-none">{item.icon}</span>
                <div>
                  <span className="font-semibold text-foreground">{item.label} </span>
                  <span className="text-muted-foreground">{item.description}</span>
                </div>
              </li>
            ))}
          </ul>

          {example && (
            <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                {exampleLabel}
              </span>
              <p className="mt-1 text-muted-foreground leading-relaxed">{example}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Zamknij ✕
          </button>
        </div>
      )}
    </div>
  );
}
