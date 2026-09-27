/* Who was signed in, for when the server can't be asked.

   Offline, /api/auth/me can't answer, and the home page used to read that
   as "signed out" — so looking over a deck on the train logged you out.
   Now the last confirmed session is kept here, and trusted for a day
   without the network. Only the server saying "signed out" (or signing
   out here) forgets it. */

const KEY = "sp-offline-session";
const DAY = 24 * 60 * 60 * 1000;

export function rememberSession(user: unknown): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ user, at: Date.now() }));
  } catch {
    /* storage off: offline you'll just look signed out */
  }
}

export function forgetSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/** The last confirmed user, if that was within a day. */
export function offlineSession<T>(now = Date.now()): T | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { user, at } = JSON.parse(raw) as { user: T; at: number };
    return typeof at === "number" && now - at < DAY ? user : null;
  } catch {
    return null;
  }
}

/** On sign-out: drop the saved session and the API responses the service
 *  worker keeps for offline use, so the next person sees none of it. */
export async function forgetOfflineData(): Promise<void> {
  forgetSession();
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.startsWith("/api/")) await cache.delete(req);
      }
    }
  } catch {
    /* no Cache Storage here */
  }
}
