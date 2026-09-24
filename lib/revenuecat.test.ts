import { afterEach, describe, expect, it, vi } from "vitest";
import { isProOnRevenueCat, userIdFromAppUserId, webPaywallKey } from "./revenuecat";

function mockFetch(status: number, json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => json }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("userIdFromAppUserId", () => {
  it("accepts our numeric user ids", () => {
    expect(userIdFromAppUserId("42")).toBe(42);
  });
  it("rejects anonymous ids and junk (pre-login purchases)", () => {
    expect(userIdFromAppUserId("$RCAnonymousID:abc123")).toBeNull();
    expect(userIdFromAppUserId("")).toBeNull();
    expect(userIdFromAppUserId("0")).toBeNull();
    expect(userIdFromAppUserId("-3")).toBeNull();
    expect(userIdFromAppUserId("12.5")).toBeNull();
  });
});

describe("isProOnRevenueCat", () => {
  it("is pro when the entitlement expires in the future", async () => {
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: "2999-01-01T00:00:00Z" } } },
    });
    expect(await isProOnRevenueCat("42", "sk_test")).toBe(true);
  });

  it("is pro when the entitlement never expires", async () => {
    mockFetch(200, { subscriber: { entitlements: { pro: { expires_date: null } } } });
    expect(await isProOnRevenueCat("42", "sk_test")).toBe(true);
  });

  it("is not pro when the entitlement has lapsed", async () => {
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: "2000-01-01T00:00:00Z" } } },
    });
    expect(await isProOnRevenueCat("42", "sk_test")).toBe(false);
  });

  it("is not pro without the pro entitlement", async () => {
    mockFetch(200, { subscriber: { entitlements: {} } });
    expect(await isProOnRevenueCat("42", "sk_test")).toBe(false);
  });

  it("is definitively not pro when RevenueCat has never seen the user", async () => {
    mockFetch(404, {});
    expect(await isProOnRevenueCat("42", "sk_test")).toBe(false);
  });

  it("is INDETERMINATE (null) on an auth failure — a bad key must never downgrade", async () => {
    mockFetch(401, {});
    expect(await isProOnRevenueCat("42", "sk_bad")).toBeNull();
    mockFetch(403, {});
    expect(await isProOnRevenueCat("42", "sk_restricted")).toBeNull();
  });

  it("is INDETERMINATE (null) on an outage", async () => {
    mockFetch(500, {});
    expect(await isProOnRevenueCat("42", "sk_test")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await isProOnRevenueCat("42", "sk_test")).toBeNull();
  });
});

describe("webPaywallKey", () => {
  it("serves a live Web Billing key everywhere", () => {
    expect(webPaywallKey("rcb_AbC123", true)).toBe("rcb_AbC123");
    expect(webPaywallKey("  rcb_AbC123\n", false)).toBe("rcb_AbC123");
  });
  it("serves sandbox and Test Store keys only outside production", () => {
    expect(webPaywallKey("rcb_sb_AbC123", false)).toBe("rcb_sb_AbC123");
    expect(webPaywallKey("test_AbC123", false)).toBe("test_AbC123");
    expect(webPaywallKey("rcb_sb_AbC123", true)).toBeNull();
    expect(webPaywallKey("test_AbC123", true)).toBeNull();
  });
  it("never serves a secret key, another platform's key, or junk", () => {
    for (const bad of ["sk_live_AbC123", "sk_AbC123", "appl_AbC123", "goog_AbC123", "strp_AbC123", "rcb_", "rcb_a b", "", undefined, null]) {
      expect(webPaywallKey(bad, false)).toBeNull();
      expect(webPaywallKey(bad, true)).toBeNull();
    }
  });
});
