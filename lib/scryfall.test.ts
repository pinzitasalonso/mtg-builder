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
