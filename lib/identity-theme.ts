// Identity → view theme. The deck/pool view background is driven by the deck's
// colour identity (mono-blue → blue, etc); the home and login views reuse the
// same machinery with the neutral (colourless) palette so the whole app shares
// one immersive, themed look. Returns CSS-variable overrides applied on a
// wrapper, so every component that styles through these tokens reskins for free.

import type { CSSProperties } from "react";

export type IdentityTheme = {
  bg: string;
  text: string;
  dotEmpty: string;
  vars: CSSProperties;
};

// Saturated identity fields, keyed by the deck's colour letters sorted
// alphabetically (B,G,R,U,W). Each is a `bg` field colour and a darker `deep`
// pole; the view background is a radial gradient between them. Mono colours and
// the ten two-colour guilds are tuned individually so every common identity has
// its own field (matching the Color Identity design); rarer 3+ colour decks
// blend their mono fields.
const ID_THEME: Record<string, { bg: string; deep: string }> = {
  // mono
  W: { bg: "#c79a2e", deep: "#9a7414" },
  U: { bg: "#4536e6", deep: "#2c1f9e" },
  B: { bg: "#48424f", deep: "#292430" },
  R: { bg: "#d2452f", deep: "#9a2a18" },
  G: { bg: "#2f7a4c", deep: "#195030" },
  C: { bg: "#5a5560", deep: "#3a3640" },
  // guilds (alphabetically-sorted keys)
  UW: { bg: "#3f7fd6", deep: "#22568f" }, // azorius
  BU: { bg: "#3f4f8a", deep: "#262f57" }, // dimir
  BR: { bg: "#8a2f3a", deep: "#561a22" }, // rakdos
  GR: { bg: "#7a6f2c", deep: "#4e4516" }, // gruul
  GW: { bg: "#6f9a3a", deep: "#48631f" }, // selesnya
  BW: { bg: "#6e5f4a", deep: "#473b2c" }, // orzhov
  RU: { bg: "#7a3fd6", deep: "#561f9e" }, // izzet
  BG: { bg: "#2f6b46", deep: "#19452c" }, // golgari
  RW: { bg: "#d23f33", deep: "#9a2419" }, // boros
  GU: { bg: "#2f8a7a", deep: "#195a4e" }, // simic
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
// Average several hex tones into one solid colour (for 3+ colour decks with no
// dedicated field).
function blendHexes(hexes: string[]): string {
  const sum = hexes.reduce<[number, number, number]>(
    (acc, h) => {
      const [r, g, b] = hexToRgb(h);
      return [acc[0] + r, acc[1] + g, acc[2] + b];
    },
    [0, 0, 0]
  );
  return rgbToHex(sum[0] / hexes.length, sum[1] / hexes.length, sum[2] / hexes.length);
}

// Resolve a colour identity to its saturated field: an exact mono/guild match
// where one exists, otherwise (3+ colours or an unlisted set) a blend of the
// mono fields. Returned `bg`/`deep` are the light and dark poles of the field.
export function getIdentityField(identity: string | null | undefined): { bg: string; deep: string } {
  const set = new Set((identity ?? "").toUpperCase().replace(/[^WUBRG]/g, "").split(""));
  const key = [...set].sort().join("");
  const exact = ID_THEME[key];
  if (exact) return exact;
  if (set.size === 0) return ID_THEME.C;
  if (set.size === 1) return ID_THEME[[...set][0]] ?? ID_THEME.C;
  const mono = [...set].map((l) => ID_THEME[l] ?? ID_THEME.C);
  return { bg: blendHexes(mono.map((m) => m.bg)), deep: blendHexes(mono.map((m) => m.deep)) };
}

// The indigo table poles — used verbatim when a surface has NO identity (the
// login page, colorless contexts), so the brand ground stays indigo there.
const FELT = { center: "#412fda", mid: "#3726be", edge: "#2d1da1" };
// The near-black every identity ground sinks into at the bottom.
const TABLE_DARK = "#100a18";

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}


/* ---------------------------------------------------------------- contrast */

/* WCAG relative luminance, and the contrast ratio between two opaque colours. */
function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relLuminance(a), relLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* White at `alpha` composited over `bg`, as an opaque hex. */
function whiteOver(bg: string, alpha: number): string {
  const [r, g, b] = hexToRgb(bg);
  return rgbToHex(alpha * 255 + (1 - alpha) * r, alpha * 255 + (1 - alpha) * g, alpha * 255 + (1 - alpha) * b);
}

/* AA for body text. The dim tier is small print used for hints and units, and
   holding it to the same bar is what stops it dissolving on a pale field. */
const AA = 4.5;

/**
 * The lowest alpha at which white still clears `target` contrast on `bg`,
 * never going below `floor`.
 *
 * The muted tiers were fixed alphas — .78 and .55 — tuned on the near-black
 * feed and the indigo table. On a deck's own ground they are whatever they
 * happen to be: on naya's gold the dim tier measures 3.0:1, which is why the
 * eyebrow, "Helmed by" and "67 to go" go to mush there. Solving for the ground
 * the deck actually has keeps them legible on every identity instead.
 */
function legibleWhiteAlpha(bg: string, floor: number, target = AA): number {
  if (contrastRatio(whiteOver(bg, floor), bg) >= target) return floor;
  let lo = floor;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(whiteOver(bg, mid), bg) >= target) hi = mid;
    else lo = mid;
  }
  return Math.min(1, Math.round(hi * 100) / 100);
}

/**
 * Sink a field's top stop until plain white clears AA on it.
 *
 * Only the palest identities need this — mono-white's gold measures 3.45:1
 * against white, so even the solid tier failed. Dark ink is NOT the answer on
 * a deck page: this ground is a gradient that sinks to the near-black table by
 * the bottom of a long page, where dark type would be the unreadable one. The
 * hue is preserved; only how far it starts down the sink changes.
 */
function sinkUntilLegible(top: string, deep: string): string {
  let out = top;
  for (let step = 0; step < 8 && contrastRatio("#ffffff", out) < AA; step++) {
    out = mixHex(out, deep, 0.12);
  }
  return out;
}

export function getIdentityTheme(identity: string | null | undefined): IdentityTheme {
  const letters = (identity ?? "").toUpperCase().replace(/[^WUBRG]/g, "");

  // A deck's ground IS its identity: the field colour up top sinking into a
  // darkened version of itself — a mono-red page reads red, Golgari reads
  // green-black. (A weak wash into the indigo used to turn everything purple.)
  // No identity at all → the plain indigo table, so neutral surfaces stay brand.
  let top: string, mid: string, bottom: string;
  if (letters) {
    const field = getIdentityField(letters);
    // Sunk further when the identity is pale enough that plain white fails on
    // it — mono-white's gold, mostly. Everything else lands here unchanged.
    top = sinkUntilLegible(mixHex(field.bg, TABLE_DARK, 0.15), TABLE_DARK);
    mid = field.deep;
    bottom = mixHex(field.deep, TABLE_DARK, 0.45);
  } else {
    top = FELT.center;
    mid = FELT.mid;
    bottom = FELT.edge;
  }
  const bg = `linear-gradient(180deg, ${top}, ${mid} 55%, ${bottom} 100%)`;
  /* The two muted tiers, solved against the PALEST part of this deck's ground.
     Everything drawn on this page has to survive the top of the gradient, so
     that is what they are measured on; further down they only get easier. */
  const a2 = legibleWhiteAlpha(top, 0.78);
  const a3 = legibleWhiteAlpha(top, 0.55);
  const w2 = `rgba(255,255,255,${a2})`;
  const w3 = `rgba(255,255,255,${a3})`;
  // Hairlines and fills ride the same field, so they lift with it.
  const lift = Math.max(1, a3 / 0.55);
  const bgSolid = mid;
  // Floating panels (.id-card) sit on a darker cut of the same ground.
  const panel = mixHex(mid, "#05030a", 0.3);

  // An identity ground is a saturated colour, so everything ON it is inked for
  // dark whatever the viewer's preference — the same rule the app follows, and
  // why its `.white` survives over card art and identity fills.
  //
  // The accent is the LIFTED yellow (Brand.gold), not the 0xF5C425 that used to
  // be here: that is the value the iOS tab bar is FED, and Liquid Glass lifts it
  // on screen. Drawn flat it came out a different yellow from every other yellow
  // in the product, which is the mismatch the app fixed.
  return {
    bg,
    text: "#fff",
    dotEmpty: `rgba(255,255,255,${Math.min(0.42, 0.18 * lift).toFixed(2)})`,
    vars: {
      ["--bg" as string]: bgSolid,
      "--bg2": bgSolid,
      "--panel": panel,
      "--bg3": `rgba(255,255,255,${Math.min(0.22, 0.1 * lift).toFixed(2)})`,
      "--surface": "rgba(255,255,255,.07)",
      "--surface2": "rgba(255,255,255,.05)",
      "--text": "#fff",
      "--t1": "#fff",
      "--text-muted": w2,
      "--t2": w2,
      "--text-dim": w3,
      "--t3": w3,
      "--accent": "#fdf26f",
      "--accent-hover": "#fdf58c",
      "--gold": "#fdf26f",
      "--gold-bright": "#fdf58c",
      "--accent-ink": "#181228",
      "--line": `rgba(255,255,255,${Math.min(0.4, 0.16 * lift).toFixed(2)})`,
      "--border": `rgba(255,255,255,${Math.min(0.4, 0.16 * lift).toFixed(2)})`,
      // The white-on-colour scale, pinned back. It follows the PAGE at :root so
      // a ghost button on a light landing isn't white on paper — but this
      // ground is a saturated field in either dress, so here it is white again.
      "--w-1": "#fff",
      "--w-2": w2,
      "--w-3": w3,
      "--w-line": `rgba(255,255,255,${Math.min(0.42, 0.18 * lift).toFixed(2)})`,
      "--w-line-2": "rgba(255,255,255,.32)",
      "--w-fill": "rgba(255,255,255,.1)",
      "--w-fill-2": "rgba(255,255,255,.16)",
    } as CSSProperties,
  };
}

// Panel palette for floating surfaces (modals, the login card). Dialogs sit on
// a slightly lifted panel rather than flipping to a light card, the way the
// app's sheets do. (Name kept so call sites don't churn; the values are the
// panel set, not a light theme — they have never been one.)
//
// Fixed dark, and deliberately so: these ride on top of a deck page's identity
// ground, which is a saturated colour in the app's dark and Colorful dresses.
// A panel that followed the PAGE would be a pale card on a red table.
export const LIGHT_VARS: CSSProperties = {
  ["--bg" as string]: "#0c0c0c",
  "--bg2": "#131313",
  "--bg3": "rgba(255,255,255,.08)",
  "--surface": "rgba(255,255,255,.06)",
  "--surface2": "rgba(255,255,255,.09)",
  "--text": "#fff",
  "--t1": "#fff",
  "--text-muted": "#868686",
  "--t2": "#868686",
  "--text-dim": "rgba(255,255,255,.45)",
  "--t3": "rgba(255,255,255,.45)",
  "--accent": "#fdf26f",
  "--accent-hover": "#fdf58c",
  "--gold": "#fdf26f",
  "--gold-bright": "#fdf58c",
  "--accent-ink": "#181228",
  "--line": "#2a2a2a",
  "--border": "#2a2a2a",
} as CSSProperties;
