import type { CSSProperties, ReactNode } from "react";
import { Check, Dices, FileSpreadsheet, Flame, History, Infinity as InfinityIcon, Plus, RotateCcw, Share2, X } from "lucide-react";
import { MARK_BLUE, MARK_DROP, MARK_SQUIRCLE } from "@/components/brand";
import type { LandingFeature } from "@/lib/landing";

/* The landing page's pictures: small versions of the app's own screens, with
   real cards, so each feature is shown and not only described. Decorative
   (aria-hidden): the heading and sentence beside each one carry the meaning.

   Each picture is drawn once at a fixed design size and scales with the tile
   it sits in: the tile is a CSS container, `--u` is one design pixel
   (100cqw / the design width), and every size inside is a multiple of it. So
   a picture keeps its proportions at any tile width without JavaScript.

   Composition follows the Stageshow guide (github.com/benjitaylor/skills):
   one thing per tile at a size you can read, cropped by the tile's edge where
   it runs on, real words only on what the picture is about. The phone's
   proportions (screen, island, status bar) are that kit's, MIT, Benji Taylor. */

/** `n` design pixels. */
const u = (n: number) => `calc(var(--u) * ${n})`;
/** `n` points on the phone's screen. */
const p = (n: number) => `calc(var(--p) * ${n})`;

/* Card pictures by Scryfall id: the stored scans on cards.scryfall.io, which
   has no rate limit (a lookup by name would be an API call per visitor). */
const CARD = {
  skullclamp: "e/1/e1da8b79-249b-439a-a0ad-c8784bd716df",
  kiki: "a/2/a2ff0ee3-9600-4c7d-acec-6ec90595384e",
  conscripts: "b/5/b5ca6c08-bfe0-4021-b6ad-e235c8905661",
  solRing: "f/c/fc817e07-c1f3-469f-9cf7-0945dea7400f",
  rhystic: "9/f/9f37c5b6-a59c-45cd-9a99-e9357fe9ea1b",
  sheoldred: "d/6/d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
  rift: "d/f/dfb7c4b9-f2f4-4d4e-baf2-86551c8150fe",
  signet: "7/9/795df2ee-fbfc-4961-852c-e3ec50cc52da",
  greaves: "6/5/659ef698-96ea-4fa9-b63c-0da93a2d1e78",
  mountain: "8/5/85177bd7-6c50-48da-b692-ae5fe7bd357c",
  matron: "8/e/8ee0fdd4-1fb5-4160-b408-2c51ef4f85d0",
  prospector: "7/b/7bc508b3-8b38-4cf0-89a7-a2cb247ed083",
  krenko: "8/2/824b2d73-2151-4e5e-9f05-8f63e2bdcaa9",
  ringleader: "6/9/6911af4e-4abd-4cf9-8a86-ae5d680c6f12",
  tremors: "d/0/d0b7cecf-b51b-4d30-b7e9-cd7976271e07",
  chieftain: "8/9/89fcc35b-76fa-4408-8620-a1e11b2caf1f",
  purphoros: "4/7/4736a2c4-c89c-48db-a104-6303e7e2eee8",
  recruiter: "6/1/61bd1548-2ffa-4705-ba88-913f37d4ce92",
  muxus: "2/c/2c716d10-2130-43b7-a939-349d437e1091",
} as const;
type CardKey = keyof typeof CARD;
const scan = (k: CardKey, size: "small" | "normal" | "art_crop" = "normal") => `https://cards.scryfall.io/${size}/front/${CARD[k]}.jpg`;

/** A card, `w` design pixels wide. */
function Card({ k, w, style, unit = u }: { k: CardKey; w: number; style?: CSSProperties; unit?: (n: number) => string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={scan(k)}
      alt=""
      loading="lazy"
      decoding="async"
      className="lv-card"
      style={{ width: unit(w), height: unit(w * 1.3934), borderRadius: unit(w * 0.048), ...style }}
    />
  );
}

/** A grey line standing in for text that isn't the point. */
function Bar({ w, style }: { w: number; style?: CSSProperties }) {
  return <span className="lv-bar" style={{ width: u(w), height: u(7), borderRadius: u(4), ...style }} />;
}

const abs = (left: number, top: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left: u(left), top: u(top), ...extra });

/* ── The coach: the large tile. The panel as it opens beside a deck, one
      question answered, the card it recommends beside it. ── */
function Coach() {
  return (
    <>
      <div className="lv-stage lv-wide" style={{ ["--w" as string]: 781, aspectRatio: "781 / 300" }}>
        <div className="lv-surface" style={abs(26, 0, { width: u(600), height: u(360), borderRadius: u(18) })}>
          <div className="lv-rule" style={{ height: u(56), padding: `0 ${u(20)}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: u(2) }}>
            <div style={{ fontSize: u(15), fontWeight: 700, color: "var(--t1)" }}>Deck coach</div>
            <div style={{ fontSize: u(12.5), color: "var(--t3)" }}>This deck, and all your others.</div>
          </div>
          <div className="lv-bubble" style={abs(0, 74, { left: "auto", right: u(98), fontSize: u(14), padding: `${u(9)} ${u(14)}`, borderRadius: u(16) })}>
            What should I cut for more card draw?
          </div>
          <div style={abs(20, 128, { width: u(430), fontSize: u(14.5), lineHeight: 1.55, color: "var(--t1)" })}>
            Cut <b className="lv-link">Goblin Piker</b>: it does nothing your tokens don&apos;t already do. Add{" "}
            <b className="lv-link">Skullclamp</b>: every 1/1 your commander makes turns into two cards.
          </div>
          <div style={abs(20, 232, { display: "flex", alignItems: "center", gap: u(8) })}>
            <span className="lv-chip lv-add" style={{ fontSize: u(12.5), padding: `${u(5)} ${u(10)}`, borderRadius: u(99) }}>+ Skullclamp</span>
            <span className="lv-chip lv-cut" style={{ fontSize: u(12.5), padding: `${u(5)} ${u(10)}`, borderRadius: u(99) }}>− Goblin Piker</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: u(5), fontSize: u(12.5), color: "var(--t3)", marginLeft: u(4) }}>
              <History style={{ width: u(13), height: u(13) }} strokeWidth={2.25} /> Version saved first
            </span>
          </div>
        </div>
        <Card k="skullclamp" w={200} style={abs(548, 72, { boxShadow: "0 18px 40px -14px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.08)" })} />
      </div>

      {/* A phone's width: the same answer, without the card beside it. */}
      <div className="lv-stage lv-compact" style={{ ["--w" as string]: 358, aspectRatio: "358 / 282" }}>
        <div className="lv-surface" style={abs(20, 0, { width: u(318), height: u(360), borderRadius: u(18) })}>
          <div className="lv-rule" style={{ height: u(56), padding: `0 ${u(16)}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: u(2) }}>
            <div style={{ fontSize: u(15), fontWeight: 700, color: "var(--t1)" }}>Deck coach</div>
            <div style={{ fontSize: u(12.5), color: "var(--t3)" }}>This deck, and all your others.</div>
          </div>
          <div className="lv-bubble" style={abs(0, 72, { left: "auto", right: u(16), fontSize: u(14), padding: `${u(9)} ${u(14)}`, borderRadius: u(16) })}>
            What should I cut for card draw?
          </div>
          <div style={abs(16, 124, { width: u(286), fontSize: u(14), lineHeight: 1.5, color: "var(--t1)" })}>
            Cut <b className="lv-link">Goblin Piker</b>: your tokens already do its job. Add <b className="lv-link">Skullclamp</b>: every 1/1 your commander
            makes turns into two cards.
          </div>
          <div style={abs(16, 226, { display: "flex", alignItems: "center", gap: u(8) })}>
            <span className="lv-chip lv-add" style={{ fontSize: u(12.5), padding: `${u(5)} ${u(10)}`, borderRadius: u(99) }}>+ Skullclamp</span>
            <span className="lv-chip lv-cut" style={{ fontSize: u(12.5), padding: `${u(5)} ${u(10)}`, borderRadius: u(99) }}>− Goblin Piker</span>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Deck Score: one big number, the bracket, the four axes. ── */
const AXES: [string, number][] = [["Speed", 9], ["Consistency", 8], ["Interaction", 6], ["Resilience", 7]];
function Score() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 288" }}>
      <div style={abs(24, 0, { fontFamily: "var(--font-display)", fontSize: u(88), fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 0.9, color: "var(--t1)" })}>7.5</div>
      <div style={abs(196, 10)}>
        <div style={{ fontSize: u(12.5), color: "var(--t3)" }}>Plays at</div>
        <div style={{ fontSize: u(21), fontWeight: 700, color: "var(--t1)", lineHeight: 1.25 }}>Bracket 3</div>
        <div style={{ fontSize: u(13.5), color: "var(--t2)" }}>Upgraded</div>
      </div>
      {AXES.map(([label, v], i) => (
        <div key={label} style={abs(26, 118 + i * 40, { width: u(331), display: "flex", alignItems: "center", gap: u(12) })}>
          <span style={{ width: u(92), flex: "none", fontSize: u(14), color: "var(--t2)" }}>{label}</span>
          <span className="lv-track" style={{ flex: 1, height: u(7), borderRadius: u(4) }}>
            <span className="lv-fill" style={{ width: `${v * 10}%`, borderRadius: u(4) }} />
          </span>
          <span style={{ width: u(26), flex: "none", textAlign: "right", fontSize: u(14), fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--t1)" }}>{v.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Combos: the two pieces, and what they make. ── */
function Combos() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 300" }}>
      <Card k="kiki" w={160} style={abs(26, 0)} />
      <Card k="conscripts" w={160} style={abs(197, 0)} />
      <span className="lv-plus" style={abs(175.5, 95, { width: u(32), height: u(32) })}>
        <Plus style={{ width: u(16), height: u(16) }} strokeWidth={3} />
      </span>
      <div style={abs(26, 240, { display: "flex", alignItems: "center", gap: u(10) })}>
        <span className="lv-gold" style={{ display: "inline-flex", alignItems: "center", gap: u(6), fontSize: u(13), fontWeight: 700, padding: `${u(6)} ${u(12)}`, borderRadius: u(99) }}>
          <InfinityIcon style={{ width: u(15), height: u(15) }} strokeWidth={2.5} /> Infinite hasty creatures
        </span>
        <span style={{ fontSize: u(12.5), color: "var(--t3)" }}>2 cards</span>
      </div>
    </div>
  );
}

/* ── Versions: one saved version, compared with the deck as it is now. ── */
function Versions() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 300" }}>
      <div className="lv-surface" style={abs(26, 0, { width: u(331), height: u(340), borderRadius: u(16) })}>
        <div className="lv-rule" style={{ height: u(64), padding: `0 ${u(16)}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: u(12) }}>
          <div>
            <div style={{ fontSize: u(14.5), fontWeight: 700, color: "var(--t1)" }}>Before the haste package</div>
            <div style={{ fontSize: u(12.5), color: "var(--t3)", marginTop: u(2) }}>Saturday · 100 cards</div>
          </div>
          <span className="lv-ghost" style={{ display: "inline-flex", alignItems: "center", gap: u(6), fontSize: u(12.5), fontWeight: 600, padding: `${u(7)} ${u(12)}`, borderRadius: u(99) }}>
            <RotateCcw style={{ width: u(13), height: u(13) }} strokeWidth={2.25} /> Restore
          </span>
        </div>
        <div className="lv-ok" style={abs(16, 80, { fontSize: u(11), fontWeight: 700, letterSpacing: "0.1em" })}>ADDED SINCE</div>
        {["Goblin Warchief", "Shared Animosity", "Battle Hymn"].map((n, i) => (
          <div key={n} style={abs(16, 102 + i * 25, { fontSize: u(14), color: "var(--t1)" })}>{n}</div>
        ))}
        <div className="lv-bad" style={abs(16, 190, { fontSize: u(11), fontWeight: 700, letterSpacing: "0.1em" })}>REMOVED SINCE</div>
        <div style={abs(16, 212, { fontSize: u(14), color: "var(--t1)" })}>Raging Goblin</div>
        <Bar w={132} style={abs(16, 245)} />
        <Bar w={96} style={abs(16, 270)} />
      </div>
    </div>
  );
}

/* ── Playtest: an opening hand on the table, running off the tile. ── */
const HAND: CardKey[] = ["mountain", "matron", "mountain", "krenko", "prospector", "ringleader", "mountain"];
function Playtest() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 300" }}>
      <div style={abs(26, 0, { display: "flex", alignItems: "center", gap: u(8) })}>
        <span className="lv-ghost" style={{ fontSize: u(13), fontWeight: 600, padding: `${u(7)} ${u(13)}`, borderRadius: u(99) }}>Mulligan</span>
        <span className="lv-ghost" style={{ fontSize: u(13), fontWeight: 600, padding: `${u(7)} ${u(13)}`, borderRadius: u(99) }}>Draw</span>
        <span style={{ fontSize: u(12.5), color: "var(--t3)", marginLeft: u(4) }}>Opening hand · 7</span>
      </div>
      {HAND.map((k, i) => {
        const d = i - 3;
        return (
          <Card
            key={i}
            k={k}
            w={172}
            style={abs(105.5 + d * 54, 66 + d * d * 6, { transform: `rotate(${d * 7}deg)`, transformOrigin: "50% 120%", boxShadow: "0 10px 22px -10px rgba(0,0,0,.55)" })}
          />
        );
      })}
    </div>
  );
}

/* ── The buy list: what's missing, priced, and what you already own. ── */
const BUY: [CardKey, string, string | null][] = [
  ["purphoros", "Purphoros, God of the Forge", "$29.14"],
  ["muxus", "Muxus, Goblin Grandee", "$10.01"],
  ["recruiter", "Goblin Recruiter", "$8.45"],
  ["chieftain", "Goblin Chieftain", "$5.09"],
  ["tremors", "Impact Tremors", null],
];
function BuyList() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 300" }}>
      {BUY.map(([k, name, price], i) => (
        <div key={name} className="lv-rule" style={abs(26, i * 44, { width: u(331), height: u(44), display: "flex", alignItems: "center", gap: u(12) })}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={scan(k, "art_crop")} alt="" loading="lazy" decoding="async" style={{ width: u(30), height: u(30), borderRadius: u(7), objectFit: "cover", flex: "none" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: u(14), fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          {price ? (
            <span style={{ fontSize: u(14), fontVariantNumeric: "tabular-nums", color: "var(--t2)" }}>{price}</span>
          ) : (
            <span className="lv-ok" style={{ display: "inline-flex", alignItems: "center", gap: u(4), fontSize: u(12.5), fontWeight: 700 }}>
              <Check style={{ width: u(13), height: u(13) }} strokeWidth={3} /> Owned
            </span>
          )}
        </div>
      ))}
      <div style={abs(26, 228, { width: u(331), display: "flex", alignItems: "baseline", justifyContent: "space-between" })}>
        <span style={{ fontSize: u(14), fontWeight: 700, color: "var(--t1)" }}>
          To buy <span style={{ fontWeight: 500, color: "var(--t3)" }}>· 4 cards</span>
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: u(28), fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--t1)" }}>$52.69</span>
      </div>
    </div>
  );
}

/* ── The collection: an import, and the cards it brought in. ── */
// Counts only on the first row: the second runs off the tile.
const OWNED: [CardKey, number][] = [["solRing", 3], ["rhystic", 1], ["sheoldred", 2], ["rift", 1], ["signet", 1], ["greaves", 1]];
function Collection() {
  const w = (331 - 20) / 3;
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 300" }}>
      <div style={abs(26, 0, { width: u(331), display: "flex", alignItems: "center", gap: u(9) })}>
        <FileSpreadsheet style={{ width: u(17), height: u(17), color: "var(--t2)", flex: "none" }} strokeWidth={2} />
        <span style={{ fontSize: u(13.5), fontWeight: 600, color: "var(--t1)" }}>ManaBox.csv</span>
        <span className="lv-ok" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: u(4), fontSize: u(12.5), fontWeight: 700 }}>
          <Check style={{ width: u(13), height: u(13) }} strokeWidth={3} /> 1,284 cards
        </span>
      </div>
      {OWNED.map(([k, n], i) => (
        <div key={k} style={abs(26 + (i % 3) * (w + 10), 44 + Math.floor(i / 3) * (w * 1.3934 + 10))}>
          <Card k={k} w={w} style={{ display: "block" }} />
          {n > 1 && (
            <span className="lv-count" style={{ position: "absolute", right: u(6), bottom: u(6), fontSize: u(11.5), fontWeight: 700, padding: `${u(2)} ${u(7)}`, borderRadius: u(99) }}>×{n}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── On a phone: the deck page, in an iPhone at its real proportions. The
      screen is laid out in points (402 wide) and scaled with the tile. ── */
function Phone() {
  // The phone is 331 design pixels wide (the tile, less its gutters): a 402pt
  // screen inside a 12pt bezel. At that size its type is the size a phone shows.
  const s = 331 / 426;
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 383, aspectRatio: "383 / 320" }}>
      <div className="lv-phone" style={abs(26, 0, { ["--p" as string]: `calc(var(--u) * ${s})`, width: p(426), height: p(898), padding: p(12), borderRadius: p(76) })}>
        <div className="lv-screen" style={{ borderRadius: p(64) }}>
          <span style={{ position: "absolute", top: p(21.5), left: 0, width: p(138.5), textAlign: "center", fontSize: p(17.5), fontWeight: 600, lineHeight: p(22) }}>9:41</span>
          <span className="lv-island" style={{ top: p(14), width: p(95), height: p(37), borderRadius: p(18.5), marginLeft: p(-47.5) }} />
          <svg viewBox="0 0 86 14.33" style={{ position: "absolute", top: p(25.33), left: p(285.25), width: p(86), height: p(14.33) }} fill="currentColor" aria-hidden="true">
            {[6.33, 8.67, 11, 13.67].map((h, i) => (
              <rect key={i} x={i * 5.667} y={14.67 - h} width={3.333} height={h} rx={1.667} />
            ))}
            <g transform="translate(28.33 0)">
              <path fillRule="evenodd" d="M0.415933 5.54283C0.902185 6.04412 1.66017 5.95818 2.27513 5.41393C4.30595 3.58064 6.83731 2.63535 9.66901 2.63535C12.5007 2.63535 15.0464 3.60928 17.0629 5.41393C17.6636 5.97251 18.4215 6.0298 18.9221 5.54283C19.4226 5.02722 19.4942 4.2538 18.9793 3.70954C16.8341 1.51819 13.3302 0 9.66901 0C6.00783 0 2.48965 1.53251 0.358727 3.72387C-0.156127 4.2538 -0.0989213 5.02722 0.415933 5.55715L0.415933 5.54283ZM3.94841 9.13779C4.50617 9.68205 5.22124 9.62476 5.85051 9.10915C6.88022 8.29276 8.25316 7.73418 9.66901 7.7485C11.0706 7.7485 12.4435 8.29276 13.4875 9.12347C14.1168 9.63908 14.8605 9.66773 15.4039 9.12347C15.9331 8.57921 16.0189 7.7485 15.4611 7.23289C14.0739 5.98683 11.9859 5.11315 9.68332 5.11315C7.38077 5.11315 5.27845 5.98683 3.9055 7.23289C3.41925 7.69121 3.31914 8.47896 3.96271 9.13779L3.94841 9.13779ZM8.72511 13.8929C9.34008 14.4801 9.98365 14.4801 10.5986 13.8929L11.757 12.7757C12.372 12.1742 12.5007 11.4151 11.7999 10.8995C11.2136 10.4841 10.4699 10.212 9.66901 10.212C8.86813 10.212 8.11015 10.4841 7.53809 10.9138C6.83731 11.4151 6.98033 12.1885 7.59529 12.7757L8.73942 13.8929L8.72511 13.8929Z" />
            </g>
            <g transform="translate(55.67 0.33)">
              <path d="M0 6.4C0 4.15979 0 3.03969 0.435974 2.18404C0.819467 1.43139 1.43139 0.819467 2.18404 0.435974C3.03969 0 4.15979 0 6.4 0L19.933 0C22.1732 0 23.2933 0 24.149 0.435974C24.9016 0.819467 25.5135 1.43139 25.897 2.18404C26.333 3.03969 26.333 4.15979 26.333 6.4L26.333 7.26666C26.333 9.50687 26.333 10.627 25.897 11.4826C25.5135 12.2353 24.9016 12.8472 24.149 13.2307C23.2933 13.6667 22.1732 13.6667 19.933 13.6667L6.4 13.6667C4.15979 13.6667 3.03969 13.6667 2.18404 13.2307C1.43139 12.8472 0.819467 12.2353 0.435974 11.4826C0 10.627 0 9.50687 0 7.26666L0 6.4Z" />
              <path fillRule="evenodd" transform="translate(27.33 4.33)" d="M0 0L0 5C0.601505 4.8625 2 3.75 2 2.5C2 1.25 0.601505 0.1375 0 0Z" />
            </g>
          </svg>

          {/* The deck page's header, as a phone shows it. */}
          <div style={{ position: "absolute", top: p(62), left: 0, right: 0, height: p(60), padding: `0 ${p(16)}`, display: "flex", alignItems: "center", gap: p(8), background: "rgba(14,11,24,.5)", borderBottom: "1px solid rgba(255,255,255,.16)" }}>
            <svg viewBox="0 0 100 100" style={{ width: p(26), height: p(26), flex: "none" }}>
              <path d={MARK_SQUIRCLE} fill={MARK_BLUE} />
              <path d={MARK_DROP} fill="#ffffff" />
            </svg>
            <span style={{ marginLeft: "auto" }} />
            <span className="lv-ph-ghost" style={{ fontSize: p(14), fontWeight: 600, padding: `${p(9)} ${p(14)}`, borderRadius: p(99) }}>Tools</span>
            <span className="lv-ph-ghost lv-ph-icon" style={{ width: p(38), height: p(38) }}><Dices style={{ width: p(16), height: p(16) }} strokeWidth={2} /></span>
            <span className="lv-ph-ghost lv-ph-icon" style={{ width: p(38), height: p(38) }}><Share2 style={{ width: p(16), height: p(16) }} strokeWidth={2} /></span>
            <span style={{ fontSize: p(14.5), fontWeight: 700, padding: `${p(10)} ${p(14)}`, borderRadius: p(99), background: "#fdf26f", color: "#181228", whiteSpace: "nowrap" }}>Edit deck</span>
          </div>
          <div style={{ position: "absolute", top: p(144), left: p(18), display: "flex", alignItems: "center", gap: p(9), fontFamily: "var(--font-mono)", fontSize: p(12.5), color: "rgba(255,255,255,.78)" }}>
            <span style={{ width: p(22), height: p(22), borderRadius: "50%", background: "#e2553f", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Flame style={{ width: p(13), height: p(13) }} strokeWidth={2.5} fill="currentColor" />
            </span>
            Commander · Red
          </div>
          <div style={{ position: "absolute", top: p(176), left: p(18), fontFamily: "var(--font-display)", fontSize: p(40), fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05 }}>Krenko goblins</div>
          <div style={{ position: "absolute", top: p(230), left: p(18), fontSize: p(14.5), color: "rgba(255,255,255,.78)" }}>
            Helmed by <b style={{ color: "#fff", fontWeight: 700, marginLeft: p(4) }}>Krenko, Mob Boss</b>
          </div>
          <Card k="krenko" w={250} unit={p} style={{ position: "absolute", top: p(272), left: p(76), boxShadow: "0 18px 40px -12px rgba(0,0,0,.55)" }} />
        </div>
      </div>
    </div>
  );
}

/* ── How it works, step 1: the ask. ── */
function Prompt() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 340, aspectRatio: "340 / 190" }}>
      <div className="lv-field" style={abs(22, 24, { width: u(296), height: u(142), borderRadius: u(16), padding: `${u(14)} ${u(16)}` })}>
        <div style={{ fontSize: u(15), lineHeight: 1.45, color: "var(--t1)" }}>
          Goblins that win out of nowhere, Krenko at the helm, on a budget
          <span className="lv-caret" style={{ width: u(2), height: u(16), marginLeft: u(2), verticalAlign: u(-3) }} />
        </div>
        <span className="lv-gold" style={{ position: "absolute", right: u(12), bottom: u(12), fontSize: u(13), fontWeight: 700, padding: `${u(7)} ${u(14)}`, borderRadius: u(99) }}>Start brewing</span>
      </div>
    </div>
  );
}

/* ── Step 2: keep or toss. ── */
function Swipe() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 340, aspectRatio: "340 / 190" }}>
      <Card k="matron" w={150} style={abs(95, 26, { transform: "rotate(-7deg)", transformOrigin: "50% 80%", filter: "brightness(.82)" })} />
      <Card k="ringleader" w={150} style={abs(95, 26, { transform: "rotate(5deg)", transformOrigin: "50% 80%", filter: "brightness(.9)" })} />
      <Card k="chieftain" w={150} style={abs(95, 22, { boxShadow: "0 14px 30px -12px rgba(0,0,0,.55)" })} />
      <span className="lv-round lv-cut" style={abs(28, 82, { width: u(46), height: u(46) })}><X style={{ width: u(20), height: u(20) }} strokeWidth={2.75} /></span>
      <span className="lv-round lv-add" style={abs(266, 82, { width: u(46), height: u(46) })}><Check style={{ width: u(20), height: u(20) }} strokeWidth={2.75} /></span>
    </div>
  );
}

/* ── Step 3: the curve fills and the count lands on 100. ── */
const CURVE = [4, 11, 14, 15, 7, 6, 2];
function Curve() {
  return (
    <div className="lv-stage" style={{ ["--w" as string]: 340, aspectRatio: "340 / 190" }}>
      {CURVE.map((h, i) => (
        <div key={i} style={abs(24 + i * 27, 0, { width: u(20), height: u(150), display: "flex", alignItems: "flex-end" })}>
          <div className="lv-fill" style={{ width: "100%", height: `${(h / 15) * 76}%`, borderRadius: u(4) }} />
        </div>
      ))}
      {CURVE.map((_, i) => (
        <span key={i} style={abs(24 + i * 27, 157, { width: u(20), textAlign: "center", fontSize: u(11), fontVariantNumeric: "tabular-nums", color: "var(--t3)" })}>{i === 6 ? "7+" : i + 1}</span>
      ))}
      <div style={abs(232, 62, { fontFamily: "var(--font-display)", fontSize: u(46), fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: "var(--t1)" })}>100</div>
      <div style={abs(234, 112, { fontSize: u(12.5), color: "var(--t3)" })}>of 100 cards</div>
      <div className="lv-ok" style={abs(234, 136, { display: "inline-flex", alignItems: "center", gap: u(4), fontSize: u(12.5), fontWeight: 700 })}>
        <Check style={{ width: u(13), height: u(13) }} strokeWidth={3} /> Legal
      </div>
    </div>
  );
}

export type VisualKind = LandingFeature["visual"] | "prompt" | "swipe" | "curve";

const VISUALS: Record<VisualKind, () => ReactNode> = {
  coach: Coach,
  score: Score,
  combos: Combos,
  versions: Versions,
  playtest: Playtest,
  buy: BuyList,
  collection: Collection,
  phone: Phone,
  prompt: Prompt,
  swipe: Swipe,
  curve: Curve,
};

export default function LandingVisual({ kind }: { kind: VisualKind }) {
  const Picture = VISUALS[kind];
  return (
    <div className="lv-pic" aria-hidden="true">
      <Picture />
    </div>
  );
}
