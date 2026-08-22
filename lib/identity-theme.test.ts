import { describe, expect, it } from "vitest";
import { contrastRatio, getIdentityTheme, getIdentityField } from "./identity-theme";

/** Every colour identity a deck can have, plus the no-identity case. */
const ALL: string[] = [];
for (let mask = 1; mask < 32; mask++) {
  ALL.push("WUBRG".split("").filter((_, i) => mask & (1 << i)).join(""));
}

/** The gradient's top stop — the palest thing anything on the page sits on. */
function topStop(identity: string): string {
  const grad = getIdentityTheme(identity).bg.match(/#[0-9a-f]{6}/gi) ?? [];
  const first = grad[0];
  // Throw rather than substitute. An identity whose ground has no hex stop is
  // a bug in the theme, and every assertion below is about that first stop —
  // defaulting it would quietly test a colour the page never shows.
  if (!first) throw new Error(`no gradient stop for identity "${identity}"`);
  return first;
}

/** White at `alpha` over `bg`, as opaque hex — what the eye actually sees. */
function composite(alpha: number, bg: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const mix = (c: number) => Math.round(alpha * 255 + (1 - alpha) * c);
  return "#" + [mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

const alphaOf = (rgba: string) => Number(rgba.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1);

describe("identity ground legibility", () => {
  // The bug: these were fixed alphas tuned on the near-black feed. On naya's
  // gold the dim tier measured 3.0:1 and the eyebrow, "Helmed by" and
  // "67 to go" went to mush.
  it.each(ALL)("keeps every text tier readable on %s", (identity) => {
    const theme = getIdentityTheme(identity);
    const vars = theme.vars as unknown as Record<string, string>;
    const top = topStop(identity);

    // Solid white is the floor the ground itself must clear.
    expect(contrastRatio("#ffffff", top)).toBeGreaterThanOrEqual(4.5);

    for (const token of ["--w-2", "--w-3", "--t2", "--t3", "--text-muted", "--text-dim"]) {
      const seen = composite(alphaOf(vars[token]), top);
      expect(contrastRatio(seen, top), `${token} on ${identity}`).toBeGreaterThanOrEqual(4.45);
    }
  });

  // Sinking the ground must not repaint the deck: naya stays gold, simic stays
  // teal. Only how far down the sink it starts is allowed to move.
  it("preserves each identity's hue while sinking it", () => {
    for (const identity of ALL) {
      const field = getIdentityField(identity);
      const top = topStop(identity);
      const chan = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const [fr, fg, fb] = chan(field.bg);
      const [tr, tg, tb] = chan(top);
      // The channel ORDER is the hue's signature — a gold stays R>G>B.
      const order = (a: number, b: number, c: number) => `${a > b}${b > c}${a > c}`;
      expect(order(tr, tg, tb), identity).toBe(order(fr, fg, fb));
    }
  });

  // No identity → the brand indigo, untouched.
  it("leaves the no-identity table alone", () => {
    expect(getIdentityTheme(null).bg).toContain("#412fda");
    expect(getIdentityTheme("").bg).toContain("#412fda");
  });
});
