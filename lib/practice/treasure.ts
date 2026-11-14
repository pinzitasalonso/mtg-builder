// Treasure tokens: the cards that make them, read from their text, for
// both sides. Each reader matches a whole sentence, so a card is carried
// out only when the table can do all of what that sentence says. Treasures
// pay one mana of any colour (lib/practice/mana.ts), two with Goldspan
// Dragon out.

import type { PlayCard } from "../playtest";
import { faceText, infoOf, ownText } from "./cards";
import type { CardBook } from "./types";

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const count = (w: string) => NUMBERS[w.toLowerCase()] ?? Number(w);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The card's own sentences, without reminder text, each without its full
    stop. A line holding two sentences (Ragavan's) is two. */
function sentences(book: CardBook, card: PlayCard): string[] {
  if (card.token) return [];
  return ownText(faceText(infoOf(book, card), card))
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map((l) => l.trim().replace(/\.$/, ""))
    .filter(Boolean);
}
/** "this creature", "this artifact", or its own name. */
const self = (card: PlayCard) => `(?:this (?:creature|artifact|enchantment)|${esc(card.name.split(" // ")[0]!)}|${esc(card.name.split(" // ")[0]!.split(",")[0]!)})`;

/** Dockside Extortionist: "When this creature enters, create X Treasure
    tokens, where X is the number of artifacts and enchantments your
    opponents control." */
export const treasuresOnEnterForFoes = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) =>
    new RegExp(`^when ${self(card)} enters, create x treasure tokens, where x is the number of artifacts and enchantments your opponents control$`, "i").test(s)
  );

/** Treasures when creatures hit a player:
    - "self": this creature (Ragavan, Ancient Copper Dragon's d20). Ragavan
      also exiles the top card of that player's library.
    - "group": "one or more creatures you control" (Professional
      Face-Breaker, Grim Hireling): once a damage step.
    - "each": "a creature you control … create that many" (Old Gnawbone). */
export interface TreasureOnHit {
  who: "self" | "group" | "each";
  /** A number; "damage" for "that many"; "d20" for a roll. */
  n: number | "damage" | "d20";
  exileTop?: boolean;
}
export function treasureOnHitOf(book: CardBook, card: PlayCard): TreasureOnHit | null {
  const all = sentences(book, card);
  // Ancient Copper Dragon: two sentences, the roll and its Treasures.
  const roll = all.findIndex((s) => new RegExp(`^whenever ${self(card)} deals combat damage to a player, roll a d20$`, "i").test(s));
  if (roll >= 0 && /^you create a number of treasure tokens equal to the result$/i.test(all[roll + 1] ?? "")) return { who: "self", n: "d20" };
  for (const s of all) {
    let m = new RegExp(`^whenever ${self(card)} deals combat damage to a player, create (a|one|two|three|\\d+) treasure tokens?( and exile the top card of that player's library)?$`, "i").exec(s);
    if (m) return { who: "self", n: count(m[1]!), exileTop: !!m[2] };

    m = /^whenever one or more creatures you control deal combat damage to a player, create (a|one|two|three|\d+) treasure tokens?$/i.exec(s);
    if (m) return { who: "group", n: count(m[1]!) };
    if (/^whenever a creature you control deals combat damage to a player, create that many treasure tokens$/i.test(s)) return { who: "each", n: "damage" };
  }
  return null;
}
/** "Whenever this creature attacks or becomes the target of a spell,
    create a Treasure token" (Goldspan Dragon): the attack half. */
export const treasureOnAttackOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => new RegExp(`^whenever ${self(card)} attacks or becomes the target of a spell, create a treasure token$`, "i").test(s));

/** Goldspan Dragon: 'Treasures you control have "{T}, Sacrifice this
    artifact: Add two mana of any one color."' */
export const doublesTreasures = (book: CardBook, card: PlayCard) =>
  !card.token && /treasures you control have "\{T\}, sacrifice this artifact: add two mana of any one color\.?"/i.test(faceText(infoOf(book, card), card));

/** "Landfall — Whenever a land you control enters, create a Food token or
    a Treasure token" (Tireless Provisioner): the table takes the Treasure. */
export const treasureOnLandfallOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^landfall — whenever a land you control enters, create a food token or a treasure token$/i.test(s));

/** "Whenever a creature an opponent controls dies, create a Treasure
    token" (Revel in Riches). */
export const treasureOnFoeDeathOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^whenever a creature an opponent controls dies, create a treasure token$/i.test(s));

/** Revel in Riches: "At the beginning of your upkeep, if you control ten
    or more Treasures, you win the game." */
export const winsWithTreasures = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^at the beginning of your upkeep, if you control ten or more treasures, you win the game$/i.test(s));

/** A second spell in a turn: Lotho ("Whenever a player casts their
    second spell each turn, you lose 1 life and create a Treasure token")
    and Monologue Tax ("Whenever an opponent casts their second spell each
    turn, you create a Treasure token"). */
export function treasureOnSecondSpellOf(book: CardBook, card: PlayCard): { anyone: boolean; lose: number } | null {
  for (const s of sentences(book, card)) {
    if (/^whenever a player casts their second spell each turn, you lose 1 life and create a treasure token$/i.test(s)) return { anyone: true, lose: 1 };
    if (/^whenever an opponent casts their second spell each turn, you create a treasure token$/i.test(s)) return { anyone: false, lose: 0 };
  }
  return null;
}

/** "Magecraft — Whenever you cast or copy an instant or sorcery spell,
    create a Treasure token" (Storm-Kiln Artist). */
export const treasureOnMagecraftOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^magecraft — whenever you cast or copy an instant or sorcery spell, create a treasure token$/i.test(s));

/** Treasures made bigger: "If you would create one or more Treasure
    tokens, instead create those tokens plus an additional Treasure token"
    (Xorn, Jolene), and "If you would create a Clue, Food, or Treasure
    token, instead create one of each" (Academy Manufactor). */
export const extraTreasureOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^if you would create one or more treasure tokens, instead create those tokens plus an additional treasure token$/i.test(s));
export const oneOfEachOf = (book: CardBook, card: PlayCard) =>
  sentences(book, card).some((s) => /^if you would create a clue, food, or treasure token, instead create one of each$/i.test(s));

/** An instant or sorcery that draws and makes Treasures, and nothing the
    table can't do: Strike It Rich, Brass's Bounty ("for each land you
    control"), Big Score, Unexpected Windfall and Seize the Spoils (discard
    a card as an extra cost), Deadly Dispute (sacrifice an artifact or
    creature). */
export interface TreasureSpell {
  draw: number;
  /** A number, or "lands" for one per land you control. */
  treasures: number | "lands";
  cost?: "discard" | "sacrifice";
}
const SPELL_KEYWORDS = /^flashback\b/i;
export function treasureSpellOf(book: CardBook, card: PlayCard): TreasureSpell | null {
  if (card.token || !/\b(Instant|Sorcery)\b/.test((infoOf(book, card)?.typeLine ?? card.typeLine ?? "").split(" // ")[0]!)) return null;
  const lines = sentences(book, card);
  let out: TreasureSpell | null = null;
  let cost: TreasureSpell["cost"];
  for (const s of lines) {
    if (/^as an additional cost to cast this spell, discard a card$/i.test(s)) cost = "discard";
    else if (/^as an additional cost to cast this spell, sacrifice an artifact or creature$/i.test(s)) cost = "sacrifice";
    else if (SPELL_KEYWORDS.test(s)) continue;
    else {
      let m = /^(?:draw (a|one|two|three) cards? and )?create (a|one|two|three) treasure tokens?$/i.exec(s);
      if (m && !out) {
        out = { draw: m[1] ? count(m[1]) : 0, treasures: count(m[2]!) };
        continue;
      }
      m = /^for each land you control, create a treasure token$/i.exec(s);
      if (m && !out) {
        out = { draw: 0, treasures: "lands" };
        continue;
      }
      return null;
    }
  }
  return out ? { ...out, ...(cost ? { cost } : {}) } : null;
}

/** Any of the above: the app makes this card's Treasures (for the AI's
    brief, so its plan doesn't make them twice). */
export const makesTreasures = (book: CardBook, card: PlayCard) =>
  treasuresOnEnterForFoes(book, card) ||
  !!treasureOnHitOf(book, card) ||
  treasureOnAttackOf(book, card) ||
  treasureOnLandfallOf(book, card) ||
  treasureOnFoeDeathOf(book, card) ||
  !!treasureOnSecondSpellOf(book, card) ||
  treasureOnMagecraftOf(book, card) ||
  !!treasureSpellOf(book, card);
