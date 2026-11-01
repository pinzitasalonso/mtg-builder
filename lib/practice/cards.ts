// What a card on the table can do: its stats now, its keywords, the mana it
// makes. Read from Scryfall's card data (CardInfo); tokens carry their own.

import { faceUpType, isLandCard, type PlayCard } from "../playtest";
import type { CardBook, CardInfo } from "./types";

export const infoOf = (book: CardBook, card: PlayCard): CardInfo | undefined => book[card.name.toLowerCase()];

const frontType = (typeLine: string | null | undefined) => (typeLine ?? "").split(" // ")[0]!;

export function isCreature(book: CardBook, card: PlayCard): boolean {
  if (card.token) return true;
  return /\bCreature\b/.test(frontType(infoOf(book, card)?.typeLine ?? card.typeLine));
}

/** A land now: the face that's up is a land. A modal card with a land back
    (Shatterskull Smashing) is a spell in hand, and a land once played as one. */
export const isLand = (card: PlayCard) => /\bLand\b/.test(faceUpType(card));

/** Can be the turn's land: a land, or a modal card with a land on its back. */
export const canPlayAsLand = (card: PlayCard) => isLandCard(card.typeLine);

/** Power and toughness now: printed (or the token's), plus counters and
    pumps. Unknown stats (Scryfall's facts missing) count as 1/1, so a
    creature doesn't die the moment it lands for want of data. */
export function stats(book: CardBook, card: PlayCard): { power: number; toughness: number } {
  const info = infoOf(book, card);
  const base = card.token ?? { power: info?.power ?? 1, toughness: info?.toughness ?? 1 };
  const plus = card.counters ?? 0;
  return {
    power: base.power + plus + (card.pump?.power ?? 0),
    toughness: base.toughness + plus + (card.pump?.toughness ?? 0),
  };
}

/** A keyword, from Scryfall's list or the card's text ("can't be blocked"). */
export function has(book: CardBook, card: PlayCard, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (card.token) return card.token.keywords.some((x) => x.toLowerCase() === k);
  const info = infoOf(book, card);
  if (!info) return false;
  if (info.keywords.some((x) => x.toLowerCase() === k)) return true;
  const text = (info.oracleText ?? "").toLowerCase().split("\n//\n")[0]!;
  if (k === "unblockable") return /\bcan't be blocked\b(?! except| by)/.test(text) && !/can't be blocked except/.test(text);
  if (k === "defender") return /^defender\b/m.test(text);
  return false;
}

/** Summoning sick: came under its controller's control this turn, and no haste. */
export const isSick = (book: CardBook, card: PlayCard, turn: number) =>
  (card.enteredTurn ?? 0) >= turn && !has(book, card, "Haste");

const COLORS = ["W", "U", "B", "R", "G", "C"];
export const BASIC_COLOR: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };

const frontText = (info: CardInfo | undefined) => (info?.oracleText ?? "").split("\n//\n")[0]!;

/** The mana a permanent adds when tapped for it: which colours, and how
    much ("Add {C}{C}" is two), and whether using it sacrifices it (Lotus
    Petal). Null when it makes none. A fetch land makes none: it cracks
    itself when played (fetchOf). */
export function manaOutput(info: CardInfo | undefined, typeLine: string | null): { colors: string[]; amount: number; sacrifice: boolean } | null {
  const text = frontText(info);
  let colors = (info?.producedMana ?? []).filter((c) => COLORS.includes(c));
  // A basic land type makes its colour even when the data says nothing.
  if (!colors.length) {
    const t = frontType(typeLine).toLowerCase();
    colors = Object.entries(BASIC_COLOR).filter(([sub]) => t.includes(sub)).map(([, c]) => c);
  }
  // "Choose a basic land type" or "a color" as it enters (Thran Portal):
  // whichever it needs.
  if (!colors.length && isLandCard(typeLine) && /\bchoose a (basic land type|color)\b/i.test(text)) colors = ["W", "U", "B", "R", "G"];
  if (!colors.length) return null;
  // "{T}: Add {C}{C}." — a run of symbols is one ability adding them all;
  // "Add {G} or {U}" or "one mana of any color" is one.
  let amount = 1;
  for (const m of text.matchAll(/\badd ((?:\{[WUBRGC]\})+)/gi)) {
    amount = Math.max(amount, (m[1]!.match(/\{/g) ?? []).length);
  }
  const sacrifice = /\bsacrifice [^:.]*:[^.]*\badd\b/i.test(text) && !/\{T\}: add/i.test(text);
  return { colors, amount, sacrifice };
}

/** "enters tapped" without an "unless" escape. A shock land ("you may pay
    2 life") doesn't: the AI pays (shockLife). */
export const entersTapped = (info: CardInfo | undefined) => {
  const text = frontText(info).toLowerCase();
  if (shockLife(info)) return false;
  return /enters (the battlefield )?tapped/.test(text) && !/enters (the battlefield )?tapped unless/.test(text);
};

/** A shock land's price for entering untapped. */
export const shockLife = (info: CardInfo | undefined) => (/you may pay 2 life\. if you don't, it enters (the battlefield )?tapped/i.test(frontText(info)) ? 2 : 0);

/** A fetch land: what it searches for. "Island or Mountain" is ["island",
    "mountain"]; "a basic land card" is basic, ["land"]. */
export interface Fetch {
  types: string[];
  basic: boolean;
  tapped: boolean;
  life: number;
}
export function fetchOf(info: CardInfo | undefined): Fetch | null {
  const text = frontText(info);
  const m = /sacrifice [^:]*:\s*search your library for an? (basic )?([a-z ,]+?) card,? (?:and )?put it onto the battlefield( tapped)?/i.exec(text);
  if (!m) return null;
  const types = m[2]!
    .toLowerCase()
    .split(/,|\bor\b/)
    .map((t) => t.trim())
    .filter(Boolean);
  return { types, basic: !!m[1], tapped: !!m[3], life: /pay 1 life/i.test(text) ? 1 : 0 };
}

/** A hard counterspell: what it can counter, and a way to cast it without
    mana. Soft counters ("unless its controller pays") are left out: the
    app doesn't track the player's mana, so it can't tell if they'd pay. */
export interface Counter {
  hits: (spell: { typeLine: string; manaValue: number; blue: boolean }) => boolean;
  /** "commander": free while the AI controls its commander (Fierce
      Guardianship). "exile-blue": exile another blue card instead (Force of
      Will). */
  free: "commander" | "exile-blue" | null;
  freeLife: number;
  /** X is the countered spell's mana value (Disrupting Shoal). */
  xIsValue: boolean;
  /** What else it does, for the log ("Its controller creates a 2/2 blue Bird…"). */
  rider: string;
}
export function counterOf(info: CardInfo | undefined): Counter | null {
  const text = frontText(info);
  if (/unless its controller pays/i.test(text)) return null;
  const m = /counter target ([a-z ,]*?)spell( with mana value (\d+)| if it's blue)?/i.exec(text);
  if (!m) return null;
  const words = m[1]!
    .toLowerCase()
    .replace(/,|\bor\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const not = words.filter((w) => w.startsWith("non")).map((w) => w.slice(3));
  const only = words.filter((w) => !w.startsWith("non"));
  const value = m[3] ? Number(m[3]) : null;
  const needsBlue = /if it's blue/i.test(m[2] ?? "");
  const rest = text.slice(m.index + m[0].length).split("\n")[0]!.replace(/^[.;]\s*/, "");
  return {
    hits: ({ typeLine, manaValue, blue }) => {
      const t = typeLine.toLowerCase();
      if (not.some((w) => t.includes(w))) return false;
      if (only.length && !only.some((w) => t.includes(w))) return false;
      if (value !== null && manaValue !== value) return false;
      if (needsBlue && !blue) return false;
      return true;
    },
    free: /if you control a commander, you may cast this spell without paying its mana cost/i.test(text)
      ? "commander"
      : /exile a blue card from your hand rather than pay this spell's mana cost/i.test(text)
        ? "exile-blue"
        : null,
    freeLife: /pay 1 life and exile a blue card/i.test(text) ? 1 : 0,
    xIsValue: /mana value is x\b/i.test(text),
    rider: /^its controller\b/i.test(rest) ? rest.split(/(?<=\.)\s/)[0]! : "",
  };
}

/** Blue, by its mana cost (hybrid and phyrexian count). */
export const isBlue = (info: CardInfo | undefined) => /\{[^}]*U[^}]*\}/.test(info?.manaCost ?? "");
