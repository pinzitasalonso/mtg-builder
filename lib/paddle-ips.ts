// Paddle sends webhooks from a short list of addresses, published at
// <api>/ips (data.ipv4_cidrs). The list is fetched, never hard-coded: Paddle
// can change it. Each environment has its own list (api.paddle.com for live,
// sandbox-api.paddle.com for sandbox).
//
// Kept for an hour. If a refresh fails, the last good list is used; with no
// list at all, the check fails, so the route answers non-2xx and Paddle
// retries instead of losing the event.

import type { PaddleEnv } from "@/lib/paddle-config";
import { clientIp } from "@/lib/ratelimit";

const TTL_MS = 60 * 60_000;
const API: Record<PaddleEnv, string> = {
  production: "https://api.paddle.com",
  sandbox: "https://sandbox-api.paddle.com",
};

const cache = new Map<PaddleEnv, { cidrs: string[]; at: number }>();

export async function paddleWebhookCidrs(env: PaddleEnv): Promise<string[]> {
  const hit = cache.get(env);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cidrs;
  try {
    const res = await fetch(`${API[env]}/ips`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { ipv4_cidrs?: unknown } };
    const cidrs = body.data?.ipv4_cidrs;
    if (!Array.isArray(cidrs) || cidrs.length === 0 || !cidrs.every((c) => typeof c === "string" && parseCidr(c))) {
      throw new Error("unexpected /ips response");
    }
    cache.set(env, { cidrs, at: Date.now() });
    return cidrs;
  } catch (e) {
    if (hit) return hit.cidrs;
    throw new Error(`Couldn't load Paddle's webhook IPs: ${e instanceof Error ? e.message : e}`);
  }
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [ip, bits = "32"] = cidr.split("/");
  const base = ipv4ToInt(ip);
  const n = Number(bits);
  if (base === null || !Number.isInteger(n) || n < 0 || n > 32) return null;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  // An IPv4 address can arrive in its IPv6-mapped form (::ffff:1.2.3.4).
  const addr = ipv4ToInt(ip.replace(/^::ffff:/i, ""));
  if (addr === null) return false;
  return cidrs.some((c) => {
    const p = parseCidr(c);
    return p !== null && ((addr & p.mask) >>> 0) === p.base;
  });
}

/**
 * Whether this request came from one of Paddle's webhook addresses. The
 * sender is the first x-forwarded-for entry, which Railway's edge writes
 * itself (lib/ratelimit.ts clientIp). For local testing only, outside a
 * production build, PADDLE_WEBHOOK_IP_CHECK=off skips the check.
 */
export async function fromPaddle(request: Request, env: PaddleEnv): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env.PADDLE_WEBHOOK_IP_CHECK === "off") return true;
  return ipInCidrs(clientIp(request), await paddleWebhookCidrs(env));
}
