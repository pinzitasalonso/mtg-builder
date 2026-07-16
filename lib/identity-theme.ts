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
  B: { bg: "#5b4a6e", deep: "#3a2d4c" },
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

// The iOS Tabletop felt poles — identity fields wash INTO these instead of
// standing as saturated colour, so a mono-blue deck reads as blue-tinted felt
// rather than a vivid blue page (matching IdentityFeltBackground in the app).
const FELT = { center: "#262030", mid: "#17131d", edge: "#0e0b12" };

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function getIdentityTheme(identity: string | null | undefined): IdentityTheme {
  const field = getIdentityField(identity);

  // Wash the identity into the felt: mostly felt, a breath of the deck's hue
  // at the top-right pole fading to near-black felt at the edges.
  const washTop = mixHex(FELT.center, field.bg, 0.34);
  const washMid = mixHex(FELT.mid, field.deep, 0.22);
  const bg = `radial-gradient(125% 85% at 85% -10%, ${washTop}, ${washMid} 55%, ${FELT.edge} 100%)`;
  const bgSolid = washMid;

  return {
    bg,
    text: "#f4f0e6",
    dotEmpty: "rgba(255,255,255,.18)",
    vars: {
      ["--bg" as string]: bgSolid,
      "--bg2": bgSolid,
      "--bg3": "rgba(255,255,255,.1)",
      "--surface": "rgba(255,255,255,.07)",
      "--surface2": "rgba(255,255,255,.05)",
      "--text": "#f4f0e6",
      "--t1": "#f4f0e6",
      "--text-muted": "rgba(244,240,230,.74)",
      "--t2": "rgba(244,240,230,.74)",
      "--text-dim": "rgba(244,240,230,.52)",
      "--t3": "rgba(244,240,230,.52)",
      "--accent": "#f5c425",
      "--accent-hover": "#ffcf3a",
      "--gold": "#f5c425",
      "--gold-bright": "#ffcf3a",
      "--accent-ink": "#181228",
      "--line": "rgba(255,255,255,.16)",
      "--border": "rgba(255,255,255,.16)",
    } as CSSProperties,
  };
}

// Panel palette for floating surfaces (modals, the login card). The whole app
// is dark felt now — like the iOS app, dialogs sit on a slightly lifted felt
// panel rather than flipping to a light card. (Name kept so call sites don't
// churn; the values are the Tabletop panel, not a light theme.)
export const LIGHT_VARS: CSSProperties = {
  ["--bg" as string]: "#1c1722",
  "--bg2": "#262030",
  "--bg3": "rgba(255,255,255,.08)",
  "--surface": "rgba(255,255,255,.06)",
  "--surface2": "rgba(255,255,255,.09)",
  "--text": "#f4f0e6",
  "--t1": "#f4f0e6",
  "--text-muted": "rgba(244,240,230,.72)",
  "--t2": "rgba(244,240,230,.72)",
  "--text-dim": "rgba(244,240,230,.52)",
  "--t3": "rgba(244,240,230,.52)",
  "--accent": "#f5c425",
  "--accent-hover": "#ffcf3a",
  "--gold": "#f5c425",
  "--gold-bright": "#ffcf3a",
  "--accent-ink": "#181228",
  "--line": "rgba(255,255,255,.14)",
  "--border": "rgba(255,255,255,.14)",
} as CSSProperties;
