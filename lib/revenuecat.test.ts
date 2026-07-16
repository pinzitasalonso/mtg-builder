import { afterEach, describe, expect, it, vi } from "vitest";
import { isProOnRevenueCat, userIdFromAppUserId } from "./revenuecat";

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

  it("fails closed on an API error", async () => {
    mockFetch(401, {});
    expect(await isProOnRevenueCat("42", "sk_bad")).toBe(false);
  });
});
