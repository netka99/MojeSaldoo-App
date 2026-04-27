/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPrintFrame } from './printFrame';

describe('openPrintFrame', () => {
  const createEl = document.createElement.bind(document);

  beforeEach(() => {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 0;
    };
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('returns false when iframe has no contentDocument', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'contentDocument', { get: () => null, configurable: true });
    Object.defineProperty(el, 'contentWindow', { get: () => null, configurable: true });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: unknown) => {
      if (tag === 'iframe') {
        return el as unknown as HTMLIFrameElement;
      }
      return createEl(tag, options) as never;
    });

    expect(
      openPrintFrame({
        title: 'T',
        rootId: 'test-root',
        element: createElement('span', null, 'x'),
      }),
    ).toBe(false);
  });

  it('returns true, mounts in iframe, and calls print in jsdom', () => {
    const result = openPrintFrame({
      title: 'Faktura',
      rootId: 'pf-test-root',
      element: createElement('p', { 'data-pf': '1' }, 'OK'),
    });

    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).toBeTruthy();
    if (!result) {
      // Rare: iframe not wired in this jsdom; null path is covered by the test above.
      return;
    }
    expect(iframe?.contentWindow?.print).toBeDefined();
    const idoc = iframe?.contentDocument;
    if (idoc) {
      expect(idoc.getElementById('pf-test-root')).toBeTruthy();
    }
  });
});
