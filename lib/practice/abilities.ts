// Abilities of popular commanders that the practice engine carries out,
// read from the text of the face that's up, so any card worded the same way
// works too: Winota, Vivi, Braids, Rograkh and Silas, Witherbloom, Selvala,
// Inalla, Light-Paws, the Thranduils, The Ur-Dragon and Kratos. The engine
// (game.ts) decides when they happen; this file only reads the cards.

import { faceUpType, type PlayCard } from "../playtest";
import { cardTypes, faceText, has, infoOf, isCreature } from "./cards";
import type { CardBook } from "./types";

const textOf = (book: CardBook, card: PlayCard) => (card.token ? "" : faceText(infoOf(book, card), card));

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string | undefined) => (w ? (NUM[w.toLowerCase()] ?? (Number(w) || 0)) : 0);

/** "Elves" → "elf", "Dragons" → "dragon", "Wizards" → "wizard". */
export function singular(word: string): string {
  const w = word.toLowerCase().trim();
  if (w === "elves") return "elf";
  if (w === "dwarves") return "dwarf";
  if (/(ss|us)$/.test(w)) return w;
  return w.replace(/s$/, "");
}

/** The words of its type line now (the face that's up), lowercased. */
export function typeWords(book: CardBook, card: PlayCard): string[] {
  const line = card.token ? (card.typeLine ?? "") : faceUpType({ typeLine: infoOf(book, card)?.typeLine ?? card.typeLine, flipped: card.flipped });
  return line.toLowerCase().split(/[\s—-]+/).filter(Boolean);
}

/** Is it a <type> ("Elf", "Wizard", "Human", "Aura")? A changeling is every
    creature type. */
export function isType(book: CardBook, card: PlayCard, type: string): boolean {
  const t = singular(type);
  if (typeWords(book, card).includes(t)) return true;
  return isCreature(book, card) && !["artifact", "creature", "enchantment", "land", "planeswalker", "aura", "legendary"].includes(t) && has(book, card, "Changeling");
}

/** A spell as cost reducers and affinity see it. */
export interface SpellLike {
  typeLine: string;
}
/** "instant and sorcery", "Dragon", "noncreature": does it describe this
    spell? Alternatives are joined by "and" or "or". */
function spellMatches(words: string, spell: SpellLike, book: CardBook, card: PlayCard): boolean {
  return words
    .toLowerCase()
    .split(/\s+(?:and|or)\s+|,\s*/)
    .map((w) => w.trim())
    .filter(Boolean)
    .some((alt) =>
      alt.split(/\s+/).every((w) => {
        if (w.startsWith("non")) return !cardTypes(spell.typeLine).includes(w.slice(3)) && !isType(book, card, w.slice(3));
        return cardTypes(spell.typeLine).includes(w) || isType(book, card, w);
      })
    );
}

// ── Static abilities: lords, Auras, everyone ───────────────────────────

/** "Other Elves you control get +1/+1", "Creatures you control get +1/+0
    and have haste". type null: every creature. */
export interface Lord {
  type: string | null;
  other: boolean;
  power: number;
  toughness: number;
  keywords: string[];
}
const kwList = (s: string | undefined) =>
  (s ?? "")
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((k) => k.trim())
    .filter((k) => /^[a-z ]{3,20}$/i.test(k))
    .map((k) => k[0]!.toUpperCase() + k.slice(1));

export function lordsOf(book: CardBook, card: PlayCard): Lord[] {
  const out: Lord[] = [];
  for (const m of textOf(book, card).matchAll(/^(other )?([a-z ]+?) you control get \+(\d+)\/\+(\d+)(?: and have ([a-z ,]+?))?(?: until end of turn)?\./gim)) {
    if (/until end of turn/i.test(m[0])) continue;
    const words = m[2]!.toLowerCase().replace(/\s*creatures?$/, "").trim();
    out.push({ type: words === "" || words === "creature" ? null : singular(words.split(" ").at(-1)!), other: !!m[1], power: Number(m[3]), toughness: Number(m[4]), keywords: kwList(m[5]) });
  }
  return out;
}

/** "Enchanted creature gets +2/+2 and has flying." */
export function auraBonusOf(book: CardBook, card: PlayCard): { power: number; toughness: number; keywords: string[] } | null {
  const text = textOf(book, card);
  const gets = /enchanted creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+?))?(?:\.|$)/im.exec(text);
  const hasOnly = /enchanted creature has ([a-z ,]+?)\./im.exec(text);
  if (!gets && !hasOnly) return null;
  return { power: gets ? Number(gets[1]) : 0, toughness: gets ? Number(gets[2]) : 0, keywords: kwList(gets?.[3] ?? hasOnly?.[1]) };
}

/** "All creatures have haste." (Kratos, God of War) */
export function globalKeywordsOf(book: CardBook, card: PlayCard): string[] {
  const m = /^all creatures have ([a-z ,]+?)\./im.exec(textOf(book, card));
  return m ? kwList(m[1]) : [];
}

// ── What spells cost ───────────────────────────────────────────────────

/** "Affinity for creatures": this spell costs {1} less for each one you control. */
export function affinityOf(book: CardBook, card: PlayCard): "creature" | "artifact" | null {
  const m = /\baffinity for (creatures|artifacts)\b/i.exec(textOf(book, card));
  return m ? (m[1]!.toLowerCase() === "creatures" ? "creature" : "artifact") : null;
}

/** "Instant and sorcery spells you cast have affinity for creatures"
    (Witherbloom, the Balancer). */
export function grantedAffinityOf(book: CardBook, card: PlayCard): { words: string; kind: "creature" | "artifact" } | null {
  const m = /^([a-z ,]+?) spells you cast have affinity for (creatures|artifacts)/im.exec(textOf(book, card));
  return m ? { words: m[1]!, kind: m[2]!.toLowerCase() === "creatures" ? "creature" : "artifact" } : null;
}

/** "Other Dragon spells you cast cost {1} less to cast" (The Ur-Dragon,
    from the command zone too: eminence). */
export interface Reducer {
  words: string;
  amount: number;
  other: boolean;
  eminence: boolean;
}
export function reducersOf(book: CardBook, card: PlayCard): Reducer[] {
  const out: Reducer[] = [];
  for (const line of textOf(book, card).split("\n")) {
    // The phrase right before "spells": after the start of the line, a
    // comma or a dash ("…on the battlefield, other Dragon spells…").
    const m = /(?:^|[,—:]\s*)(other )?([a-z ]+?) spells you cast cost \{(\d+)\} less to cast/i.exec(line);
    if (m) out.push({ words: m[2]!, amount: Number(m[3]), other: !!m[1], eminence: /^eminence\b/i.test(line) || /in the command zone or on the battlefield/i.test(line) });
  }
  return out;
}

export const reducerHits = (r: Reducer, spell: SpellLike, book: CardBook, card: PlayCard) => spellMatches(r.words, spell, book, card);
export const affinityHits = (words: string, spell: SpellLike, book: CardBook, card: PlayCard) => spellMatches(words, spell, book, card);

// ── Mana ───────────────────────────────────────────────────────────────

/** "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi
    Ornitier's power. Activate only during your turn and only once each turn." */
export function powerManaOf(book: CardBook, card: PlayCard): { colors: string[]; yourTurn: boolean } | null {
  const m = /\{0\}: add x mana in any combination of \{([WUBRG])\} and\/or \{([WUBRG])\}, where x is [^.]*?'s power\.( activate only during your turn)?/i.exec(textOf(book, card));
  return m ? { colors: [m[1]!.toUpperCase(), m[2]!.toUpperCase()], yourTurn: !!m[3] } : null;
}

/** "{G}, {T}: Add X mana in any combination of colors, where X is the
    greatest power among creatures you control" (Selvala). */
export function greatestPowerManaOf(book: CardBook, card: PlayCard): { input: string } | null {
  const m = /\{([WUBRG])\}, \{T\}: add x mana in any combination of colors, where x is the greatest power among creatures you control/i.exec(textOf(book, card));
  return m ? { input: m[1]!.toUpperCase() } : null;
}

/** 'Other Elves you control have "{T}: Add {G} or {U}."' (Thranduil the Strategist) */
export function grantedManaOf(book: CardBook, card: PlayCard): { type: string; colors: string[] } | null {
  const m = /other ([a-z]+) you control have "\{T\}: add \{([WUBRG])\}(?: or \{([WUBRG])\})?\."/i.exec(textOf(book, card));
  return m ? { type: singular(m[1]!), colors: [m[2]!, m[3]].filter((c): c is string => !!c).map((c) => c.toUpperCase()) } : null;
}

// ── Triggers ───────────────────────────────────────────────────────────

/** "Whenever a non-Human creature you control attacks, look at the top six
    cards of your library. You may put a Human creature card from among them
    onto the battlefield tapped and attacking. It gains indestructible until
    end of turn." (Winota) */
export function winotaOf(book: CardBook, card: PlayCard): { notType: string; look: number; type: string } | null {
  const m = /whenever a non-([a-z]+) creature you control attacks, look at the top (\w+) cards of your library\. you may put an? ([a-z]+) creature card from among them onto the battlefield tapped and attacking/i.exec(
    textOf(book, card)
  );
  return m ? { notType: singular(m[1]!), look: num(m[2]) || 6, type: singular(m[3]!) } : null;
}

/** "Whenever one or more Dragons you control attack, draw that many cards,
    then you may put a permanent card from your hand onto the battlefield."
    (The Ur-Dragon) */
export function tribeAttackOf(book: CardBook, card: PlayCard): { type: string } | null {
  const m = /whenever one or more ([a-z]+) you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield/i.exec(textOf(book, card));
  return m ? { type: singular(m[1]!) } : null;
}

/** "Whenever another creature enters, its controller may draw a card if its
    power is greater than each other creature's power." (Selvala) */
export const drawsForBiggest = (book: CardBook, card: PlayCard) =>
  /whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power/i.test(textOf(book, card));

/** "Eminence — Whenever another nontoken Wizard you control enters, if
    Inalla is in the command zone or on the battlefield, you may pay {1}. If
    you do, create a token that's a copy of that Wizard. The token gains
    haste. Exile it at the beginning of the next end step." */
export function copyOnEnterOf(book: CardBook, card: PlayCard): { type: string; cost: string; eminence: boolean } | null {
  const m = /whenever another nontoken ([a-z]+) you control enters, if [^,]+? is in the command zone or on the battlefield, you may pay ((?:\{[^}]+\})+)\. if you do, create a token that's a copy of that/i.exec(textOf(book, card));
  return m ? { type: singular(m[1]!), cost: m[2]!, eminence: true } : null;
}

/** "Tap five untapped Wizards you control: Target player loses 7 life." (Inalla) */
export function tapTribeOf(book: CardBook, card: PlayCard): { count: number; type: string; life: number } | null {
  const m = /tap (\w+) untapped ([a-z]+) you control: target player loses (\d+) life/i.exec(textOf(book, card));
  return m ? { count: num(m[1]), type: singular(m[2]!), life: Number(m[3]) } : null;
}

/** "Whenever an Aura you control enters, if you cast it, you may search your
    library for an Aura card with mana value less than or equal to that Aura
    and with a different name than each Aura you control, put that card onto
    the battlefield attached to Light-Paws, then shuffle." */
export const auraTutorOf = (book: CardBook, card: PlayCard) =>
  /whenever an aura you control enters, if you cast it, you may search your library for an aura card with mana value less than or equal to that aura and with a different name than each aura you control/i.test(
    textOf(book, card)
  );

/** "Whenever another legendary Elf you control enters, draw two cards, then
    discard a card." (Thranduil, the Elvenking) */
export function lootOnEnterOf(book: CardBook, card: PlayCard): { type: string; legendary: boolean; draw: number } | null {
  const m = /whenever another (legendary )?([a-z]+) you control enters, draw (\w+) cards?, then discard a card/i.exec(textOf(book, card));
  return m ? { type: singular(m[2]!), legendary: !!m[1], draw: num(m[3]) } : null;
}

/** "Landfall — Whenever a land you control enters, create a 1/1 green Elf
    creature token." (Thranduil, Sindarin Liege; Thranduil the Strategist) */
export function landfallTokenOf(book: CardBook, card: PlayCard): { count: number; power: number; toughness: number; name: string; keywords: string[] } | null {
  const m = /whenever a land you control enters, create (a|an|one|two|three) (\d+)\/(\d+) ([a-z ]+?) creature tokens?(?: with ([a-z]+))?/i.exec(textOf(book, card));
  if (!m) return null;
  const name = m[4]!
    .split(" ")
    .filter((w) => !["white", "blue", "black", "red", "green", "colorless", "and"].includes(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  return { count: num(m[1]), power: Number(m[2]), toughness: Number(m[3]), name: name || "Token", keywords: m[5] ? [m[5][0]!.toUpperCase() + m[5].slice(1)] : [] };
}

/** "At the beginning of each upkeep, create a 1/1 black and green Pest
    creature token…" (Beledros Witherbloom) */
export const upkeepTokenOf = (book: CardBook, card: PlayCard) => {
  const m = /at the beginning of each upkeep, create (a|an|one|two) (\d+)\/(\d+) ([a-z ]+?) creature token/i.exec(textOf(book, card));
  if (!m) return null;
  const name = m[4]!.split(" ").filter((w) => !["white", "blue", "black", "red", "green", "and"].includes(w.toLowerCase())).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return { count: num(m[1]), power: Number(m[2]), toughness: Number(m[3]), name: name || "Token" };
};

/** "Pay 10 life: Untap all lands you control. Activate only once each turn."
    (Beledros Witherbloom) */
export function untapLandsOf(book: CardBook, card: PlayCard): { life: number } | null {
  const m = /^pay (\d+) life: untap all lands you control\. activate only once each turn/im.exec(textOf(book, card));
  return m ? { life: Number(m[1]) } : null;
}

/** "At the beginning of each player's end step, Kratos deals damage to that
    player equal to the number of creatures that player controls that didn't
    attack this turn." */
export const punishesIdleOf = (book: CardBook, card: PlayCard) =>
  /at the beginning of each player's end step, [^,]+? deals damage to that player equal to the number of creatures that player controls that didn't attack this turn/i.test(
    textOf(book, card)
  );

/** "At the beginning of your end step, you may sacrifice an artifact,
    creature, enchantment, land, or planeswalker. If you do, each opponent
    may sacrifice a permanent of their choice that shares a card type with
    it. For each opponent who doesn't, that player loses 2 life and you draw
    a card." (Braids, Arisen Nightmare) */
export function braidsOf(book: CardBook, card: PlayCard): { life: number } | null {
  const m = /at the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker\. if you do, each opponent may sacrifice a permanent of their choice that shares a card type with it\. for each opponent who doesn't, that player loses (\d+) life and you draw a card/i.exec(
    textOf(book, card)
  );
  return m ? { life: Number(m[1]) } : null;
}

/** "Whenever Silas Renn deals combat damage to a player, choose target
    artifact card in your graveyard. You may cast that card this turn." */
export const castFromGraveyardOnHitOf = (book: CardBook, card: PlayCard) => {
  const m = /deals combat damage to a player, choose target ([a-z]+) card in your graveyard\. you may cast that card this turn/i.exec(textOf(book, card));
  return m ? m[1]!.toLowerCase() : null;
};
