import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { laneOf, resetScryfallLimit, scryfallClosedFor, scryfallFetch } from "./scryfall-limit";
import { scanVersionURL } from "./scan-url";

const ok = () => new Response("{}", { status: 200 });
const throttled = (retryAfter?: string) =>
  new Response("{}", { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

describe("scryfallFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetScryfallLimit();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts search, named, random and collection in the slow lane", () => {
    expect(laneOf("https://api.scryfall.com/cards/search?q=r:rare")).toBe("slow");
    expect(laneOf("https://api.scryfall.com/cards/named?fuzzy=sol")).toBe("slow");
    expect(laneOf("https://api.scryfall.com/cards/collection")).toBe("slow");
    expect(laneOf("https://api.scryfall.com/cards/random")).toBe("slow");
    expect(laneOf("https://api.scryfall.com/cards/autocomplete?q=sol")).toBe("fast");
    expect(laneOf("https://api.scryfall.com/cards/6904ea20-e504-47da-95a0-08739fdde260")).toBe("fast");
    expect(laneOf("https://api.scryfall.com/sets")).toBe("fast");
  });

  it("spaces slow-lane requests over half a second apart, and leaves the fast lane free", async () => {
    const at: number[] = [];
    const fetchMock = vi.fn(async (_url: string) => {
      at.push(Date.now());
      return ok();
    });
    vi.stubGlobal("fetch", fetchMock);
    const start = Date.now();
    const calls = [1, 2, 3].map(() => scryfallFetch("https://api.scryfall.com/cards/search?q=t:elf"));
    const fast = scryfallFetch("https://api.scryfall.com/sets");
    await vi.runAllTimersAsync();
    await Promise.all([...calls, fast]);
    const slowTimes = at.filter((_, i) => fetchMock.mock.calls[i]![0].includes("/search")).map((t) => t - start);
    expect(slowTimes).toEqual([0, 550, 1100]);
    const fastTime = at[fetchMock.mock.calls.findIndex((c) => c[0].includes("/sets"))]! - start;
    expect(fastTime).toBe(0);
  });

  it("after a 429, sends nothing for 30 seconds and answers 429 itself", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(throttled("1")).mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    const first = await scryfallFetch("https://api.scryfall.com/cards/named?fuzzy=sol");
    expect(first.status).toBe(429);
    expect(scryfallClosedFor()).toBe(30);

    // Both lanes are closed, and no request leaves.
    const blocked = await scryfallFetch("https://api.scryfall.com/cards/search?q=t:elf");
    const blockedFast = await scryfallFetch("https://api.scryfall.com/sets");
    expect(blocked.status).toBe(429);
    expect(blockedFast.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const after = await scryfallFetch("https://api.scryfall.com/cards/search?q=t:elf");
    expect(after.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours a Retry-After longer than 30 seconds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(throttled("90")));
    await scryfallFetch("https://api.scryfall.com/cards/search?q=t:elf");
    expect(scryfallClosedFor()).toBe(90);
  });

  it("closes the lanes for a request still waiting its turn", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(throttled()).mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    const first = scryfallFetch("https://api.scryfall.com/cards/search?q=a");
    const second = scryfallFetch("https://api.scryfall.com/cards/search?q=b");
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(429);
    expect((await second).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("no Scryfall request skips the limiter", () => {
  // A literal api.scryfall.com URL handed straight to fetch() would go out
  // unspaced. Image URLs (format=image) are <img> sources, not fetches.
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
    }
  };
  ["app", "lib", "components"].forEach((d) => walk(join(root, d)));

  it("in app, lib or components", () => {
    const direct = /(^|[^A-Za-z])fetch\(\s*[`"']https:\/\/api\.scryfall\.com/m;
    const offenders = files.filter((f) => direct.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("scanVersionURL", () => {
  const scan = "https://cards.scryfall.io/normal/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173";

  it("cuts another size of the same scan", () => {
    expect(scanVersionURL(scan, "art_crop")).toBe(
      "https://cards.scryfall.io/art_crop/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173"
    );
    expect(scanVersionURL(scan.replace("/front/", "/back/"), "art_crop")).toContain("/art_crop/back/");
  });

  it("swaps the extension to and from the PNG scan", () => {
    expect(scanVersionURL(scan, "png")).toBe("https://cards.scryfall.io/png/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.png?1783908173");
    expect(scanVersionURL(scan.replace("/normal/", "/png/").replace(".jpg", ".png"), "normal")).toBe(scan);
  });

  it("is null for anything that isn't a stored scan", () => {
    expect(scanVersionURL(undefined, "art_crop")).toBeNull();
    expect(scanVersionURL("https://api.scryfall.com/cards/named?exact=Sol%20Ring&format=image", "art_crop")).toBeNull();
    expect(scanVersionURL("https://example.com/normal/front/x.jpg", "art_crop")).toBeNull();
  });
});
