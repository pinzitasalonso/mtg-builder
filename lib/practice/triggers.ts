// The triggered abilities most decks are full of, read from a card's text:
// "When this creature enters, draw a card", "At the beginning of your
// upkeep, you draw a card and lose 1 life", "Whenever another creature dies,
// each opponent loses 1 life", "Whenever an opponent draws a card, …".
//
// One rule keeps this honest: a trigger is only carried out when the table
// can do ALL of what it says. An effect it half understands ("draw a card
// for each…", "…if you control…", a target to choose) is left alone, for
// the player to resolve or the model to plan, as before. So this reads a
// small vocabulary and refuses the rest:
//   draw N · you gain / lose N life · each opponent loses N life ·
//   it deals N damage to each opponent · +1/+1 counters on itself ·
//   N creature tokens (with keywords) · Treasure, Food and Clue tokens.
//
// Any card worded this way works, on either side. The cards and commanders
// with their own readers (lib/practice/cards.ts, abilities.ts) are not
// read twice: their wording doesn't fit this vocabulary.

import type { PlayCard } from "../playtest";
import { faceText, infoOf } from "./cards";
import type { CardBook } from "./types";

/** What a trigger does, all of it. */
export interface Outcome {
  draw: number;
  gain: number;
  /** Its controller loses life (Phyrexian Arena). */
  lose: number;
  /** Each opponent loses life. */
  drain: number;
  /** Damage to each opponent. */
  damage: number;
  /** +1/+1 counters on the card itself. */
  counters: number;
  tokens: { count: number; name: string; power: number; toughness: number; keywords: string[] }[];
  artifacts: { count: number; name: "Treasure" | "Food" | "Clue" }[];
}

export interface Triggers {
  /** "When this enters, …" */
  enters?: Outcome;
  /** "Whenever this attacks, …" */
  attacks?: Outcome;
  /** "At the beginning of your upkeep, …" */
  upkeep?: Outcome;
  /** "At the beginning of your end step, …" */
  endStep?: Outcome;
  /** "Whenever a land you control enters, …" */
  landfall?: Outcome;
  /** "Whenever another creature you control [with power 4 or greater] enters, …" */
  creatureEnters?: { another: boolean; nontoken: boolean; anyone: boolean; minPower: number; keyword: string | null; out: Outcome };
  /** "Whenever another creature [you control] dies, …" */
  dies?: { another: boolean; own: boolean; out: Outcome };
  /** "Whenever an opponent draws a card, …": damage to that player
      (Nekusar), or a Treasure unless they pay (Smothering Tithe). */
  oppDraws?: { damage: number; treasure: boolean; pay: number };
  /** "Whenever an opponent casts a spell, you may draw a card unless that
      player pays {1}" (Rhystic Study, Esper Sentinel). */
  tax?: { noncreature: boolean; first: boolean; cost: number | "power" };
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (w: string | undefined) => (w ? (NUM[w] ?? (Number(w) || 0)) : 0);
const COLORS = new Set(["white", "blue", "black", "red", "green", "colorless", "and", "artifact", "enchantment", "legendary", "snow"]);
/** The keywords a token is made with. Any other "with …" is beyond the table. */
const KEYWORD = "(?:flying|first strike|double strike|deathtouch|defender|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance)";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1) : w);
const empty = (): Outcome => ({ draw: 0, gain: 0, lose: 0, drain: 0, damage: 0, counters: 0, tokens: [], artifacts: [] });

/** The card, as its own text names it. */
function selfPattern(names: string[]): string {
  return `(?:${[...names.map((n) => esc(n.toLowerCase())), "this creature", "this enchantment", "this artifact", "this permanent", "this land", "it", "~"].join("|")})`;
}

/** What a clause does, when every word of it is something the table can
    do. Null otherwise: nothing is carried out by halves. */
export function outcomeOf(clause: string, self: string): Outcome | null {
  let rest = ` ${clause.toLowerCase().replace(/\([^)]*\)/g, " ")} `;
  const out = empty();
  const take = (re: RegExp, found: (m: string[]) => void) => {
    rest = rest.replace(re, (...m) => {
      found(m as string[]);
      return " ";
    });
  };
  take(/\beach opponent loses (\d+) life\b/g, (m) => (out.drain += num(m[1])));
  take(new RegExp(`\\b${self} deals (\\d+) damage to each opponent\\b`, "g"), (m) => (out.damage += num(m[1])));
  take(/\b(?:you )?(?:may )?draw (a|an|one|two|three|four|\d+) cards?\b/g, (m) => (out.draw += num(m[1])));
  take(/\b(?:you )?gain (\d+) life\b/g, (m) => (out.gain += num(m[1])));
  take(/\b(?:you )?lose (\d+) life\b/g, (m) => (out.lose += num(m[1])));
  take(new RegExp(`\\bput (a|an|one|two|three|\\d+) \\+1/\\+1 counters? on ${self}\\b`, "g"), (m) => (out.counters += num(m[1])));
  take(new RegExp(`\\bcreate (a|an|one|two|three|four|five|\\d+) (\\d+)\\/(\\d+) ([a-z ]+?) creature tokens?(?: with (${KEYWORD}(?:(?:, and |, | and )${KEYWORD})*))?(?=[\\s,.]|$)`, "g"), (m) => {
    const name = m[4]!.split(" ").filter((w) => !COLORS.has(w)).map(cap).join(" ") || "Token";
    const keywords = (m[5] ?? "").split(/, and |, | and /).map((k) => cap(k.trim())).filter(Boolean);
    out.tokens.push({ count: num(m[1]), name, power: Number(m[2]), toughness: Number(m[3]), keywords });
  });
  take(/\bcreate (a|an|one|two|three|\d+) (treasure|food|clue) tokens?\b/g, (m) => out.artifacts.push({ count: num(m[1]), name: cap(m[2]!) as "Treasure" | "Food" | "Clue" }));
  // Every word accounted for, or nothing happens.
  if (rest.replace(/\b(?:and|then|you|may|also)\b/g, " ").replace(/[\s,.]/g, "")) return null;
  const any = out.draw || out.gain || out.lose || out.drain || out.damage || out.counters || out.tokens.length || out.artifacts.length;
  return any ? out : null;
}

const memo = new Map<string, Triggers>();

/** A permanent's triggers the table carries out by itself. */
export function triggersOf(book: CardBook, card: PlayCard): Triggers {
  if (card.token) return {};
  const info = infoOf(book, card);
  const text = faceText(info, card);
  if (!text) return {};
  const name = (info?.name ?? card.name).split(" // ")[card.flipped ? 1 : 0]!.trim();
  const key = `${name}\n${text}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const found = readTriggers(text, name);
  if (memo.size > 800) memo.clear();
  memo.set(key, found);
  return found;
}

/** The triggers in a card's rules text. */
export function readTriggers(text: string, name: string): Triggers {
  const self = selfPattern([name, name.split(",")[0]!.trim()]);
  const t: Triggers = {};
  // Two triggers of one kind on a card: neither is carried out, as the
  // table couldn't say it did all the card says.
  const twice = new Set<keyof Triggers>();
  const set = <K extends keyof Triggers>(k: K, v: Triggers[K] | null | undefined) => {
    if (!v || twice.has(k)) return;
    if (t[k]) {
      delete t[k];
      twice.add(k);
    } else t[k] = v;
  };
  const cumulative = /\bcumulative upkeep\b/i.test(text);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    // Eminence works from the command zone: not this reader's.
    if (!line || /^eminence\b/.test(line)) continue;
    // "Landfall — Whenever…": the ability word isn't part of the rule.
    const body = line.replace(/^[a-z' ]{3,24} — /, "");
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^whenever ${self} enters(?: the battlefield)? or attacks, (.+)$`).exec(body))) {
      const out = outcomeOf(m[1]!, self);
      set("enters", out);
      set("attacks", out);
    } else if ((m = new RegExp(`^when(?:ever)? ${self} enters(?: the battlefield)?, (.+)$`).exec(body))) set("enters", outcomeOf(m[1]!, self));
    else if ((m = new RegExp(`^whenever ${self} attacks, (.+)$`).exec(body))) set("attacks", outcomeOf(m[1]!, self));
    else if ((m = /^at the beginning of your upkeep, (.+)$/.exec(body))) set("upkeep", outcomeOf(m[1]!, self));
    else if ((m = /^at the beginning of your end step, (.+)$/.exec(body))) set("endStep", outcomeOf(m[1]!, self));
    else if ((m = /^whenever a land (?:you control enters|enters(?: the battlefield)? under your control), (.+)$/.exec(body))) set("landfall", outcomeOf(m[1]!, self));
    else if ((m = /^whenever (another|a) (nontoken )?creature (you control )?(?:with (?:power (\d+) or greater|([a-z]+(?: [a-z]+)?)) )?enters(?: the battlefield)?( under your control)?, (.+)$/.exec(body))) {
      const out = outcomeOf(m[7]!, self);
      if (out) set("creatureEnters", { another: m[1] === "another", nontoken: !!m[2], anyone: !m[3] && !m[6], minPower: Number(m[4]) || 0, keyword: m[5] ? cap(m[5]) : null, out });
    } else if ((m = new RegExp(`^whenever (${self} or )?(another|a) creature (you control )?dies, (.+)$`).exec(body))) {
      // "This creature or another creature you control dies": its own death counts too.
      const out = outcomeOf(m[4]!, self);
      if (out) set("dies", { another: m[2] === "another" && !m[1], own: !!m[3], out });
    } else if ((m = new RegExp(`^whenever an opponent draws a card, ${self} deals (\\d+) damage to that player\\.?$`).exec(body))) set("oppDraws", { damage: Number(m[1]), treasure: false, pay: 0 });
    else if ((m = /^whenever an opponent draws a card, that player may pay \{(\d+)\}\. if (?:the|that) player doesn't, you create a treasure token\.?$/.exec(body))) set("oppDraws", { damage: 0, treasure: true, pay: Number(m[1]) });
    else if (!cumulative && (m = /^whenever an opponent casts (a|their first) (noncreature )?spell(?: each turn)?, (?:you may )?draw a card unless that player pays \{(\d+|x)\}/.exec(body)))
      set("tax", { noncreature: !!m[2], first: m[1] !== "a", cost: m[3] === "x" ? "power" : Number(m[3]) });
  }
  return t;
}

/** Does a card have any trigger the table carries out? (For the model's notes.) */
export const hasTriggers = (book: CardBook, card: PlayCard) => Object.keys(triggersOf(book, card)).length > 0;
