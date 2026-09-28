import { describe, expect, it } from "vitest";
import { withoutOwned } from "./collection-diff";

describe("withoutOwned", () => {
  it("drops cards you own, and trims the ones you own fewer of", () => {
    const out = withoutOwned(
      [
        { name: "Sol Ring", quantity: 1 },
        { name: "Mountain", quantity: 30 },
        { name: "Krenko, Mob Boss", quantity: 1 },
      ],
      [
        { name: "sol ring", quantity: 2 },
        { name: "Mountain", quantity: 10 },
      ]
    );
    expect(out).toEqual([
      { name: "Mountain", quantity: 20 },
      { name: "Krenko, Mob Boss", quantity: 1 },
    ]);
  });
  it("spends what you own once across rows of the same card", () => {
    const out = withoutOwned(
      [
        { name: "Island", quantity: 5 },
        { name: "Island", quantity: 5 },
      ],
      [{ name: "Island", quantity: 7 }]
    );
    expect(out).toEqual([{ name: "Island", quantity: 3 }]);
  });
  it("keeps everything when you own nothing", () => {
    expect(withoutOwned([{ name: "Sol Ring", quantity: 1 }], [])).toEqual([{ name: "Sol Ring", quantity: 1 }]);
  });
});
