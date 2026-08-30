import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearJwksCache, getJwks, getSigningKey } from "./jwks";

const URL_A = "https://appleid.apple.com/auth/keys";
const key = (kid: string) => ({ kty: "RSA", kid, n: "abc", e: "AQAB" });

function mockJwks(keys: unknown[], cacheControl?: string) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === "cache-control" ? cacheControl ?? null : null) },
    json: async () => ({ keys }),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => __clearJwksCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getJwks", () => {
  it("caches, so a second lookup costs no fetch", async () => {
    const fetchFn = mockJwks([key("k1")], "max-age=3600");
    expect(await getJwks(URL_A)).toHaveLength(1);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches once the response's max-age is spent", async () => {
    vi.useFakeTimers();
    const fetchFn = mockJwks([key("k1")], "max-age=3600");
    await getJwks(URL_A);
    vi.advanceTimersByTime(3600_000 + 1);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("floors a tiny max-age, so keys can't be re-fetched per sign-in", async () => {
    vi.useFakeTimers();
    const fetchFn = mockJwks([key("k1")], "max-age=1");
    await getJwks(URL_A);
    vi.advanceTimersByTime(60_000);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(1); // still inside the 5-minute floor
  });

  it("caps an enormous max-age, so a rotation is eventually noticed", async () => {
    vi.useFakeTimers();
    const fetchFn = mockJwks([key("k1")], "max-age=999999999");
    await getJwks(URL_A);
    vi.advanceTimersByTime(24 * 3600_000 + 1);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("falls back to an hour with no cache-control", async () => {
    vi.useFakeTimers();
    const fetchFn = mockJwks([key("k1")]);
    await getJwks(URL_A);
    vi.advanceTimersByTime(59 * 60_000);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60_000);
    await getJwks(URL_A);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // Provider keys stay valid well past the cache header. A blip at Apple must
  // not become "nobody can sign in".
  it("serves stale keys when a refetch fails", async () => {
    vi.useFakeTimers();
    mockJwks([key("k1")], "max-age=3600");
    await getJwks(URL_A);
    vi.advanceTimersByTime(3600_001);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("apple is down"); }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const keys = await getJwks(URL_A);
    expect((keys[0] as { kid: string }).kid).toBe("k1");
    err.mockRestore();
  });

  it("throws when it fails with nothing cached to fall back on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("apple is down"); }));
    await expect(getJwks(URL_A)).rejects.toThrow();
  });

  it("throws on a non-2xx and on an empty key set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}),
    })));
    await expect(getJwks(URL_A)).rejects.toThrow(/500/);

    __clearJwksCache();
    mockJwks([]);
    await expect(getJwks(URL_A)).rejects.toThrow(/no keys/);
  });
});

describe("getSigningKey", () => {
  it("finds the key by kid", async () => {
    mockJwks([key("k1"), key("k2")], "max-age=3600");
    expect((await getSigningKey(URL_A, "k2")) as { kid: string }).toMatchObject({ kid: "k2" });
  });

  it("returns null for an empty kid without fetching", async () => {
    const fetchFn = mockJwks([key("k1")]);
    expect(await getSigningKey(URL_A, "")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // A miss usually means a rotation between our cache and this token, so one
  // forced refetch is worth it — but only one.
  it("forces exactly one refetch on an unknown kid, then gives up", async () => {
    const fetchFn = mockJwks([key("k1")], "max-age=3600");
    expect(await getSigningKey(URL_A, "rotated")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("picks up a rotated key on the forced refetch", async () => {
    let keys = [key("old")];
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => "max-age=3600" },
      json: async () => ({ keys }),
    })));
    await getJwks(URL_A);
    keys = [key("old"), key("new")];
    expect((await getSigningKey(URL_A, "new")) as { kid: string }).toMatchObject({ kid: "new" });
  });
});
