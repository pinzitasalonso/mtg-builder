// Instants and sorceries the AI's built-in planner can cast on its own:
// tutors, board wipes, and spells that draw. Each reader takes a card only
// when its whole text is something the planner can carry out with the
// effect vocabulary (lib/practice/types.ts Effect), so a card that does
// more is left alone, as before.

import { parseSearch, searchOnCast, type Search } from "./cards";
import type { CardInfo } from "./types";

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (w: string) => NUMBERS[w.toLowerCase()] ?? Number(w);

const isSpell = (info: CardInfo | undefined) => /\b(Instant|Sorcery)\b/.test((info?.typeLine ?? "").split(" // ")[0]!);

/** The text's sentences, without reminder text or full stops. */
function sentences(info: CardInfo | undefined): string[] {
  return (info?.oracleText ?? "")
    .split("\n//\n")[0]!
    .replace(/\([^)]*\)/g, "")
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

/** A tutor: "Search your library for a card, put that card into your
    hand, then shuffle" (Demonic Tutor), or onto the top (Vampiric Tutor,
    Mystical Tutor, Worldly Tutor, Enlightened Tutor, Imperial Seal), and
    perhaps "You lose N life". */
export interface Tutor {
  search: Search;
  lose: number;
  /** "…put that card into your hand, discard a card at random, then
      shuffle" (Gamble). */
  discardRandom?: boolean;
  /** Lim-Dûl's Vault: it looks at five cards at a time, and passing a five
      costs 1 life. The find goes on top. */
  dig?: number;
  /** "…with mana value X or less" (Green Sun's Zenith, Chord of Calling,
      Finale of Devastation): the X paid as it's cast is the limit. */
  x?: boolean;
  /** "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't,
      you lose the game" (Summoner's Pact): that cost. */
  upkeep?: string;
  /** "Delirium — If there are four or more card types among cards in
      your graveyard, instead search your library for any card…" (Demonic
      Counsel): the search then. */
  delirium?: Search;
}

const CARD_TYPES = ["artifact", "battle", "creature", "enchantment", "instant", "kindred", "land", "planeswalker", "sorcery", "tribal"];

/** The card types among these cards (both faces of a double-faced one). */
export function cardTypesAmong(typeLines: (string | null | undefined)[]): number {
  const found = new Set<string>();
  for (const t of typeLines) for (const type of CARD_TYPES) if (new RegExp(`\\b${type}\\b`, "i").test(t ?? "")) found.add(type === "tribal" ? "kindred" : type);
  return found.size;
}

/** What a tutor searches for now: Demonic Counsel finds any card with
    four card types in the graveyard, a Demon otherwise. */
export function tutorSearch(t: Tutor, graveyard: { typeLine: string | null }[]): Search {
  return t.delirium && cardTypesAmong(graveyard.map((c) => c.typeLine)) >= 4 ? t.delirium : t.search;
}
const VAULT =
  /^look at the top five cards of your library\. as many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library\. then shuffle and put the last cards you looked at this way on top in any order\.?$/i;

export function tutorOf(info: CardInfo | undefined): Tutor | null {
  if (!isSpell(info)) return null;
  // Lim-Dûl's Vault is played as a tutor to the top that costs life: its
  // text has no "search", so the table did nothing with it, and a plan's
  // note told the player which card it was after.
  if (VAULT.test((info?.oracleText ?? "").split("\n//\n")[0]!.replace(/\s*\n\s*/g, " ").trim())) {
    return { search: { count: 1, what: "a card", to: [{ zone: "top" }], test: () => true }, lose: 0, dig: 5 };
  }
  // A sacrifice as it's cast (Diabolic Intent) is a cost the table takes.
  // Bargain (Beseech the Mirror) is a choice the table doesn't make: the
  // card comes to the hand.
  const [first, ...rest] = sentences(info).filter((x) => !/^as an additional cost to cast this spell, sacrifice an? [a-z ]+$/i.test(x) && !/^(?:bargain|convoke)$/i.test(x));
  // A creature straight onto the battlefield, as big as the X paid: Green
  // Sun's Zenith, Nature's Rhythm, Chord of Calling, Finale of Devastation.
  const big = first ? /^search your library(?: and\/or graveyard)? for an? (green )?creature card with mana value x or less(?:, put it onto the battlefield, then shuffle| and put it onto the battlefield)$/i.exec(first) : null;
  if (big) {
    const extra = [/^shuffle .+ into its owner's library$/i, /^if you search your library this way, shuffle$/i, /^if x is 10 or more, creatures you control get \+x\/\+x and gain haste until end of turn$/i, /^harmonize\b/i];
    if (rest.some((r) => !extra.some((e) => e.test(r)))) return null;
    const green = !!big[1];
    return {
      search: {
        count: 1,
        what: `${green ? "green " : ""}creature card`,
        to: [{ zone: "battlefield" }],
        test: (typeLine, i) => /\bCreature\b/.test((i?.typeLine ?? typeLine ?? "").split(" // ")[0]!) && (!green || /\{[^}]*G[^}]*\}/.test(i?.manaCost ?? "")),
      },
      lose: 0,
      x: true,
    };
  }
  // The whole sentence, and only to the hand or the top: Entomb's "into
  // your graveyard" isn't this. Gamble's random discard is.
  const m = first ? /^search your library for [^,.]*?\bcard(?:, reveal (?:it|that card))?, (?:put (?:it|that card|the card) into your hand(, discard a card at random)?, then shuffle|then shuffle and put (?:it|that card|the card) on top|exile it face down, then shuffle)$/i.exec(first) : null;
  if (!m) return null;
  const faceDown = /exile it face down/i.test(first!);
  let lose = 0;
  let delirium: Search | undefined;
  let upkeep: string | undefined;
  for (const [n, s] of rest.entries()) {
    // Summoner's Pact: paid for at the next upkeep, or the game is lost.
    const pact = /^at the beginning of your next upkeep, pay ((?:\{[^}]+\})+)$/i.exec(s);
    if (pact && /^if you don't, you lose the game$/i.test(rest[n + 1] ?? "")) {
      upkeep = pact[1]!;
      continue;
    }
    if (upkeep && /^if you don't, you lose the game$/i.test(s)) continue;
    const life = /^you lose (\d+) life$/i.exec(s);
    if (life) {
      lose += Number(life[1]);
      continue;
    }
    const d = /^delirium — if there are four or more card types among cards in your graveyard, instead (search your library for any card, put it into your hand, then shuffle)$/i.exec(s);
    if (d) {
      // "any card" is a card of any kind.
      delirium = parseSearch(d[1]!.replace(/\bfor any card\b/i, "for a card")) ?? undefined;
      continue;
    }
    // Beseech the Mirror's rest: the card comes to the hand.
    if (faceDown && (/^if this spell was bargained, you may cast the exiled card without paying its mana cost/i.test(s) || /^put the exiled card into your hand if it wasn't cast this way$/i.test(s))) continue;
    return null;
  }
  if (faceDown && !rest.some((s) => /^put the exiled card into your hand/i.test(s))) return null;
  const search = searchOnCast(info);
  if (!search || search.count !== 1 || search.to[0]!.zone === "battlefield") return null;
  return { search, lose, ...(m[1] ? { discardRandom: true } : {}), ...(delirium ? { delirium } : {}), ...(upkeep ? { upkeep } : {}) };
}

/** A board wipe: "Destroy all creatures" (Wrath of God, Damnation, Day of
    Judgment, Supreme Verdict), "~ deals N damage to each creature"
    (Pyroclasm), "All creatures get -N/-N until end of turn", and Toxic
    Deluge's X, paid in life. */
export interface Wipe {
  kind: "destroy" | "damage" | "shrink";
  /** Damage or -N/-N; null for Toxic Deluge's X, chosen as it's cast. */
  amount: number | null;
}
export function wipeOf(info: CardInfo | undefined): Wipe | null {
  if (!isSpell(info)) return null;
  let wipe: Wipe | null = null;
  let payX = false;
  for (const s of sentences(info)) {
    if (/^they can't be regenerated$|^this spell can't be countered$/i.test(s)) continue;
    if (/^as an additional cost to cast this spell, pay x life$/i.test(s)) {
      payX = true;
      continue;
    }
    let m: RegExpExecArray | null;
    if (!wipe && /^destroy all creatures$/i.test(s)) wipe = { kind: "destroy", amount: 0 };
    else if (!wipe && (m = /^\S.* deals (\d+) damage to each creature$/i.exec(s))) wipe = { kind: "damage", amount: Number(m[1]) };
    else if (!wipe && (m = /^all creatures get -(\d+|x)\/-\1 until end of turn$/i.exec(s))) wipe = { kind: "shrink", amount: m[1]!.toLowerCase() === "x" ? null : Number(m[1]) };
    else return null;
  }
  if (!wipe || (wipe.amount === null) !== payX) return null;
  return wipe;
}

/** A spell that draws and maybe costs life, with a scry before it that the
    planner skips: "Draw two cards", "You draw two cards and lose 2 life"
    (Night's Whisper), "Target player draws two cards and loses 2 life"
    (Sign in Blood, on itself), "Scry 1. Draw a card" (Opt), "Scry 2, then
    draw two cards. You lose 2 life" (Read the Bones). */
export interface DrawSpell {
  draw: number;
  lose: number;
  /** "…then put two cards from your hand on top of your library"
      (Brainstorm): cards that go back after the draw. */
  back?: number;
  /** Cards discarded: before the draw ("Discard a card, then draw two
      cards", "You may discard a card. If you do, draw two cards", or as an
      additional cost), or after it (Frantic Search). The table picks them. */
  discard?: number;
  discardFirst?: boolean;
  /** "Exile the top two cards of your library. Until the end of your next
      turn, you may play those cards" (Reckless Impulse): how many. With
      `impulseNow`, this turn only (Rob the Archives). */
  impulse?: number;
  impulseNow?: boolean;
  /** "Untap up to three lands" (Frantic Search). */
  untap?: number;
}
export function drawSpellOf(info: CardInfo | undefined): DrawSpell | null {
  if (!isSpell(info)) return null;
  let draw = 0;
  let lose = 0;
  let back = 0;
  let discard = 0;
  let discardFirst = false;
  let impulse = 0;
  let impulseNow = false;
  let untap = 0;
  for (const s of sentences(info)) {
    let m: RegExpExecArray | null;
    // Other ways to cast it that the table doesn't use.
    if (/^(?:plot|casualty|flashback)\b/i.test(s)) continue;
    // A card for the cards: "You may discard a card. If you do, draw two
    // cards" (Abandon Attachments; Vision of Love and Highway Robbery,
    // whose other payment the table doesn't use), or as an additional cost
    // (Demand Answers), or "Discard a card, then draw two cards".
    if (/^you may (?:sacrifice an artifact or )?discard a card(?: or sacrifice a land)?$/i.test(s) || /^as an additional cost to cast this spell, (?:sacrifice an artifact or )?discard a card$/i.test(s)) {
      discard += 1;
      discardFirst = true;
    } else if (discardFirst && (m = /^if you do, draw (a|one|two|three) cards?$/i.exec(s))) draw += num(m[1]!);
    else if ((m = /^discard a card, then draw (a|one|two|three) cards?$/i.exec(s))) {
      discard += 1;
      discardFirst = true;
      draw += num(m[1]!);
    } else if ((m = /^draw (a|one|two|three) cards?, then discard (a|one|two|three) cards?$/i.exec(s))) {
      draw += num(m[1]!);
      discard += num(m[2]!);
    } else if ((m = /^untap up to (one|two|three|four) lands$/i.exec(s))) untap = num(m[1]!);
    // Reckless Impulse, Wrenn's Resolve, Rob the Archives.
    else if ((m = /^exile the top (two|three) cards of your library$/i.exec(s))) impulse += num(m[1]!);
    else if (impulse && /^until the end of your next turn, you may play those cards$/i.test(s)) continue;
    else if (impulse && /^you may play those cards this turn$/i.test(s)) impulseNow = true;
    // What changes nothing the table tracks.
    else if (/^if this spell wasn't cast from your hand, draw two cards instead$/i.test(s) || /^lands you control gain all basic land types until end of turn$/i.test(s)) continue;
    else if ((m = /^(?:scry \d+, then )?(?:you )?draw (a|one|two|three|four) cards?(?: and (?:you )?lose (\d+) life)?$/i.exec(s))) {
      draw += num(m[1]!);
      lose += Number(m[2] ?? 0);
    } else if ((m = /^target player draws (a|one|two|three) cards? and loses (\d+) life$/i.exec(s))) {
      draw += num(m[1]!);
      lose += Number(m[2]);
    } else if ((m = /^you lose (\d+) life$/i.exec(s))) lose += Number(m[1]);
    else if (/^scry \d+$/i.test(s)) continue;
    // What changes nothing on the table: a look at a hand (Gitaxian
    // Probe), flash for the turn (Borne Upon a Wind).
    else if (/^look at target (?:player's|opponent's) hand$/i.test(s) || /^you may cast spells this turn as though they had flash$/i.test(s)) continue;
    // Brainstorm.
    else if ((m = /^draw (a|one|two|three|four) cards?, then put (a|one|two|three) cards? from your hand on top of your library in any order$/i.exec(s))) {
      draw += num(m[1]!);
      back += num(m[2]!);
    } else return null;
  }
  if (!draw && !impulse) return null;
  return { draw, lose, ...(back ? { back } : {}), ...(discard ? { discard, discardFirst } : {}), ...(impulse ? { impulse, ...(impulseNow ? { impulseNow } : {}) } : {}), ...(untap ? { untap } : {}) };
}

/** A draw spell the table carries out whole, whatever the plan says: one
    that discards, exiles cards to play, or untaps lands. */
export const lootOf = (info: CardInfo | undefined): DrawSpell | null => {
  const d = drawSpellOf(info);
  return d && (d.discard || d.impulse || d.untap) ? d : null;
};

/** A spell that makes one creature bigger for the turn: "Target creature
    gets +3/+0 and gains haste until end of turn" (Wild Ride), "…gets +1/+0
    and gains first strike…" (Crowd's Favor), "Switch target creature's
    power and toughness until end of turn. Draw a card" (Twisted Image),
    "Target creature gets +X/+0 until end of turn" (Blazing Shoal, which may
    be paid for with a red card from the hand, X its mana value). Also one
    mode of a "Choose one —" spell (Secret Identity's 3/4, Siege Smash's
    +3/+2): `modal`, and the table pumps only when the plan asks for it. */
export interface PumpSpell {
  /** A number; "x", the X that was paid; "switch", power and toughness swapped. */
  power: number | "x" | "switch";
  toughness: number;
  /** "…becomes a Hero with base power and toughness 3/4": its base, in
      place of the card's own. */
  base?: { power: number; toughness: number };
  draw: number;
  keywords: string[];
  /** "You may exile a red card with mana value X from your hand rather
      than pay this spell's mana cost": the colour. */
  pitch?: string;
  modal?: boolean;
}
const COLOUR_LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const keywordsIn = (words: string | undefined) => (words ? words.split(/,? and |, /).map((k) => k.trim()) : []);
type PumpLine = Pick<PumpSpell, "power" | "toughness" | "base" | "keywords">;
function pumpLine(s: string): PumpLine | null {
  let m: RegExpExecArray | null;
  if ((m = /^(?:one or two )?target creatures? (?:each )?gets? \+(\d+|x)\/\+(\d+)(?: and gains? ([a-z ,]+?))? until end of turn$/i.exec(s))) {
    return { power: m[1]!.toLowerCase() === "x" ? "x" : Number(m[1]), toughness: Number(m[2]), keywords: keywordsIn(m[3]) };
  }
  if (/^switch target creature's power and toughness until end of turn$/i.test(s)) return { power: "switch", toughness: 0, keywords: [] };
  if ((m = /^until end of turn, target creature you control becomes an? [a-z ]+ with base power and toughness (\d+)\/(\d+)(?: and gains ([a-z ,]+?))?$/i.exec(s))) {
    return { power: 0, toughness: 0, base: { power: Number(m[1]), toughness: Number(m[2]) }, keywords: keywordsIn(m[3]) };
  }
  return null;
}
export function pumpSpellOf(info: CardInfo | undefined): PumpSpell | null {
  if (!isSpell(info)) return null;
  const lines = (info?.oracleText ?? "")
    .split("\n//\n")[0]!
    .replace(/\([^)]*\)/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines.findIndex((l) => /^choose one —$/i.test(l));
  if (head >= 0) {
    const modes = lines.slice(head + 1);
    if (lines.slice(0, head).some((l) => !/^split second$/i.test(l)) || modes.some((l) => !l.startsWith("•"))) return null;
    const size = (p: PumpLine) => (p.base ? p.base.power : typeof p.power === "number" ? p.power : 0);
    const best = modes
      .map((l) => pumpLine(l.replace(/^•\s*(?:[A-Z][a-z]+ — )?/, "").replace(/\.$/, "")))
      .filter((x): x is PumpLine => !!x)
      .sort((a, b) => size(b) - size(a))[0];
    return best ? { ...best, draw: 0, modal: true } : null;
  }
  let pump: PumpLine | null = null;
  let draw = 0;
  let pitch: string | undefined;
  for (const s of sentences(info)) {
    let m: RegExpExecArray | null;
    // Other ways to cast it that the table doesn't use.
    if (/^(?:convoke|harmonize\b.*|flashback\b.*)$/i.test(s)) continue;
    if ((m = /^you may exile an? (white|blue|black|red|green) card with mana value x from your hand rather than pay this spell's mana cost$/i.exec(s))) pitch = COLOUR_LETTER[m[1]!.toLowerCase()];
    else if (!pump && pumpLine(s)) pump = pumpLine(s);
    else if (/^draw a card$/i.test(s)) draw += 1;
    else return null;
  }
  return pump ? { ...pump, draw, ...(pitch ? { pitch } : {}) } : null;
}
