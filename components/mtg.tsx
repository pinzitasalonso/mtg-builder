"use client";

import { useState, type CSSProperties } from "react";

/* ---------- mana / color palette ---------- */
/* Stylized-minimal mana palette: flat colored discs, glyph/letter cut in
   near-white (reads as a cut-out on the light page). */
export const MANA: Record<string, { bg: string; fg: string; ring: string }> = {
  W: { bg: "#dcd1a4", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
  U: { bg: "#4a90c9", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
  B: { bg: "#9b85b5", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
  R: { bg: "#d96b45", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
  G: { bg: "#58a877", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
  C: { bg: "#b8b6ae", fg: "#fbfbf8", ring: "rgba(21,21,26,.08)" },
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
/* Stylized-minimal MTG mana glyphs — cut in the page background color so they
   read as cut-outs on the colored discs. */
export function ManaGlyph({ type, color, size }: { type: string; color: string; size: number }) {
  let body: React.ReactNode;
  switch (type) {
    case "W": // sun
      body = (
        <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3.6" fill={color} stroke="none" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={12 + 6.2 * Math.cos(r)}
                y1={12 + 6.2 * Math.sin(r)}
                x2={12 + 8.6 * Math.cos(r)}
                y2={12 + 8.6 * Math.sin(r)}
              />
            );
          })}
        </g>
      );
      break;
    case "U": // water drop
      body = <path fill={color} d="M12 3.2c2.6 4 5.6 7.2 5.6 10.4a5.6 5.6 0 1 1-11.2 0C6.4 10.4 9.4 7.2 12 3.2z" />;
      break;
    case "B": // skull
      body = (
        <g fill={color}>
          <path d="M12 3.6a6.6 6.6 0 0 0-6.6 6.6c0 2.5 1.2 4.3 2.7 5.4v3h7.8v-3c1.5-1.1 2.7-2.9 2.7-5.4A6.6 6.6 0 0 0 12 3.6z" />
          <circle cx="9.4" cy="10.6" r="1.7" fill={MANA.B.bg} />
          <circle cx="14.6" cy="10.6" r="1.7" fill={MANA.B.bg} />
          <path d="M12 12.6l1.2 2.2h-2.4z" fill={MANA.B.bg} />
        </g>
      );
      break;
    case "R": // flame
      body = (
        <path
          fill={color}
          d="M12.6 3.4c.3 2.9-2.1 4.5-3.4 6.3-1.2 1.7-1.6 3.6-.9 5.5a5.9 5.9 0 0 0 3 3.3c-.7-1.2-.8-2.5-.2-3.7.5-1 1.4-1.7 1.8-2.8.8 1 1.9 2 2.4 3.3.4 1.1.3 2.3-.3 3.2a5.9 5.9 0 0 0 3.2-5.2c0-2.4-1.6-4-3-5.5-1.2-1.3-2.4-2.6-2.6-4.4z"
        />
      );
      break;
    case "G": // tree
      body = (
        <g fill={color}>
          <path d="M12 3.6l4.6 6.4h-2.4l3.4 5H6.4l3.4-5H7.4L12 3.6z" />
          <rect x="10.9" y="14.6" width="2.2" height="4" rx="1" />
        </g>
      );
      break;
    default: // colorless — diamond
      body = <path fill={color} d="M12 4.5L18.5 12 12 19.5 5.5 12z" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }} aria-hidden="true">
      {body}
    </svg>
  );
}

const GLYPHS = new Set(["W", "U", "B", "R", "G", "C"]);

export function Pip({ sym, size = 18 }: { sym: string; size?: number }) {
  const key = sym.length === 1 && MANA[sym] ? sym : "C";
  const m = MANA[key];
  const isMulti = sym.length > 1;
  const isGlyph = !isMulti && GLYPHS.has(sym);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        background: m.bg,
        color: m.fg,
        fontSize: size * (isMulti ? 0.42 : 0.62),
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "var(--font-ui)",
        boxShadow: `inset 0 0 0 1px ${m.ring}`,
      }}
    >
      {isGlyph ? <ManaGlyph type={sym} color={m.fg} size={size * 0.86} /> : isMulti ? sym.replace("/", "") : sym}
    </span>
  );
}

export function ManaCost({ cost, size = 18 }: { cost: string | null | undefined; size?: number }) {
  const syms = parseSymbols(cost);
  if (syms.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {syms.map((s, i) => (
        <Pip key={i} sym={s} size={size} />
      ))}
    </span>
  );
}

export function ColorPips({ colors, size = 16 }: { colors: string[]; size?: number }) {
  const list = colors.length ? colors : ["C"];
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {list.map((c, i) => (
        <Pip key={i} sym={c} size={size} />
      ))}
    </span>
  );
}

/* ---------- card art (prefer stored image; fall back to Scryfall art-crop) ---------- */
function artURL(name: string, version: string) {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
}

export function CardArt({
  name,
  src,
  colors = ["C"],
  version = "art_crop",
  radius = 0,
  style,
}: {
  name?: string;
  src?: string;
  colors?: string[];
  version?: string;
  radius?: number;
  style?: CSSProperties;
}) {
  // art-crop by name gives the clean cropped look the design wants; if that
  // fails (double-faced names, etc.) fall back to the stored full image.
  const [stage, setStage] = useState<"art" | "src" | "fallback">(
    name ? "art" : src ? "src" : "fallback"
  );
  const [loaded, setLoaded] = useState(false);
  const url = stage === "art" && name ? artURL(name, version) : stage === "src" ? src : null;
  const m = MANA[colors[0]] || MANA.C;
  const label = (name || "—").slice(0, 2);

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
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setStage((s) => (s === "art" && src ? "src" : "fallback"));
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
export function ManaCurve({ curve, accent }: { curve: number[]; accent: string }) {
  const max = Math.max(1, ...curve);
  const labels = ["0", "1", "2", "3", "4", "5", "6", "7+"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 92 }}>
      {curve.map((n, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            height: "100%",
            justifyContent: "flex-end",
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
        fontFamily: "var(--font-display)",
        fontWeight: 600,
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
          ⚠
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
          {moveLabel?.startsWith("Move to deck") ? "⇧" : "⇩"}
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
          ✕
        </button>
      )}
    </div>
  );
}

/* Compact list row — parchment ledger line. */
export function ClassicRow({
  card,
  onRemove,
  onClick,
  quantity,
  warning,
  onMove,
  moveLabel,
}: {
  card: FrameCard;
  onRemove?: () => void;
  onClick?: () => void;
  quantity?: number;
  warning?: string | null;
  onMove?: () => void;
  moveLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: onMove ? "30px 1fr auto auto auto 16px" : "30px 1fr auto auto 16px",
        alignItems: "center",
        gap: 11,
        padding: "6px 10px 6px 7px",
        borderRadius: 5,
        cursor: onClick ? "pointer" : "default",
        background: hover ? "rgba(21,21,26,.04)" : "transparent",
        boxShadow: hover ? "inset 0 0 0 1px var(--line)" : "none",
        transition: "background .12s",
      }}
    >
      <div className="cc-art" style={{ width: 30, height: 30, borderRadius: 4 }}>
        <CardArt name={card.name} src={card.imageUri || undefined} colors={colorsOf(card.manaCost)} radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.15 }}>
          {warning && (
            <span title={warning} style={{ color: "var(--danger)", marginRight: 6, cursor: "help" }}>⚠</span>
          )}
          {card.name}
        </div>
        <div style={{ fontSize: 12.5, fontStyle: "normal", color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.typeLine}
        </div>
      </div>
      {quantity && quantity > 1 ? (
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--gold)" }}>×{quantity}</span>
      ) : (
        <span />
      )}
      <ManaCost cost={card.manaCost} size={15} />
      {onMove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
          title={moveLabel}
          aria-label={moveLabel}
          style={{
            height: 22,
            padding: "0 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: "var(--bg3)",
            color: "var(--gold)",
            fontSize: 12,
            fontWeight: 700,
            opacity: hover ? 1 : 0,
            transition: "opacity .12s",
            boxShadow: "inset 0 0 0 1px var(--line)",
          }}
        >
          {moveLabel?.startsWith("Move to deck") ? "⇧" : "⇩"}
        </button>
      )}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            padding: 0,
            background: "transparent",
            color: "var(--text-dim)",
            opacity: hover ? 1 : 0,
            transition: "opacity .12s",
            fontSize: 11,
          }}
          aria-label="Remove"
        >
          ✕
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
