// What a card on the table can do: its stats now, its keywords, the mana it
// makes. Read from Scryfall's card data (CardInfo); tokens carry their own.

import { isLandCard, type PlayCard } from "../playtest";
import type { CardBook, CardInfo } from "./types";

export const infoOf = (book: CardBook, card: PlayCard): CardInfo | undefined => book[card.name.toLowerCase()];

const frontType = (typeLine: string | null | undefined) => (typeLine ?? "").split(" // ")[0]!;

export function isCreature(book: CardBook, card: PlayCard): boolean {
  if (card.token) return true;
  return /\bCreature\b/.test(frontType(infoOf(book, card)?.typeLine ?? card.typeLine));
}

export const isLand = (card: PlayCard) => isLandCard(card.typeLine);

/** Power and toughness now: printed (or the token's), plus counters and pumps. */
export function stats(book: CardBook, card: PlayCard): { power: number; toughness: number } {
  const info = infoOf(book, card);
  const base = card.token ?? { power: info?.power ?? 0, toughness: info?.toughness ?? 0 };
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
const BASIC_COLOR: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G", wastes: "C" };

/** The mana a permanent adds when tapped for it: which colours, and how
    much ("Add {C}{C}" is two). Null when it makes none. */
export function manaOutput(info: CardInfo | undefined, typeLine: string | null): { colors: string[]; amount: number } | null {
  const text = (info?.oracleText ?? "").split("\n//\n")[0]!;
  let colors = (info?.producedMana ?? []).filter((c) => COLORS.includes(c));
  // A basic land type makes its colour even when the data says nothing.
  if (!colors.length) {
    const t = frontType(typeLine).toLowerCase();
    colors = Object.entries(BASIC_COLOR).filter(([sub]) => t.includes(sub)).map(([, c]) => c);
  }
  if (!colors.length) return null;
  // "{T}: Add {C}{C}." — a run of symbols is one ability adding them all;
  // "Add {G} or {U}" or "one mana of any color" is one.
  let amount = 1;
  for (const m of text.matchAll(/\badd ((?:\{[WUBRGC]\})+)/gi)) {
    amount = Math.max(amount, (m[1]!.match(/\{/g) ?? []).length);
  }
  return { colors, amount };
}

/** "enters tapped" without an "unless" escape. */
export const entersTapped = (info: CardInfo | undefined) => {
  const text = (info?.oracleText ?? "").split("\n//\n")[0]!.toLowerCase();
  return /enters (the battlefield )?tapped/.test(text) && !/enters (the battlefield )?tapped unless/.test(text);
};
