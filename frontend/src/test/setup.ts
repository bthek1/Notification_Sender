import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./mocks/server";

// happy-dom 20 / jsdom 28 under the current Vitest 4 + Node combination ship a
// non-functional Web Storage (the `localStorage` global exists but has no
// methods). Install a minimal in-memory implementation so storage-backed code
// under test behaves like a real browser.
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

function installStorage(name: "localStorage" | "sessionStorage") {
  const value = createStorage();
  const targets = [globalThis, (globalThis as { window?: unknown }).window].filter(
    (t): t is object => Boolean(t)
  );
  for (const target of targets) {
    try {
      Object.defineProperty(target, name, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      (target as Record<string, unknown>)[name] = value;
    }
  }
}

// Install once if the environment's storage is missing or broken.
if (typeof localStorage === "undefined" || typeof localStorage.setItem !== "function") {
  installStorage("localStorage");
  installStorage("sessionStorage");
}

// Start the MSW server before the suite. Requests without a matching handler
// are left alone ("bypass") so tests that mock the Axios layer directly keep
// working; add handlers per-test with `server.use(...)`.
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
