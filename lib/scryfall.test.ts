import { describe, expect, it } from "vitest";
import { naturalToScryfall } from "./scryfall";

describe("naturalToScryfall", () => {
  it("maps plain English to Scryfall tokens", () => {
    expect(naturalToScryfall("1 mana blue creatures")).toBe("c:u mv=1 t:creature");
  });

  it("folds multiple colors into one c: token and drops filler", () => {
    expect(naturalToScryfall("two mana white green enchantments")).toBe("c:wg mv=2 t:enchantment");
  });

  it("leaves real Scryfall syntax untouched", () => {
    expect(naturalToScryfall("t:wizard id:u")).toBe("t:wizard id:u");
    expect(naturalToScryfall("mv>=7 c:r")).toBe("mv>=7 c:r");
    expect(naturalToScryfall('o:"draw a card"')).toBe('o:"draw a card"');
  });

  it("keeps unrecognized words as a name search", () => {
    expect(naturalToScryfall("lightning bolt")).toBe("lightning bolt");
  });

  it("handles empty input", () => {
    expect(naturalToScryfall("")).toBe("");
    expect(naturalToScryfall("   ")).toBe("");
  });
});

import { afterEach, beforeEach, vi } from "vitest";
import { lookupCollection, resolveNamedDetailed } from "./scryfall";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const card = (name: string) => ({ id: "id-" + name, name, image_uris: { normal: "img" }, type_line: "Instant" });

describe("lookupCollection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const run = async <T,>(p: Promise<T>) => {
    await vi.runAllTimersAsync();
    return p;
  };

  it("keeps found, not-found and failed apart", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: [card("Sol Ring")], not_found: [{ name: "Sol Rong" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run(lookupCollection(["Sol Ring", "Sol Rong"]));
    expect(r.found.get("sol ring")?.name).toBe("Sol Ring");
    expect(r.notFound).toEqual(["Sol Rong"]);
    expect(r.failed).toEqual([]);
  });

  it("files a throttled chunk as failed after one retry, never as not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(429, { error: "slow down" }, { "Retry-After": "1" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run(lookupCollection(["Sol Ring", "Command Tower"]));
    expect(r.failed).toEqual(["Sol Ring", "Command Tower"]);
    expect(r.notFound).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { data: [card("Sol Ring")], not_found: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run(lookupCollection(["Sol Ring"]));
    expect(r.found.has("sol ring")).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it("hands a rejected request (400) to the per-name path, not the retry button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(400, { error: "bad identifier" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run(lookupCollection(["Sol Ring"]));
    expect(r.notFound).toEqual(["Sol Ring"]);
    expect(r.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keys a card by the name asked for when Scryfall's canonical name differs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { data: [card("Lim-Dûl's Vault"), card("Dusk // Dawn")], not_found: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await run(lookupCollection(["Lim-Dul's Vault", "Dusk"]));
    expect(r.found.get("lim-dul's vault")?.name).toBe("Lim-Dûl's Vault");
    expect(r.found.get("dusk")?.name).toBe("Dusk // Dawn");
    expect(r.found.get("dusk // dawn")?.name).toBe("Dusk // Dawn");
    expect(r.notFound).toEqual([]);
  });
});

describe("resolveNamedDetailed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says notfound on a 404 and failed on a persistent 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { object: "error" })));
    const p1 = resolveNamedDetailed("Sol Rong");
    await vi.runAllTimersAsync();
    expect((await p1).status).toBe("notfound");

    const throttled = vi.fn().mockResolvedValue(json(429, {}));
    vi.stubGlobal("fetch", throttled);
    const p2 = resolveNamedDetailed("Sol Ring");
    await vi.runAllTimersAsync();
    expect((await p2).status).toBe("failed");
    expect(throttled).toHaveBeenCalledTimes(2);
  });
});
