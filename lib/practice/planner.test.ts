// The built-in planner's instants and sorceries: tutors, board wipes and
// draw spells. Card text is Scryfall's (fixtures/planner-spells.json).

import { describe, expect, it } from "vitest";
import { fallbackPlan } from "./ai";
import { applyAction, cardId, newGame, type DeckCard } from "./game";
import { drawSpellOf, tutorOf, wipeOf } from "./spells";
import type { CardBook, CardInfo, PracticeGame } from "./types";
import SPELLS from "./fixtures/planner-spells.json";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const land = (name: string, color: string, type: string) => info(name, { typeLine: `Basic Land — ${type}`, producedMana: [color] });
const BOOK: CardBook = Object.fromEntries(
  [
    land("Swamp", "B", "Swamp"),
    land("Plains", "W", "Plains"),
    land("Forest", "G", "Forest"),
    info("Grizzly Bears", { typeLine: "Creature — Bear", manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Hill Giant", { typeLine: "Creature — Giant", manaCost: "{3}{R}", manaValue: 4, power: 3, toughness: 3 }),
    info("Serra Angel", { typeLine: "Creature — Angel", manaCost: "{3}{W}{W}", manaValue: 5, power: 4, toughness: 4 }),
    info("Zagoth Triome", { typeLine: "Land — Swamp Forest Island", producedMana: ["B", "G", "U"], oracleText: "({T}: Add {B}, {G}, or {U}.)\nThis land enters tapped.\nCycling {3} ({3}, Discard this card: Draw a card.)" }),
    info("Craterhoof Behemoth", { typeLine: "Creature — Beast", manaCost: "{5}{G}{G}{G}", manaValue: 8, power: 5, toughness: 5 }),
    ...SPELLS.map((c) => info(c.name, { typeLine: c.typeLine, manaCost: c.manaCost, manaValue: c.manaValue, oracleText: c.oracleText })),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));
const of = (name: string) => BOOK[name.toLowerCase()];

/** The AI's turn 5, laid out by hand: its battlefield, hand and library top. */
function table(o: { field?: string[]; hand?: string[]; top?: string[]; youField?: string[]; life?: number }): PracticeGame {
  const names = [...(o.field ?? []), ...(o.hand ?? []), ...(o.top ?? [])];
  let g = newGame({ you: { cards: deck(...(o.youField ?? []), ...Array(20).fill("Forest")) }, opp: { cards: deck(...names, ...Array(20).fill("Plains")) }, commanderGame: true, first: "opp", shuffle: keep });
  const all = [...g.sides.opp.hand, ...g.sides.opp.library];
  const take = (n: string) => all.splice(all.findIndex((c) => c.name === n), 1)[0]!;
  const field = (o.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
  const hand = (o.hand ?? []).map(take);
  const top = (o.top ?? []).map(take);
  g.sides.opp = { ...g.sides.opp, battlefield: field, hand, library: [...top, ...all], life: o.life ?? 40 };
  const yours = [...g.sides.you.hand, ...g.sides.you.library];
  const yf = (o.youField ?? []).map((n) => ({ ...yours.splice(yours.findIndex((c) => c.name === n), 1)[0]!, enteredTurn: 0 }));
  g.sides.you = { ...g.sides.you, battlefield: yf, hand: [], library: yours };
  g = { ...g, turn: 5, active: "opp", landPlayed: true };
  return g;
}
const play = (g: PracticeGame) => {
  const plan = fallbackPlan(g, BOOK, "opp");
  let after = g;
  for (const a of plan.main) after = applyAction(after, "opp", a, BOOK).game;
  const names = plan.main.map((a) => [...g.sides.opp.hand, ...g.sides.opp.command].find((c) => cardId(c.iid) === a.card)?.name);
  return { plan, after, names };
};

describe("reading the spells", () => {
  it("tutors, to hand or on top, with their life", () => {
    expect(tutorOf(of("Demonic Tutor"))).toMatchObject({ lose: 0, search: { to: [{ zone: "hand" }] } });
    expect(tutorOf(of("Grim Tutor"))).toMatchObject({ lose: 3 });
    expect(tutorOf(of("Vampiric Tutor"))).toMatchObject({ lose: 2, search: { to: [{ zone: "top" }] } });
    const mystical = tutorOf(of("Mystical Tutor"))!;
    expect(mystical.search.to[0]!.zone).toBe("top");
    expect(mystical.search.test("Instant", of("Opt"))).toBe(true);
    expect(mystical.search.test("Creature — Giant", of("Hill Giant"))).toBe(false);
  });

  it("board wipes, and the ones that do more", () => {
    expect(wipeOf(of("Wrath of God"))).toEqual({ kind: "destroy", amount: 0 });
    expect(wipeOf(of("Supreme Verdict"))).toEqual({ kind: "destroy", amount: 0 });
    expect(wipeOf(of("Pyroclasm"))).toEqual({ kind: "damage", amount: 2 });
    expect(wipeOf(of("Toxic Deluge"))).toEqual({ kind: "shrink", amount: null });
    for (const n of ["Anger of the Gods", "Blasphemous Act", "Austere Command"]) expect(wipeOf(of(n))).toBeNull();
  });

  it("draw spells, with what they cost in life", () => {
    expect(drawSpellOf(of("Night's Whisper"))).toEqual({ draw: 2, lose: 2 });
    expect(drawSpellOf(of("Sign in Blood"))).toEqual({ draw: 2, lose: 2 });
    expect(drawSpellOf(of("Opt"))).toEqual({ draw: 1, lose: 0 });
    expect(drawSpellOf(of("Preordain"))).toEqual({ draw: 1, lose: 0 });
    expect(drawSpellOf(of("Read the Bones"))).toEqual({ draw: 2, lose: 2 });
    expect(drawSpellOf(of("Divination"))).toEqual({ draw: 2, lose: 0 });
    for (const n of ["Brainstorm", "Ponder", "Painful Truths"]) expect(drawSpellOf(of(n))).toBeNull();
  });
});

describe("the planner casts them", () => {
  it("Demonic Tutor finds the biggest card it can cast next turn", () => {
    const { names, after } = play(table({ field: ["Swamp", "Swamp", "Swamp", "Swamp"], hand: ["Demonic Tutor"], top: ["Grizzly Bears", "Craterhoof Behemoth", "Serra Angel"] }));
    expect(names).toEqual(["Demonic Tutor"]);
    // Four lands: Serra Angel (5) is in reach next turn, the Behemoth (8) isn't.
    expect(after.sides.opp.hand.map((c) => c.name)).toEqual(["Serra Angel"]);
  });

  it("Vampiric Tutor puts it on top and costs 2 life", () => {
    const { after } = play(table({ field: ["Swamp", "Swamp", "Swamp", "Swamp"], hand: ["Vampiric Tutor"], top: ["Grizzly Bears", "Serra Angel"] }));
    expect(after.sides.opp.library[0]!.name).toBe("Serra Angel");
    expect(after.sides.opp.life).toBe(38);
  });

  it("Wrath of God when the player's board is the bigger, not when its own is", () => {
    const big = play(table({ field: ["Plains", "Plains", "Plains", "Plains"], hand: ["Wrath of God"], youField: ["Hill Giant", "Serra Angel", "Grizzly Bears"] }));
    expect(big.names).toEqual(["Wrath of God"]);
    expect(big.after.sides.you.battlefield).toEqual([]);
    const mine = play(table({ field: ["Plains", "Plains", "Plains", "Plains", "Serra Angel", "Hill Giant"], hand: ["Wrath of God"], youField: ["Grizzly Bears"] }));
    expect(mine.names).not.toContain("Wrath of God");
  });

  it("Toxic Deluge pays just enough life to kill the player's creatures and keep its own", () => {
    const { names, after } = play(table({ field: ["Swamp", "Swamp", "Swamp", "Serra Angel"], hand: ["Toxic Deluge"], youField: ["Hill Giant", "Hill Giant", "Grizzly Bears"] }));
    expect(names).toEqual(["Toxic Deluge"]);
    expect(after.sides.you.battlefield).toEqual([]);
    expect(after.sides.opp.battlefield.map((c) => c.name)).toContain("Serra Angel");
    expect(after.sides.opp.life).toBe(37);
  });

  it("Night's Whisper draws two for 2 life, but not when life is short", () => {
    const { after } = play(table({ field: ["Swamp", "Swamp"], hand: ["Night's Whisper"] }));
    expect(after.sides.opp.hand).toHaveLength(2);
    expect(after.sides.opp.life).toBe(38);
    expect(play(table({ field: ["Swamp", "Swamp"], hand: ["Night's Whisper"], life: 11 })).names).toEqual([]);
  });
});

describe("the planner's mana", () => {
  it("a land that enters tapped pays for nothing the turn it's played", () => {
    const g = { ...table({ field: ["Swamp", "Swamp", "Swamp", "Swamp"], hand: ["Zagoth Triome", "Serra Angel"] }), landPlayed: false };
    g.sides.opp.battlefield = g.sides.opp.battlefield.map((c) => ({ ...c, name: "Plains", typeLine: "Basic Land — Plains" }));
    const { names } = play(g);
    // Four Plains and a tapped Triome: Serra Angel (5) waits. (It was
    // planned, and then couldn't be paid for.)
    expect(names).toEqual(["Zagoth Triome"]);
  });
});

