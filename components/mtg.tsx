"use client";

import { useState, type CSSProperties } from "react";
import { ArrowDownToLine, ArrowUpToLine, TriangleAlert, X } from "lucide-react";

/* ---------- mana / color palette ---------- */
/* Mana discs: a soft top-lit gradient from `hi` to `bg`, with the glyph in
   `fg`. The hues follow the deck identity grounds (lib/identity-theme.ts), a
   step brighter so a disc still reads on its own color's page. `bg` is also
   the flat fill for bars and charts. White and colorless are light discs with
   a dark glyph, as on the printed cards. */
export const MANA: Record<string, { bg: string; hi: string; fg: string; ring: string }> = {
  W: { bg: "#ecd9a0", hi: "#fbf3d9", fg: "#8a6410", ring: "rgba(90,64,8,.22)" },
  U: { bg: "#4a4ff0", hi: "#7d8bff", fg: "#ffffff", ring: "rgba(20,16,90,.35)" },
  B: { bg: "#3a3441", hi: "#5f5769", fg: "#efe9f5", ring: "rgba(0,0,0,.4)" },
  R: { bg: "#dc4a31", hi: "#f57b5a", fg: "#ffffff", ring: "rgba(90,20,8,.35)" },
  G: { bg: "#2f8350", hi: "#4fb274", fg: "#ffffff", ring: "rgba(8,50,24,.35)" },
  C: { bg: "#bdb8c4", hi: "#e6e3ea", fg: "#2d2934", ring: "rgba(20,16,28,.22)" },
};
export const COLOR_NAME: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};
const WUBRG = ["W", "U", "B", "R", "G"];

/* ---------- mana-cost parsing (Scryfall string -> tokens / mv / colors) ----------
   Real cards store manaCost like "{2}{U}{U}", "{X}{R}", "{W/U}", "{U/P}". */
export function parseSymbols(manaCost: string | null | undefined): string[] {
  if (!manaCost) return [];
  return Array.from(manaCost.matchAll(/\{([^}]+)\}/g)).map((m) => m[1].toUpperCase());
}

export function manaValue(manaCost: string | null | undefined): number {
  let mv = 0;
  for (const s of parseSymbols(manaCost)) {
    if (/^\d+$/.test(s)) mv += parseInt(s, 10);
    else if (s === "X" || s === "Y" || s === "Z") mv += 0;
    else mv += 1; // colored, hybrid, phyrexian, colorless
  }
  return mv;
}

export function colorsOf(manaCost: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const s of parseSymbols(manaCost)) {
    for (const c of WUBRG) if (s.includes(c)) found.add(c);
  }
  return WUBRG.filter((c) => found.has(c));
}

/* ---------- pips ---------- */
/* The five mana glyphs plus colorless and Phyrexian, drawn on one 24-unit grid
   so they share weight and optical size. Each is a single filled path; holes
   (the skull's eyes, the flame's core) are even-odd cut-outs, so a glyph shows
   whatever sits behind it rather than a painted-on disc color. */
const GLYPH_PATHS: Record<string, string> = {
  // Sun: a disc with eight tapered rays, long and short in turn.
  W: (() => {
    let d = "M12 8.3a3.7 3.7 0 1 1 0 7.4a3.7 3.7 0 1 1 0-7.4Z";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const tip = i % 2 ? 8 : 9.6;
      const r0 = 5.1, w = i % 2 ? 0.95 : 1.25;
      const p = (r: number, off: number) => {
        const x = 12 + r * Math.cos(a) - off * Math.sin(a);
        const y = 12 + r * Math.sin(a) + off * Math.cos(a);
        return `${x.toFixed(2)} ${y.toFixed(2)}`;
      };
      d += `M${p(r0, -w)}L${p(tip, 0)}L${p(r0, w)}Z`;
    }
    return d;
  })(),
  // Water drop, with a small highlight cut from its left flank.
  U: "M12 2.8C12 2.8 18.4 9.9 18.4 14.3A6.4 6.4 0 0 1 5.6 14.3C5.6 9.9 12 2.8 12 2.8Z M8.6 14.2c0 1.5.8 2.8 2 3.4c-.5-.9-.7-2-.6-3.2c.1-1.3.6-2.6 1.3-3.8c-1.6 1-2.7 2.2-2.7 3.6Z",
  // Skull: cranium and jaw, eyes and nose cut out.
  B: "M12 3.3C7.8 3.3 4.8 6.3 4.8 10.3c0 2.4 1.1 4.2 2.8 5.3v2.6c0 .9.7 1.6 1.6 1.6h5.6c.9 0 1.6-.7 1.6-1.6v-2.6c1.7-1.1 2.8-2.9 2.8-5.3C19.2 6.3 16.2 3.3 12 3.3Z M7.3 11a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z M12.7 11a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z M12 13.6l1.1 2.1h-2.2Z",
  // Fireball: a leaping flame with its hot core cut out.
  R: "M12.4 2.6C13.1 5.9 16.9 7.7 17.9 11.6C18.9 15.7 16 20.2 12 20.2C8 20.2 5.2 17.1 5.6 13.3C5.9 10.6 7.7 9.1 8.6 7.3C9.1 8.8 9.5 9.9 10.5 10.8C10.2 7.7 11.2 5 12.4 2.6Z M12 18.4C10.4 18.4 9.2 17.2 9.3 15.6C9.4 14 10.8 13.1 11.3 11.7C12.3 13 14.8 14.2 14.7 16.1C14.6 17.4 13.4 18.4 12 18.4Z",
  // Tree: a rounded canopy on a flared trunk.
  G: "M12 3.1c2.3 0 4.1 1.6 4.4 3.7c1.7.6 2.9 2.2 2.9 4.1c0 2.4-1.9 4.3-4.3 4.3H13.2v2.9l1.9 1.6H8.9l1.9-1.6v-2.9H9c-2.4 0-4.3-1.9-4.3-4.3c0-1.9 1.2-3.5 2.9-4.1C7.9 4.7 9.7 3.1 12 3.1Z",
  // Colorless: a hollow diamond.
  C: "M12 3.2L19.2 12L12 20.8L4.8 12Z M12 7.4L8.2 12L12 16.6L15.8 12Z",
  // Phyrexian: a ring struck through by a bar.
  P: "M12 5.6a6.4 6.4 0 1 1 0 12.8a6.4 6.4 0 1 1 0-12.8Z M12 7.6a4.4 4.4 0 1 0 0 8.8a4.4 4.4 0 1 0 0-8.8Z M11 2.8h2v18.4h-2Z",
};

export function ManaGlyph({ type, color, size }: { type: string; color: string; size: number }) {
  const d = GLYPH_PATHS[type] ?? GLYPH_PATHS.C;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flex: "none" }} aria-hidden="true">
      <path d={d} fill={color} fillRule={type === "G" || type === "P" ? "nonzero" : "evenodd"} />
    </svg>
  );
}

const GLYPHS = new Set(["W", "U", "B", "R", "G", "C"]);
const disc = (k: string) => `linear-gradient(160deg, ${MANA[k].hi}, ${MANA[k].bg} 72%)`;

/** How a mana symbol reads aloud: "{2/W}" → "two generic or white". */
export function symbolName(sym: string): string {
  const one = (p: string) =>
    COLOR_NAME[p]?.toLowerCase() ?? (p === "P" ? "Phyrexian" : /^\d+$/.test(p) ? `${p} generic` : p === "S" ? "snow" : p);
  const parts = sym.split("/");
  if (parts.includes("P")) return `Phyrexian ${parts.filter((p) => p !== "P").map(one).join(" or ")}`;
  return parts.map(one).join(" or ");
}

/** One mana symbol: a color disc with its glyph, a gray disc with a number,
 *  a split disc for hybrid, or a color disc with the Phyrexian mark. */
export function Pip({ sym, size = 18 }: { sym: string; size?: number }) {
  const parts = sym.split("/");
  const phyrexian = parts.includes("P");
  const colors = parts.filter((p) => p !== "P");
  const base: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    overflow: "hidden",
    lineHeight: 1,
  };
  const label = symbolName(sym);

  // Hybrid ({W/U}, {2/W}): split on the diagonal, a half-size mark in each half.
  if (colors.length === 2) {
    const [a, b] = colors.map((c) => (MANA[c] ? c : "C"));
    const mark = (p: string, k: string, pos: CSSProperties) => (
      <span style={{ position: "absolute", ...pos, display: "flex" }}>
        {GLYPHS.has(p) ? (
          <ManaGlyph type={p} color={MANA[k].fg} size={size * 0.46} />
        ) : (
          <span style={{ fontSize: size * 0.42, fontWeight: 800, color: MANA[k].fg, fontFamily: "var(--font-ui)", display: "block", lineHeight: 1 }}>{p}</span>
        )}
      </span>
    );
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{
          ...base,
          background: `linear-gradient(135deg, ${MANA[a].hi}, ${MANA[a].bg} 49.5%, ${MANA[b].bg} 50.5%, ${MANA[b].hi})`,
          boxShadow: `inset 0 0 0 1px ${MANA[b].ring}, 0 1px 2px rgba(0,0,0,.25)`,
        }}
      >
        {mark(colors[0], a, { top: size * 0.1, left: size * 0.12 })}
        {mark(colors[1], b, { bottom: size * 0.1, right: size * 0.12 })}
      </span>
    );
  }

  const c = colors[0] ?? "C";
  const key = MANA[c] ? c : "C";
  const m = MANA[key];
  const glyph = phyrexian ? "P" : GLYPHS.has(c) ? c : null;
  // Generic costs and anything without a glyph (X, 10, S) set as numerals.
  const text = c.length > 2 ? c.slice(0, 2) : c;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ ...base, background: disc(key), boxShadow: `inset 0 0 0 1px ${m.ring}, inset 0 1px 0 rgba(255,255,255,.28), 0 1px 2px rgba(0,0,0,.25)` }}
    >
      {glyph ? (
        <ManaGlyph type={glyph} color={m.fg} size={size * 0.84} />
      ) : (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 800,
            fontSize: size * (text.length > 1 ? 0.5 : 0.62),
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
            color: m.fg,
            // Numerals have no descenders, so the line box centers them high.
            transform: "translateY(0.06em)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function ManaCost({ cost, size = 18 }: { cost: string | null | undefined; size?: number }) {
  const syms = parseSymbols(cost);
  if (syms.length === 0) return null;
  return (
    <span role="img" aria-label={`Mana cost: ${syms.map(symbolName).join(", ")}`} style={{ display: "inline-flex", gap: Math.max(2, size * 0.14), alignItems: "center", flex: "none" }}>
      {syms.map((s, i) => (
        <span key={i} aria-hidden="true" style={{ display: "flex" }}>
          <Pip sym={s} size={size} />
        </span>
      ))}
    </span>
  );
}

export function ColorPips({ colors, size = 16 }: { colors: string[]; size?: number }) {
  const list = colors.length ? colors : ["C"];
  return (
    <span
      role="img"
      aria-label={list.map((c) => COLOR_NAME[c] ?? c).join(", ")}
      style={{ display: "inline-flex", gap: Math.max(3, size * 0.18), flex: "none" }}
    >
      {list.map((c, i) => (
        <span key={i} aria-hidden="true" style={{ display: "flex" }}>
          <Pip sym={c} size={size} />
        </span>
      ))}
    </span>
  );
}

/**
 * The card name to fetch art for, given a deck's stored commander.
 *
 * TWO THINGS THIS EXISTS TO STOP, both of which asked Scryfall for a card that
 * does not exist and got a 404 in the console for it:
 *
 *   A PARTNER PAIR is stored as "A + B" — one field, the form iOS writes and
 *   the web now produces too. Asked for whole, Scryfall has never heard of it,
 *   so a RogSi deck lost the art it should have had. The first commander's art
 *   is the deck's face, which is what the app shows.
 *
 *   NO COMMANDER AT ALL. Call sites fell back to the deck's NAME, so a Standard
 *   deck called "Jeskai Control" was looked up as a card. There is no art to
 *   find; the placeholder is the right answer and needs no request.
 */
export function commanderArtName(commander?: string | null): string | undefined {
  const first = (commander ?? "").split("+")[0].trim();
  return first || undefined;
}

/* ---------- card art (prefer stored image; fall back to Scryfall art-crop) ---------- */
function artURL(name: string, version: string) {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
}

export function CardArt({
  name,
  label: labelText,
  src,
  colors = ["C"],
  version = "art_crop",
  radius = 0,
  prefer = "art",
  loading,
  style,
}: {
  /** A REAL card name. Anything else is a guaranteed 404 — see commanderArtName. */
  name?: string;
  /** What the placeholder spells when there is no art. Defaults to `name`,
      so a deck with no commander can still show its own initials without the
      deck's name being mistaken for a card. */
  label?: string;
  src?: string;
  colors?: string[];
  version?: string;
  radius?: number;
  /** "art" tries the name-based fetch first (cropped look); "src" shows the
      stored image first — for full-card tiles — falling back to the name fetch
      and then the placeholder if the stored URL has gone stale. */
  prefer?: "art" | "src";
  loading?: "lazy" | "eager";
  style?: CSSProperties;
}) {
  // art-crop by name gives the clean cropped look the design wants; if that
  // fails (double-faced names, etc.) fall back to the stored full image.
  const [stage, setStage] = useState<"art" | "src" | "fallback">(
    prefer === "src" ? (src ? "src" : name ? "art" : "fallback") : name ? "art" : src ? "src" : "fallback"
  );
  const [loaded, setLoaded] = useState(false);
  const url = stage === "art" && name ? artURL(name, version) : stage === "src" ? src : null;
  const m = MANA[colors[0]] || MANA.C;
  const label = (labelText || name || "—").slice(0, 2);

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: radius, ...style }}>
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(120% 90% at 30% 10%, ${m.bg}22, transparent 60%), linear-gradient(160deg, #1b1e24, #111316)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.05)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 30,
              color: m.bg,
              opacity: 0.5,
              letterSpacing: -1,
            }}
          >
            {label}
          </span>
        </div>
      )}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name || ""}
          ref={(el) => {
            // Cached images can complete before React attaches onLoad.
            if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
          }}
          loading={loading}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            // Step down the chain without cycling: whichever of art/src came
            // first falls back to the other (if available), then the placeholder.
            setStage((s) => {
              if (s === "art") return src && prefer !== "src" ? "src" : "fallback";
              return name && prefer === "src" ? "art" : "fallback";
            });
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center 22%",
            opacity: loaded ? 1 : 0,
            transition: "opacity .4s ease",
          }}
        />
      )}
    </div>
  );
}

/* ---------- deck-stat math (operates on real pool cards) ---------- */
export interface StatCardInput {
  manaCost: string | null;
  typeLine: string | null;
  quantity?: number;
}

export function categoryOf(typeLine: string | null): string {
  const t = (typeLine || "").toLowerCase();
  if (t.includes("land")) return "Lands";
  if (t.includes("creature")) return "Creatures";
  if (t.includes("planeswalker")) return "Planeswalkers";
  if (t.includes("instant")) return "Instants";
  if (t.includes("sorcery")) return "Sorceries";
  if (t.includes("artifact")) return "Artifacts";
  if (t.includes("enchantment")) return "Enchantments";
  return "Other";
}

const BASIC_LAND_COLORS: [string, string][] = [
  ["plains", "W"],
  ["island", "U"],
  ["swamp", "B"],
  ["mountain", "R"],
  ["forest", "G"],
];

/* The WUBRG colors a land can put into the pool, read from what the card
   actually does rather than its color identity (which is a rules concept:
   Kessig Wolf Run has an RG identity but taps only for colorless). Sources,
   in order: "any color" text and fetches count as every identity color; basic
   land types (Forest, Triome subtypes, …) grant their color intrinsically;
   explicit "{T}: Add {G} or {W}" abilities are scanned for mana symbols.
   A land whose oracle text hasn't been enriched yet (null) falls back to its
   color identity as the best available guess. */
export function landProducedColors(
  typeLine: string | null,
  oracleText: string | null,
  colorIdentity: string | null,
  identity: string[]
): string[] {
  if (oracleText == null) {
    return (colorIdentity ?? "").split("").filter((c) => WUBRG.includes(c));
  }
  if (/any colou?r/i.test(oracleText)) return identity;
  // Fetch lands (Evolving Wilds, …) grab a land from the library — within a
  // deck that's effectively any identity color.
  if (/search your library for .{0,80}land/i.test(oracleText)) return identity;
  const found = new Set<string>();
  const t = (typeLine || "").toLowerCase();
  for (const [subtype, c] of BASIC_LAND_COLORS) if (t.includes(subtype)) found.add(c);
  for (const clause of oracleText.matchAll(/\badd [^.\n]*/gi)) {
    for (const sym of clause[0].matchAll(/\{([WUBRG])\}/g)) found.add(sym[1]);
  }
  return WUBRG.filter((c) => found.has(c));
}
export const TYPE_ORDER = [
  "Creatures",
  "Instants",
  "Sorceries",
  "Artifacts",
  "Enchantments",
  "Planeswalkers",
  "Lands",
  "Other",
];

export interface DeckStats {
  curve: number[];
  types: { name: string; n: number }[];
  colors: Record<string, number>;
  avgMv: number;
  count: number;
}

export function deckStats(pool: StatCardInput[]): DeckStats {
  const curve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..6, 7+
  const types: Record<string, number> = {};
  const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let mvSum = 0;
  let mvCount = 0;
  let total = 0;
  for (const c of pool) {
    const qty = c.quantity && c.quantity > 0 ? c.quantity : 1;
    total += qty;
    const cat = categoryOf(c.typeLine);
    types[cat] = (types[cat] || 0) + qty;
    if (cat !== "Lands") {
      const mv = manaValue(c.manaCost);
      curve[Math.min(mv, 7)] += qty;
      mvSum += mv * qty;
      mvCount += qty;
    }
    const cs = colorsOf(c.manaCost);
    (cs.length ? cs : ["C"]).forEach((col) => {
      if (colors[col] != null) colors[col] += qty;
    });
  }
  return {
    curve,
    types: TYPE_ORDER.filter((t) => types[t]).map((t) => ({ name: t, n: types[t] })),
    colors,
    avgMv: mvCount ? mvSum / mvCount : 0,
    count: total,
  };
}

/* ---------- stat widgets ---------- */
export function ManaCurve({
  curve,
  accent,
  onHoverBar,
  onClickBar,
}: {
  curve: number[];
  accent: string;
  /** Fires with the bar index (0–7, where 7 = "7+") on hover, null on leave.
      Only bars with cards are interactive. */
  onHoverBar?: (i: number | null) => void;
  /** Fires with the bar index when a filled bar is clicked. */
  onClickBar?: (i: number) => void;
}) {
  const max = Math.max(1, ...curve);
  const labels = ["0", "1", "2", "3", "4", "5", "6", "7+"];
  const [hover, setHover] = useState<number | null>(null);
  const enter = (i: number, n: number) => {
    if (!n || !onHoverBar) return;
    setHover(i);
    onHoverBar(i);
  };
  const leave = () => {
    if (!onHoverBar) return;
    setHover(null);
    onHoverBar(null);
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 92 }}>
      {curve.map((n, i) => (
        <div
          key={i}
          onMouseEnter={() => enter(i, n)}
          onMouseLeave={leave}
          onClick={() => n && onClickBar?.(i)}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            height: "100%",
            justifyContent: "flex-end",
            cursor: n ? "pointer" : "default",
            opacity: hover === null || hover === i ? 1 : 0.35,
            transition: "opacity .12s",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", height: 13 }}>
            {n || ""}
          </span>
          <div
            style={{
              width: "100%",
              height: `${(n / max) * 100}%`,
              minHeight: n ? 4 : 0,
              background: n ? accent : "transparent",
              borderRadius: 4,
              transition: "height .5s cubic-bezier(.2,.8,.2,1)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function ColorBar({ colors }: { colors: Record<string, number> }) {
  const entries = Object.entries(colors).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {entries.map(([c, n]) => (
          <div key={c} title={COLOR_NAME[c]} style={{ width: `${(n / total) * 100}%`, background: MANA[c].bg }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {entries.map(([c, n]) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            <Pip sym={c} size={13} /> {COLOR_NAME[c]}{" "}
            <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function TypeBreakdown({ types, accent }: { types: { name: string; n: number }[]; accent: string }) {
  const max = Math.max(1, ...types.map((t) => t.n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {types.map((t) => (
        <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 92, fontSize: 12.5, color: "var(--text-muted)", flex: "none" }}>{t.name}</span>
          <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--bar-track)", overflow: "hidden" }}>
            <div style={{ width: `${(t.n / max) * 100}%`, height: "100%", background: accent, borderRadius: 4, opacity: 0.85 }} />
          </div>
          <span
            style={{
              width: 20,
              textAlign: "right",
              fontSize: 12.5,
              color: "var(--text)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          >
            {t.n}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CountRing({ count, target, accent }: { count: number; target: number; accent: string }) {
  const pct = Math.min(1, target ? count / target : 0);
  const r = 30;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 76, height: 76, flex: "none" }}>
      <svg width="76" height="76" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--ring-track)" strokeWidth="6" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 19, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {count}
        </span>
        <span style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 1 }}>/ {target}</span>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--bg2)", borderRadius: 14, border: "1px solid var(--line)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 15px 10px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span className="mn-label" style={{ color: "var(--t2)" }}>
          {label}
        </span>
        {right}
      </div>
      <div style={{ padding: 15 }}>{children}</div>
    </div>
  );
}

/* ============================================================
   Classic (Alpha/Beta) card-frame components — real-card anatomy.
   ============================================================ */

const RARITY_HEX: Record<string, string> = {
  common: "#2b2b2b",
  uncommon: "#b9c2c6",
  rare: "#d7b256",
  mythic: "#d4702a",
};

export function RarityGem({ rarity = "rare", size = 11 }: { rarity?: string; size?: number }) {
  const c = RARITY_HEX[rarity] || RARITY_HEX.rare;
  return (
    <span
      title={rarity}
      style={{
        width: size,
        height: size,
        transform: "rotate(45deg)",
        borderRadius: 2,
        flex: "none",
        background: `linear-gradient(135deg, #fff6, ${c})`,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,.45), 0 0 3px ${c}88`,
      }}
    />
  );
}

/* A serif label engraved directly onto the textured frame. */
export function FrameText({
  children,
  size,
  ink,
  flex,
}: {
  children: React.ReactNode;
  size: number;
  ink?: string;
  flex?: boolean;
}) {
  return (
    <span
      style={{
        flex: flex ? 1 : "none",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: size,
        color: ink || "var(--frame-ink)",
        letterSpacing: "-.01em",
        lineHeight: 1.12,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
      }}
    >
      {children}
    </span>
  );
}

interface FrameCard {
  name: string;
  imageUri?: string | null;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
}

/* The classic card frame. variant "tile" (pool grid) or "full" (swipe modal). */
export function ClassicCard({
  card,
  variant = "tile",
  onRemove,
  onClick,
  style,
  quantity,
  warning,
  onMove,
  moveLabel,
}: {
  card: FrameCard;
  variant?: "tile" | "full";
  onRemove?: () => void;
  onClick?: () => void;
  style?: CSSProperties;
  quantity?: number;
  /** Legality warning text — renders a ⚠ badge with this as tooltip. */
  warning?: string | null;
  /** Board-move action — renders a hover button next to ✕. */
  onMove?: () => void;
  moveLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const full = variant === "full";
  const colors = colorsOf(card.manaCost);
  return (
    <div
      className="cc-black"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        padding: full ? 11 : 8,
        borderRadius: 14,
        cursor: onClick ? "pointer" : "default",
        transform: hover && onClick ? "translateY(-2px)" : "none",
        boxShadow:
          hover && onClick
            ? "0 10px 24px -12px rgba(21,21,26,.25)"
            : "0 1px 2px rgba(21,21,26,.04)",
        transition: "transform .16s ease, box-shadow .16s",
        ...style,
      }}
    >
      {full ? (
        /* full — a readable proxy card (swipe modal, preview fallback) */
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 0" }}>
            <FrameText flex size={20}>
              {card.name}
            </FrameText>
            <ManaCost cost={card.manaCost} size={17} />
          </div>
          <CardArt
            name={card.name}
            src={card.imageUri || undefined}
            colors={colors}
            version="normal"
            radius={10}
            style={{ aspectRatio: "1 / 0.66" }}
          />
          <div style={{ padding: "0 4px", fontSize: 13.5, color: "var(--t3)" }}>{card.typeLine}</div>
          <div style={{ background: "var(--bg3)", borderRadius: 10, padding: "11px 13px 12px", minHeight: 92 }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: "var(--t1)" }}>{card.oracleText}</p>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--t3)" }}>Spellpool · Scryfall</div>
          </div>
        </div>
      ) : (
        /* tile — minimal: art, then name + cost, then type */
        <>
          <CardArt
            name={card.name}
            src={card.imageUri || undefined}
            colors={colors}
            version="art_crop"
            radius={8}
            style={{ aspectRatio: "1 / 0.72" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, padding: "0 4px" }}>
            <span
              style={{
                flex: 1,
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: "-.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {card.name}
            </span>
            <ManaCost cost={card.manaCost} size={13} />
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--t3)",
              padding: "2px 4px 3px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {card.typeLine}
          </div>
        </>
      )}

      {!full && warning && (
        <div
          title={warning}
          style={{
            position: "absolute",
            bottom: 62,
            left: 13,
            width: 24,
            height: 24,
            borderRadius: 7,
            background: "var(--danger)",
            color: "#fff",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(21,21,26,.18)",
          }}
        >
          <TriangleAlert size={13} strokeWidth={2.5} />
        </div>
      )}

      {!full && quantity && quantity > 1 && (
        <div
          style={{
            position: "absolute",
            top: 5,
            left: 5,
            minWidth: 24,
            height: 24,
            padding: "0 6px",
            borderRadius: 7,
            background: "var(--gold)",
            color: "#ffffff",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(21,21,26,.18)",
            pointerEvents: "none",
          }}
        >
          ×{quantity}
        </div>
      )}

      {onMove && !full && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
          title={moveLabel}
          aria-label={moveLabel}
          style={{
            position: "absolute",
            top: 5,
            right: onRemove ? 31 : 5,
            height: 22,
            padding: "0 7px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "rgba(255,255,255,.95)",
            color: "var(--gold, #d8b25e)",
            fontSize: 12,
            fontWeight: 700,
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 1px var(--line)",
            whiteSpace: "nowrap",
          }}
        >
          {moveLabel?.startsWith("Move to deck") ? <ArrowUpToLine size={14} strokeWidth={2.25} /> : <ArrowDownToLine size={14} strokeWidth={2.25} />}
        </button>
      )}

      {onRemove && !full && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 22,
            height: 22,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "rgba(255,255,255,.95)",
            color: "var(--t2)",
            fontSize: 12,
            opacity: hover ? 1 : 0,
            transition: "opacity .15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "inset 0 0 0 1px var(--line)",
          }}
          aria-label="Remove"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/* ---------- misc helpers ---------- */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/* Target deck size by format (commander = 100, the rest 60). */
export function deckTarget(format: string | null | undefined): number {
  return (format || "").toLowerCase() === "commander" ? 100 : 60;
}
