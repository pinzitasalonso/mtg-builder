import { afterEach, describe, expect, it, vi } from "vitest";
import { authRateLimit, clientIp, loginAllowed, loginFailed, rateLimit, rateLimitHasRoom } from "./ratelimit";

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
    // The per-IP login cap is 10 in 5 minutes.
    for (let i = 0; i < 10; i++) {
      expect(authRateLimit("login", ip, `${i}@example.com`)).toBe(true);
    }
    expect(authRateLimit("login", ip, "another@example.com")).toBe(false);
  });

  it("throttles one address across different IPs (signup's per-address bucket)", () => {
    const email = `${uniq()}@example.com`;
    // Per-address signup cap is 3 an hour. Fresh IP each time, so only the
    // subject bucket can be what stops this.
    for (let i = 0; i < 3; i++) {
      expect(authRateLimit("signup", uniq(), email)).toBe(true);
    }
    expect(authRateLimit("signup", uniq(), email)).toBe(false);
  });

  // The IP bucket is consumed first on purpose: an abusive client is turned
  // away without spending the budget belonging to the address it is using.
  it("spends the IP budget before the subject's", () => {
    const ip = uniq();
    const victim = `${uniq()}@example.com`;
    for (let i = 0; i < 5; i++) authRateLimit("signup", ip, `filler${i}@example.com`);
    expect(authRateLimit("signup", ip, victim)).toBe(false);
    // The victim's own budget is untouched.
    expect(authRateLimit("signup", uniq(), victim)).toBe(true);
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

describe("login limits per address", () => {
  it("looking doesn't spend a slot", () => {
    const key = uniq();
    for (let i = 0; i < 10; i++) expect(rateLimitHasRoom(key, 1, 60_000)).toBe(true);
    expect(rateLimit(key, 1, 60_000)).toBe(true);
    expect(rateLimitHasRoom(key, 1, 60_000)).toBe(false);
  });

  it("only wrong passwords count: signing in right, any number of times, never locks the address", () => {
    const ip = uniq();
    const email = `${uniq()}@example.com`;
    for (let i = 0; i < 50; i++) expect(loginAllowed(ip, email)).toBe(true);
  });

  it("five wrong passwords from one place lock that place out, not the address's owner elsewhere", () => {
    const attacker = uniq();
    const email = `${uniq()}@example.com`;
    for (let i = 0; i < 5; i++) {
      expect(loginAllowed(attacker, email)).toBe(true);
      loginFailed(attacker, email);
    }
    expect(loginAllowed(attacker, email)).toBe(false);
    // The owner, from their own connection, still gets in.
    expect(loginAllowed(uniq(), email)).toBe(true);
  });

  it("thirty wrong passwords an hour across many places stop the guessing", () => {
    const email = `${uniq()}@example.com`;
    for (let i = 0; i < 30; i++) loginFailed(uniq(), email);
    expect(loginAllowed(uniq(), email)).toBe(false);
  });
});

describe("clientIp", () => {
  const from = (headers: Record<string, string>) => clientIp(new Request("http://test.local/", { headers }));

  // What Railway's edge sends: the client, then its own hop.
  it("is the first x-forwarded-for entry, not Railway's hop after it", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7, 152.233.0.10", "x-real-ip": "203.0.113.7" })).toBe("203.0.113.7");
    expect(from({ "x-forwarded-for": " 203.0.113.7 " })).toBe("203.0.113.7");
  });

  // The hop is the same for every visitor: two visitors must not share a key.
  it("keeps two visitors behind the same hop apart", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7, 152.233.0.10" })).not.toBe(from({ "x-forwarded-for": "198.51.100.4, 152.233.0.10" }));
  });

  it("falls back to x-real-ip, then to one shared key", () => {
    expect(from({ "x-real-ip": "203.0.113.7" })).toBe("203.0.113.7");
    expect(from({})).toBe("unknown");
  });
});
