import { afterEach } from 'vitest';
import nock from 'nock';

const store = new Map<string, string>();

function ensureLocalStorage() {
  if (typeof globalThis.localStorage !== 'undefined') {
    return;
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

ensureLocalStorage();

afterEach(() => {
  store.clear();
  try {
    globalThis.localStorage.clear();
  } catch {
    /* ignore */
  }
  nock.cleanAll();
});
