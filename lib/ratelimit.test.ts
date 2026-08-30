import { afterEach, describe, expect, it, vi } from "vitest";
import { authRateLimit, rateLimit } from "./ratelimit";

// The module holds process-wide buckets and exposes no reset — adding one
// would be production surface existing only for tests — so every test uses a
// key nobody else touches.
let n = 0;
const uniq = () => `t${Date.now()}-${n++}`;

afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows up to the cap, then refuses", () => {
    const key = uniq();
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false);
  });

  it("lets the window slide", () => {
    vi.useFakeTimers();
    const key = uniq();
    expect(rateLimit(key, 1, 60_000)).toBe(true);
    expect(rateLimit(key, 1, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit(key, 1, 60_000)).toBe(true);
  });

  it("keeps separate keys separate", () => {
    const a = uniq();
    const b = uniq();
    expect(rateLimit(a, 1, 60_000)).toBe(true);
    expect(rateLimit(a, 1, 60_000)).toBe(false);
    expect(rateLimit(b, 1, 60_000)).toBe(true);
  });
});

describe("authRateLimit", () => {
  it("throttles repeated logins from one IP", () => {
    const ip = uniq();
    // The per-IP login cap is 10 in 5 minutes, each on a different address so
    // the per-email bucket never fires first.
    for (let i = 0; i < 10; i++) {
      expect(authRateLimit("login", ip, `${i}@example.com`)).toBe(true);
    }
    expect(authRateLimit("login", ip, "another@example.com")).toBe(false);
  });

  it("throttles one address across different IPs", () => {
    const email = `${uniq()}@example.com`;
    // Per-email login cap is 5 in 15 minutes. Fresh IP each time, so only the
    // subject bucket can be what stops this.
    for (let i = 0; i < 5; i++) {
      expect(authRateLimit("login", uniq(), email)).toBe(true);
    }
    expect(authRateLimit("login", uniq(), email)).toBe(false);
  });

  // The IP bucket is consumed first on purpose: an abusive client is turned
  // away without spending the budget belonging to the address it is guessing.
  it("spends the IP budget before the subject's", () => {
    const ip = uniq();
    const victim = `${uniq()}@example.com`;
    for (let i = 0; i < 10; i++) authRateLimit("login", ip, `filler${i}@example.com`);
    expect(authRateLimit("login", ip, victim)).toBe(false);
    // The victim's own budget is untouched, so they can still sign in.
    expect(authRateLimit("login", uniq(), victim)).toBe(true);
  });

  it("keys actions separately", () => {
    const ip = uniq();
    for (let i = 0; i < 5; i++) authRateLimit("delete", ip);
    expect(authRateLimit("delete", ip)).toBe(false);
    expect(authRateLimit("password", ip)).toBe(true);
  });

  it("ignores the subject for actions that have no meaningful one", () => {
    const ip = uniq();
    for (let i = 0; i < 20; i++) expect(authRateLimit("oauth-exchange", ip)).toBe(true);
    expect(authRateLimit("oauth-exchange", ip)).toBe(false);
  });
});
