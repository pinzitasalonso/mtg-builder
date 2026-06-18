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

export const IDENTITY_BG: Record<string, { bg: string; light?: boolean }> = {
  W: { bg: "#d9cda2", light: true },
  U: { bg: "#3f3ce6" },
  B: { bg: "#191921" },
  R: { bg: "#b22f33" },
  G: { bg: "#2b7a48" },
  c: { bg: "#45464f" },
};

// Per-color tones used to build a multicolor deck's gradient. They mirror the
// mono backgrounds, except white is deepened from its light mono tan so white
// body text stays readable across the whole blend.
const GRADIENT_TONE: Record<string, string> = {
  W: "#9a8a52",
  U: "#3f3ce6",
  B: "#191921",
  R: "#b22f33",
  G: "#2b7a48",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
// Average several hex tones into one solid colour, for the contexts that can't
// take a gradient: the CSS --bg variables (used in color-mix and as the sticky
// header fill).
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

export function getIdentityTheme(identity: string | null | undefined): IdentityTheme {
  const set = new Set((identity ?? "").toUpperCase().replace(/[^WUBRG]/g, "").split(""));
  const letters = ["W", "U", "B", "R", "G"].filter((l) => set.has(l));

  // bg drives `background:` (a gradient for multicolor decks); bgSolid is the
  // single colour used for the --bg variables, which must stay valid colours.
  let bg: string;
  let bgSolid: string;
  let light = false;

  if (letters.length >= 2) {
    const tones = letters.map((l) => GRADIENT_TONE[l]);
    const stops = tones
      .map((t, i) => `${t} ${Math.round((i / (tones.length - 1)) * 100)}%`)
      .join(", ");
    bg = `linear-gradient(140deg, ${stops})`;
    bgSolid = blendHexes(tones);
  } else {
    const conf = letters.length === 1 ? IDENTITY_BG[letters[0]] : IDENTITY_BG.c;
    bg = conf.bg;
    bgSolid = conf.bg;
    light = Boolean(conf.light);
  }

  if (light) {
    const text = "#211d12";
    return {
      bg,
      text,
      dotEmpty: "rgba(33,29,18,.16)",
      vars: {
        ["--bg" as string]: bgSolid,
        "--bg2": bgSolid,
        "--bg3": "rgba(33,29,18,.07)",
        "--surface": "#ffffff",
        "--surface2": "rgba(33,29,18,.05)",
        "--text": text,
        "--t1": text,
        "--text-muted": "rgba(33,29,18,.7)",
        "--t2": "rgba(33,29,18,.7)",
        "--text-dim": "rgba(33,29,18,.46)",
        "--t3": "rgba(33,29,18,.46)",
        "--accent": "#2742d6",
        "--accent-hover": "#1d35b8",
        "--gold": "#2742d6",
        "--gold-bright": "#1d35b8",
        "--accent-ink": "#ffffff",
        "--line": "rgba(33,29,18,.16)",
        "--border": "rgba(33,29,18,.16)",
      } as CSSProperties,
    };
  }

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
      "--accent": "#ffd23f",
      "--accent-hover": "#ffdf6b",
      "--gold": "#ffd23f",
      "--gold-bright": "#ffdf6b",
      "--accent-ink": "#2a2205",
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
