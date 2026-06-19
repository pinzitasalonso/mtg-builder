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

export function getIdentityTheme(identity: string | null | undefined): IdentityTheme {
  const field = getIdentityField(identity);

  // The display background is a radial gradient toward the deep pole; the --bg
  // variables stay a flat colour (they feed color-mix and opaque fills).
  const bg = `radial-gradient(125% 80% at 85% -10%, ${field.bg}, ${field.deep} 80%)`;
  const bgSolid = field.bg;

  return {
    bg,
    text: "#ffffff",
    dotEmpty: "rgba(255,255,255,.18)",
    vars: {
      ["--bg" as string]: bgSolid,
      "--bg2": bgSolid,
      "--bg3": "rgba(255,255,255,.14)",
      "--surface": "rgba(255,255,255,.08)",
      "--surface2": "rgba(255,255,255,.06)",
      "--text": "#ffffff",
      "--t1": "#ffffff",
      "--text-muted": "rgba(255,255,255,.74)",
      "--t2": "rgba(255,255,255,.74)",
      "--text-dim": "rgba(255,255,255,.52)",
      "--t3": "rgba(255,255,255,.52)",
      "--accent": "#f5c425",
      "--accent-hover": "#ffcf3a",
      "--gold": "#f5c425",
      "--gold-bright": "#ffcf3a",
      "--accent-ink": "#181228",
      "--line": "rgba(255,255,255,.18)",
      "--border": "rgba(255,255,255,.18)",
    } as CSSProperties,
  };
}

// Reset back to the light Swiss palette. Applied to a subtree (a modal card, a
// login panel) so it renders light even while sitting inside a themed dark view —
// mirroring how the deck page floats light modals over its coloured background.
export const LIGHT_VARS: CSSProperties = {
  ["--bg" as string]: "#fbfbf8",
  "--bg2": "#ffffff",
  "--bg3": "#f1f1ec",
  "--surface": "#ffffff",
  "--surface2": "#f1f1ec",
  "--text": "#15151a",
  "--t1": "#15151a",
  "--text-muted": "#5c5c64",
  "--t2": "#5c5c64",
  "--text-dim": "#9a9aa2",
  "--t3": "#9a9aa2",
  "--accent": "#2742d6",
  "--accent-hover": "#1d35b8",
  "--gold": "#2742d6",
  "--gold-bright": "#1d35b8",
  "--accent-ink": "#ffffff",
  "--line": "#e6e6df",
  "--border": "#e6e6df",
} as CSSProperties;
