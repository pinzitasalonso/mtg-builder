import { describe, expect, it } from "vitest";
import { newPlayCode, normalizePlayCode, PLAY_CODE_ALPHABET, PLAY_CODE_LENGTH } from "./play-code";

describe("newPlayCode", () => {
  it("mints codes of the right length from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newPlayCode();
      expect(code).toHaveLength(PLAY_CODE_LENGTH);
      expect([...code].every((c) => PLAY_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });
});

describe("normalizePlayCode", () => {
  it("forgives case, spaces, and dashes", () => {
    expect(normalizePlayCode(" ab-c 234 ")).toBe("ABC234");
    expect(normalizePlayCode("abc234")).toBe("ABC234");
  });

  it("rejects wrong lengths, lookalike letters, and non-strings", () => {
    expect(normalizePlayCode("ABC23")).toBeNull(); // too short
    expect(normalizePlayCode("ABC2345")).toBeNull(); // too long
    expect(normalizePlayCode("ABC10O")).toBeNull(); // 0/1/O aren't in the alphabet
    expect(normalizePlayCode(42)).toBeNull();
    expect(normalizePlayCode(null)).toBeNull();
  });
});
