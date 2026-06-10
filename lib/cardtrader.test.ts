import { describe, expect, it } from "vitest";
import { normalizeCardName } from "./cardtrader";

describe("normalizeCardName", () => {
  it("collapses display names and slugs to the same form", () => {
    expect(normalizeCardName("Sol Ring")).toBe("sol ring");
    expect(normalizeCardName("sol-ring")).toBe("sol ring");
    expect(normalizeCardName("Braids, Conjurer Adept")).toBe("braids conjurer adept");
    expect(normalizeCardName("braids-conjurer-adept")).toBe("braids conjurer adept");
  });

  it("handles split/double-faced separators and odd punctuation", () => {
    expect(normalizeCardName("Fire // Ice")).toBe("fire ice");
    expect(normalizeCardName("Lim-Dûl's Vault")).toBe("lim d l s vault");
    expect(normalizeCardName("  Ponder  ")).toBe("ponder");
  });
});
