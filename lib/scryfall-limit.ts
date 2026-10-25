/* Every request to api.scryfall.com goes through scryfallFetch.

   Scryfall's hard limits (scryfall.com/docs/api/rate-limits):
   - /cards/search, /cards/named, /cards/random and /cards/collection:
     2 requests a second.
   - Everything else: 10 a second.
   A 429 locks the caller out for 30 seconds. Carrying on after one can get
   the app banned, temporarily or for good.

   So requests leave one at a time per lane, spaced a little wider than the
   limit. A 429 closes both lanes for its Retry-After, and at least 30
   seconds. While they are closed nothing is sent: callers get a 429 back at
   once, without a request reaching Scryfall.

   The state is per process: on the server, that is all of Spellpool's
   traffic (it runs one server); in a browser, one tab's. The card images on
   cards.scryfall.io have no limit and don't come through here. */

type Lane = "slow" | "fast";

const GAP_MS: Record<Lane, number> = { slow: 550, fast: 120 };
const SLOW_PATHS = /^\/cards\/(search|named|random|collection)(\/|$)/;
const LOCKOUT_MS = 30_000;

interface LimitState {
  next: Record<Lane, number>;
  closedUntil: number;
}
// On globalThis so a dev-server module reload doesn't reset the spacing.
const g = globalThis as unknown as { __spScryfallLimit?: LimitState };
const state: LimitState = (g.__spScryfallLimit ??= { next: { slow: 0, fast: 0 }, closedUntil: 0 });

export function laneOf(url: string): Lane {
  try {
    return SLOW_PATHS.test(new URL(url).pathname) ? "slow" : "fast";
  } catch {
    return "slow";
  }
}

/** Seconds until Scryfall may be asked again; 0 when it may be asked now. */
export function scryfallClosedFor(now = Date.now()): number {
  return Math.max(0, Math.ceil((state.closedUntil - now) / 1000));
}

// The answer while the lanes are closed: the same shape as Scryfall's own
// error, so callers handle it as the 429 it stands for.
function closedResponse(): Response {
  const seconds = Math.max(1, scryfallClosedFor());
  return new Response(
    JSON.stringify({ object: "error", code: "rate_limited", status: 429, details: `Scryfall is busy. Try again in ${seconds} seconds.` }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(seconds) } }
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for `url`'s turn in its lane. False when Scryfall is closed to us,
    before or by the end of the wait: then don't send it. Also for requests
    the browser makes itself, like an <img> whose src is an API URL. */
export async function scryfallTurn(url: string): Promise<boolean> {
  if (Date.now() < state.closedUntil) return false;
  // Take the lane's next free slot. Reading and moving it happen with no
  // await between them, so two callers never get the same slot.
  const lane = laneOf(url);
  const now = Date.now();
  const slot = Math.max(now, state.next[lane]);
  state.next[lane] = slot + GAP_MS[lane];
  if (slot > now) await sleep(slot - now);
  return Date.now() >= state.closedUntil;
}

/** fetch(), for api.scryfall.com, within its rate limits. */
export async function scryfallFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!(await scryfallTurn(url))) return closedResponse();
  const res = await fetch(url, init);
  if (res.status === 429) {
    const after = Number(res.headers.get("Retry-After"));
    const ms = Math.max(LOCKOUT_MS, Number.isFinite(after) ? after * 1000 : 0);
    state.closedUntil = Math.max(state.closedUntil, Date.now() + ms);
    console.warn(`[scryfall] 429 on ${new URL(url).pathname}; holding all requests for ${Math.round(ms / 1000)}s`);
  }
  return res;
}

/** For tests: forget the spacing and any lockout. */
export function resetScryfallLimit(): void {
  state.next = { slow: 0, fast: 0 };
  state.closedUntil = 0;
}
