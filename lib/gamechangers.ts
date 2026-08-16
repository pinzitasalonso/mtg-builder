// The Commander Game Changer list, from Scryfall.
//
// Wizards maintains it and Scryfall tags it, so `is:gamechanger` is the whole
// query. iOS fetches exactly this and caches it in UserDefaults for a day; the
// web goes through a route so the browser isn't making cross-origin Scryfall
// calls on every deck page, and so one process serves every visitor from one
// fetch.

import { SCRYFALL_HEADERS } from "./scryfall";

const TTL_MS = 24 * 60 * 60_000;

let cache: { at: number; names: string[] } | null = null;

/* Test seam. */
export function resetGameChangerCache(): void {
  cache = null;
}

/**
 * Every Game Changer's name, lowercased through the app's name key.
 *
 * An EMPTY result is a failed request, not an empty list — Wizards will not be
 * removing every Game Changer — so a failure keeps whatever is cached and, on
 * a cold process, returns nothing rather than poisoning the cache with it. A
 * deck then reads as bracket Core, which is the same thing iOS shows when its
 * own list hasn't loaded yet.
 */
export async function gameChangerNames(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.names;

  const names: string[] = [];
  let url: string | null =
    "https://api.scryfall.com/cards/search?q=" + encodeURIComponent("is:gamechanger") + "&unique=cards";
  try {
    // Paginated, but the list is a few dozen cards — this is one page today and
    // the loop is here so it stays correct when Wizards adds to it.
    for (let page = 0; page < 5 && url; page++) {
      const res: Response = await fetch(url, { headers: SCRYFALL_HEADERS });
      if (!res.ok) break;
      const body = await res.json();
      for (const card of body.data ?? []) {
        if (typeof card?.name === "string") {
          names.push(card.name.trim().replace(/\s+/g, " ").toLowerCase());
        }
      }
      url = body.has_more && body.next_page ? (body.next_page as string) : null;
      if (url) await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // Network blip — fall through to whatever we already had.
  }

  if (names.length === 0) return cache?.names ?? [];
  cache = { at: Date.now(), names };
  return names;
}
