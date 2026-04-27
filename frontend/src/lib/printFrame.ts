import { type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export type OpenPrintFrameOptions = {
  title: string;
  rootId: string;
  element: ReactElement;
};

/**
 * Renders a print layout in a full-viewport, same-origin iframe (avoids `window.open`
 * pop-up quirks and `createRoot` in a bare about:blank tab, which can yield a blank
 * page with cloned theme CSS).
 */
export function openPrintFrame({ title, rootId, element }: OpenPrintFrameOptions): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', title);
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100vw',
    'height:100vh',
    'z-index:2147483646',
    'border:0',
    'background:#fff',
  ].join(';');

  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument;
  const iwin = iframe.contentWindow;
  if (!idoc || !iwin) {
    iframe.remove();
    return false;
  }

  idoc.open();
  idoc.write(
    `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/><title>${escapeXml(
      title,
    )}</title></head><body><div id="${rootId}"></div></body></html>`,
  );
  idoc.close();

  injectPrintBaseStyles(idoc);
  cloneAppStylesInto(idoc);

  const container = idoc.getElementById(rootId);
  if (!container) {
    iframe.remove();
    return false;
  }

  let root: Root | null = createRoot(container);
  try {
    root.render(element);
  } catch (e) {
    console.error('Print view render failed', e);
    container.textContent =
      'Błąd generowania widoku druku. Otwórz konsolę deweloperską (F12) po szczegóły.';
  }

  const runPrint = () => {
    try {
      iwin.focus();
      iwin.print();
    } catch (e) {
      console.error('print() failed', e);
    }
  };
  iwin.requestAnimationFrame(() => {
    iwin.requestAnimationFrame(runPrint);
  });

  iwin.addEventListener(
    'afterprint',
    () => {
      try {
        root?.unmount();
      } catch {
        /* empty */
      }
      root = null;
      iframe.remove();
    },
    { once: true },
  );

  return true;
}

function injectPrintBaseStyles(doc: Document) {
  const s = doc.createElement('style');
  s.setAttribute('data-mojesaldoo-print', '1');
  s.textContent = [
    'html,body{margin:0;padding:0;background:#fff !important;min-height:100%;}',
    'body{color:#111 !important;-webkit-font-smoothing:antialiased;}',
    // Ensure print root is never hidden by cloned theme / Tailwind
    `body [id$="-print-root"],body [id$="-print-root"] *{color:#000 !important;visibility:visible !important;}`,
  ].join('\n');
  doc.head.appendChild(s);
}

function cloneAppStylesInto(doc: Document) {
  try {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      doc.head.appendChild(node.cloneNode(true) as Node);
    });
  } catch {
    // ignore
  }
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
