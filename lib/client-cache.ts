/* The last copy of what a page loaded, kept in memory for the rest of the
   visit. Going back to a deck or home shows it at once, and the page then
   re-checks the server as always (which answers 304, with no body, when
   nothing changed — see lib/http-cache.ts).

   Memory only, on purpose: it's empty on a fresh load, so a server render
   and the first client render always agree, and nothing outlives the tab.
   Pages write their state back here as it changes, so an edit is never
   shown stale on the way back. */

const store = new Map<string, unknown>();

export function peek<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function remember<T>(key: string, value: T): void {
  store.set(key, value);
}

/** On sign-out: another account must never see this one's decks. */
export function forgetAll(): void {
  store.clear();
}
