// Fetching and caching a provider's public signing keys. Apple rotates them,
// so they can't be pinned; but re-fetching per sign-in would put Apple in the
// hot path of every login, so they're cached in process for as long as the
// response says.
//
// No `@/` imports — see lib/jwt.ts.

import type { JsonWebKey } from "crypto";
import { rateLimit } from "./ratelimit";

interface CacheEntry {
  keys: JsonWebKey[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const MIN_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_TTL_MS = 60 * 60_000;

/* How long to trust this response, from its own cache-control. Clamped: a
   tiny max-age would put us back to fetching per sign-in, and an enormous one
   would keep serving keys long after a rotation. */
function ttlFrom(res: { headers: { get(name: string): string | null } }): number {
  const header = res.headers.get("cache-control") ?? "";
  const match = /max-age=(\d+)/i.exec(header);
  if (!match) return DEFAULT_TTL_MS;
  const ms = Number(match[1]) * 1000;
  if (!Number.isFinite(ms)) return DEFAULT_TTL_MS;
  return Math.min(Math.max(ms, MIN_TTL_MS), MAX_TTL_MS);
}

function parseKeys(body: unknown): JsonWebKey[] | null {
  if (typeof body !== "object" || body === null) return null;
  const keys = (body as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return null;
  return keys.filter((k): k is JsonWebKey => typeof k === "object" && k !== null);
}

/* The signing keys for `url`, from cache when fresh.

   On a failed refetch with a stale entry in hand, the stale keys are returned
   rather than throwing: provider keys stay valid well past the cache header,
   and a brief outage at Apple must not lock everyone out of signing in. With
   no entry at all there is nothing to fall back on, so it throws and the
   route answers 503. */
export async function getJwks(url: string): Promise<JsonWebKey[]> {
  const hit = cache.get(url);
  if (hit && Date.now() < hit.expiresAt) return hit.keys;

  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const keys = parseKeys(await res.json());
    if (!keys?.length) throw new Error("JWKS had no keys");
    cache.set(url, { keys, expiresAt: Date.now() + ttlFrom(res) });
    return keys;
  } catch (e) {
    if (hit) {
      console.error(`JWKS refetch failed for ${url}, serving stale keys:`, e);
      return hit.keys;
    }
    throw e;
  }
}

/* The key with this `kid`, or null.

   A miss usually means the provider rotated between our cache and this token,
   so one forced refetch is worth it. That refetch is itself throttled, or an
   unknown kid would be a free way to make us hammer Apple. */
export async function getSigningKey(url: string, kid: string): Promise<JsonWebKey | null> {
  if (!kid) return null;
  const found = (keys: JsonWebKey[]) => keys.find((k) => (k as { kid?: string }).kid === kid);

  const hit = found(await getJwks(url));
  if (hit) return hit;

  if (!rateLimit(`jwks-refetch:${url}`, 3, 60_000)) return null;
  cache.delete(url);
  return found(await getJwks(url)) ?? null;
}

/* Tests only: the cache is module state with no other way to reset it. */
export function __clearJwksCache(): void {
  cache.clear();
}
