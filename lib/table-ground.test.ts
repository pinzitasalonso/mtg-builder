import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TABLE_GROUND } from "./table-ground";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("the table's flat ground", () => {
  it("is the middle of the table's gradient", () => {
    const base = /\.pt-root \{[^}]*linear-gradient\(180deg, (#[0-9a-f]{6}), (#[0-9a-f]{6})\)/.exec(css);
    expect(base).not.toBeNull();
    const [top, bottom] = [rgb(base![1]!), rgb(base![2]!)];
    expect(rgb(TABLE_GROUND)).toEqual(top.map((c, i) => Math.floor((c + bottom[i]!) / 2)));
  });

  it("is the colour the table fades into at its edges on a phone held sideways", () => {
    // The page behind the table is painted TABLE_GROUND; the strips an iPhone
    // leaves beside the notch are that colour, and the table has to meet it.
    const fades = css.match(/linear-gradient\((?:90|270)deg, (#[0-9a-f]{6}), rgba\((\d+), (\d+), (\d+), 0\) 32px\)/g) ?? [];
    expect(fades).toHaveLength(2);
    for (const f of fades) {
      expect(f).toContain(TABLE_GROUND);
      expect(f).toContain(`rgba(${rgb(TABLE_GROUND).join(", ")}, 0)`);
    }
  });
});
