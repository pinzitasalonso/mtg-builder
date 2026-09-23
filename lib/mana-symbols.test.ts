import { describe, expect, it } from "vitest";
import { symbolName } from "../components/mtg";

describe("symbolName", () => {
  it("reads colors, generic and hybrid costs aloud", () => {
    expect(symbolName("R")).toBe("red");
    expect(symbolName("2")).toBe("2 generic");
    expect(symbolName("W/U")).toBe("white or blue");
    expect(symbolName("2/G")).toBe("2 generic or green");
  });
  it("names Phyrexian mana", () => {
    expect(symbolName("U/P")).toBe("Phyrexian blue");
    expect(symbolName("G/W/P")).toBe("Phyrexian green or white");
  });
});
