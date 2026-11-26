// Vivi Ornitier's deck, with Scryfall's text (fixtures/field.json): its mana
// is its power, once a turn, so a spell that makes it bigger is mana, and
// every spell is a hit that Curiosity turns into a card.

import { describe, expect, it } from "vitest";
import { fallbackPlan } from "./ai";
import { stats } from "./cards";
import type { DeckCombo } from "./combos";
import { applyAction, availableMana, cardId, declareAttackers, newGame, resolveCombat, type DeckCard } from "./game";
import { manaTotal } from "./mana";
import { pumpSpellOf } from "./spells";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";
import CARDS from "./fixtures/field.json";

const keep = <T,>(a: T[]) => [...a];
const info = (name: string, o: Partial<CardInfo> = {}): CardInfo => ({ name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o });
const BOOK: CardBook = Object.fromEntries(
  [
    ...(CARDS as CardInfo[]).map((c) => info(c.name, c)),
    info("Bear", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2, typeLine: "Creature — Bear" }),
    info("Goblin", { manaCost: "{R}", manaValue: 1, power: 1, toughness: 1, typeLine: "Creature — Goblin" }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const of = (name: string) => BOOK[name.toLowerCase()]!;
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: of(name).typeLine }));

type Zones = { field?: string[]; hand?: string[]; top?: string[]; command?: string[] };
/** The opponent's turn 5, laid out by hand. Its library is Swamps under `top`. */
function table(o: { opp?: Zones; you?: Zones }): PracticeGame {
  const all = (z?: Zones) => [...(z?.field ?? []), ...(z?.hand ?? []), ...(z?.top ?? [])];
  const g = newGame({
    you: { cards: deck(...all(o.you), ...Array(20).fill("Island")) },
    opp: { cards: deck(...all(o.opp), ...(o.opp?.command ?? []), ...Array(20).fill("Swamp")), commander: o.opp?.command?.join(" + ") ?? null },
    commanderGame: true,
    first: "opp",
    shuffle: keep,
  });
  for (const seat of ["you", "opp"] as const) {
    const z = o[seat];
    const pool = [...g.sides[seat].hand, ...g.sides[seat].library];
    const take = (n: string) => pool.splice(pool.findIndex((c) => c.name === n), 1)[0]!;
    const field = (z?.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
    const hand = (z?.hand ?? []).map(take);
    const top = (z?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, library: [...top, ...pool] };
  }
  return { ...g, turn: 5, active: "opp", landPlayed: true };
}
const at = (g: PracticeGame, name: string, zone: "battlefield" | "hand" | "graveyard" | "command" | "exile" = "hand") => g.sides.opp[zone].find((c) => c.name === name);
const act = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const pumpOn = (iid: number) => ({ type: "pump" as const, target: cardId(iid), player: null, amount: null, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null });
const cast = (g: PracticeGame, name: string, o: Partial<PlanAction> = {}) => applyAction(g, "opp", act("cast", (at(g, name) ?? at(g, name, "command"))!.iid, o), BOOK);
const said = (g: PracticeGame) => g.log.map((l) => l.text).join("\n");
const names = (g: PracticeGame, plan: { main: PlanAction[] }) =>
  plan.main.map((a) => (a.kind === "combo" ? `combo:${a.card}` : `${a.kind}:${[...g.sides.opp.hand, ...g.sides.opp.command, ...g.sides.opp.battlefield].find((c) => cardId(c.iid) === a.card)?.name}`));
const vivi = (g: PracticeGame) => at(g, "Vivi Ornitier", "battlefield")!;
const size = (g: PracticeGame) => stats(BOOK, vivi(g));
/** Vivi with counters already on it. */
const grown = (g: PracticeGame, counters: number): PracticeGame => ({ ...g, sides: { ...g.sides, opp: { ...g.sides.opp, battlefield: g.sides.opp.battlefield.map((c) => (c.name === "Vivi Ornitier" ? { ...c, counters } : c)) } } });

describe("spells that make one creature bigger", () => {
  it("are read from their text", () => {
    expect(pumpSpellOf(of("Wild Ride"))).toMatchObject({ power: 3, toughness: 0, keywords: ["haste"], draw: 0 });
    expect(pumpSpellOf(of("Crowd's Favor"))).toMatchObject({ power: 1, toughness: 0, keywords: ["first strike"] });
    expect(pumpSpellOf(of("Twisted Image"))).toMatchObject({ power: "switch", draw: 1 });
    expect(pumpSpellOf(of("Blazing Shoal"))).toMatchObject({ power: "x", pitch: "R" });
    // One mode of a "Choose one —" spell.
    expect(pumpSpellOf(of("Secret Identity"))).toMatchObject({ base: { power: 3, toughness: 4 }, keywords: ["flying", "vigilance"], modal: true });
    expect(pumpSpellOf(of("Siege Smash"))).toMatchObject({ power: 3, toughness: 2, keywords: ["trample"], modal: true });
    expect(pumpSpellOf(of("Opera Love Song"))).toMatchObject({ power: 2, modal: true });
    // -3/-0 is no pump, and neither is a spell that does anything else.
    expect(pumpSpellOf(of("Dizzy Spell"))).toBeNull();
    expect(pumpSpellOf(of("Pyrokinesis"))).toBeNull();
    expect(pumpSpellOf(of("Curiosity"))).toBeNull();
  });

  it("Wild Ride goes on Vivi, and something else pays for it: Vivi's mana is its power once the spell resolves", () => {
    const g0 = grown(table({ opp: { field: ["Vivi Ornitier", "Mountain"], hand: ["Wild Ride"] } }), 2);
    // Vivi is 2/5: two mana of its own, and the Mountain.
    expect(manaTotal(availableMana(g0, "opp", BOOK))).toBe(3);
    const g = cast(g0, "Wild Ride").game;
    expect(said(g)).toMatch(/The opponent casts Wild Ride on Vivi Ornitier/);
    expect(at(g, "Mountain", "battlefield")).toMatchObject({ tapped: true });
    // A counter for the cast, then +3/+0.
    expect(size(g)).toEqual({ power: 6, toughness: 6 });
    expect(said(g)).toMatch(/Wild Ride: Vivi Ornitier is 6\/6 until end of turn/);
    expect(manaTotal(availableMana(g, "opp", BOOK))).toBe(6);
    // With no creature it can't be cast.
    const none = table({ opp: { field: ["Mountain"], hand: ["Wild Ride"] } });
    expect(cast(none, "Wild Ride").ok).toBe(false);
  });

  it("Twisted Image switches after everything else, and draws", () => {
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island", "Mountain"], hand: ["Twisted Image", "Wild Ride"], top: ["Bear"] } });
    const g = cast(g0, "Twisted Image").game;
    // 0/3 with the cast's counter is 1/4: switched, 4/1.
    expect(size(g)).toEqual({ power: 4, toughness: 1 });
    expect(at(g, "Bear")).toBeDefined();
    // Wild Ride after it: another counter and +3/+0 make 5/5, and the switch changes nothing.
    expect(size(cast(g, "Wild Ride").game)).toEqual({ power: 5, toughness: 5 });
  });

  it("Blazing Shoal is paid for with a red card from the hand, X its mana value", () => {
    const g0 = table({ opp: { field: ["Vivi Ornitier"], hand: ["Blazing Shoal", "Pyrokinesis", "Goblin"] } });
    const g = cast(g0, "Blazing Shoal").game;
    expect(said(g)).toMatch(/The opponent exiles Pyrokinesis from its hand to pay for Blazing Shoal/);
    expect(said(g)).toMatch(/casts Blazing Shoal \(X = 6\) on Vivi Ornitier/);
    expect(at(g, "Pyrokinesis", "exile")).toBeDefined();
    expect(size(g)).toEqual({ power: 7, toughness: 4 });
    // A one-drop isn't worth two cards: with only that, it needs its mana.
    const poor = table({ opp: { field: ["Vivi Ornitier"], hand: ["Blazing Shoal", "Goblin"] } });
    expect(cast(poor, "Blazing Shoal").ok).toBe(false);
  });

  it("Secret Identity is a pump only when the plan says so", () => {
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island"], hand: ["Secret Identity"] } });
    expect(size(cast(g0, "Secret Identity").game)).toEqual({ power: 1, toughness: 4 });
    const g = cast(g0, "Secret Identity", { effects: [pumpOn(vivi(g0).iid)] }).game;
    // A 3/4 with the cast's counter.
    expect(size(g)).toEqual({ power: 4, toughness: 5 });
  });
});

describe("the planner's turn with Vivi", () => {
  it("pumps first when that pays for more, and keeps the pump when it doesn't", () => {
    // Three lands and Niv-Mizzet (six mana): Wild Ride makes Vivi's four.
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Mountain"], hand: ["Wild Ride", "Niv-Mizzet, Visionary"] } });
    expect(names(g0, fallbackPlan(g0, BOOK))).toEqual(["cast:Wild Ride", "cast:Niv-Mizzet, Visionary"]);
    // Nothing to spend it on: the pump stays in hand.
    const idle = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Mountain"], hand: ["Wild Ride"] } });
    expect(names(idle, fallbackPlan(idle, BOOK))).toEqual([]);
    // The plan is played as planned.
    let g = g0;
    for (const a of fallbackPlan(g0, BOOK).main) g = applyAction(g, "opp", a, BOOK).game;
    expect(at(g, "Niv-Mizzet, Visionary", "battlefield")).toBeDefined();
  });

  it("casts Vivi and pumps it the same turn: its ability needs no tap", () => {
    const g0 = table({ opp: { field: ["Island", "Island", "Mountain", "Mountain"], hand: ["Wild Ride", "Rhystic Study"], command: ["Vivi Ornitier"] } });
    const plan = names(g0, fallbackPlan(g0, BOOK));
    expect(plan.slice(0, 2)).toEqual(["cast:Vivi Ornitier", "cast:Wild Ride"]);
    expect(plan).toContain("cast:Rhystic Study");
  });

  it("a switch isn't cast on top of a +3/+0: it would add only its counter", () => {
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Mountain"], hand: ["Wild Ride", "Twisted Image", "Niv-Mizzet, Visionary"] } });
    const plan = names(g0, fallbackPlan(g0, BOOK));
    expect(plan.filter((n) => n === "cast:Wild Ride" || n === "cast:Twisted Image")).toHaveLength(1);
    expect(plan).toContain("cast:Niv-Mizzet, Visionary");
  });
});

describe("cards for a hit", () => {
  it("Curiosity and Ophidian Eye on Vivi draw for every spell, and for combat damage", () => {
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Island", "Island"], hand: ["Curiosity", "Ophidian Eye", "Sol Ring"], top: ["Bear", "Goblin", "Bear", "Goblin"] } });
    const one = cast(g0, "Curiosity").game;
    expect(said(one)).toMatch(/Curiosity goes on Vivi Ornitier/);
    // Curiosity's own cast was a hit before it was on.
    expect(one.sides.opp.hand).toHaveLength(2);
    const two = cast(one, "Ophidian Eye").game;
    expect(said(two)).toMatch(/The opponent draws a card \(Curiosity\)/);
    const three = cast(two, "Sol Ring").game;
    expect(said(three)).toMatch(/The opponent draws 2 cards \(Curiosity, Ophidian Eye\)/);
    // In combat too.
    const before = three.sides.opp.hand.length;
    const hit = resolveCombat(declareAttackers(three, "opp", [vivi(three).iid], BOOK), BOOK);
    expect(hit.sides.opp.hand.length).toBe(before + 2);
  });

  it("Tandem Lookout pairs with Vivi; Niv-Mizzet draws for damage outside combat; Thor gives a card to play", () => {
    const lookout = table({ opp: { field: ["Vivi Ornitier", "Tandem Lookout", "Island"], hand: ["Sol Ring"], top: ["Bear"] } });
    expect(said(cast(lookout, "Sol Ring").game)).toMatch(/The opponent draws a card \(Tandem Lookout\)/);
    const niv = table({ opp: { field: ["Vivi Ornitier", "Niv-Mizzet, Visionary", "Island"], hand: ["Sol Ring"], top: ["Bear"] } });
    const g = cast(niv, "Sol Ring").game;
    expect(said(g)).toMatch(/The opponent draws a card \(Niv-Mizzet, Visionary\)/);
    // Combat damage isn't Niv-Mizzet's.
    const cards = g.sides.opp.hand.length;
    expect(resolveCombat(declareAttackers(g, "opp", [vivi(g).iid], BOOK), BOOK).sides.opp.hand.length).toBe(cards);
    const thor = table({ opp: { field: ["Vivi Ornitier", "Thor, Guardian of Midgard", "Island"], hand: ["Sol Ring"], top: ["Bear"] } });
    const t = cast(thor, "Sol Ring").game;
    expect(said(t)).toMatch(/Thor, Guardian of Midgard: the opponent exiles the top card of its library, and may play it this turn/);
    expect(at(t, "Bear")).toMatchObject({ fleeting: true });
  });
});

describe("endless mana with nothing to spend it on", () => {
  const loop = { id: "vq", pieces: [{ name: "Vivi Ornitier", zones: ["B"] }, { name: "Quicksilver Elemental", zones: ["B"] }], produces: ["Infinite red mana", "Infinite blue mana"], manaNeeded: "{U}", steps: "", prerequisites: "" } as DeckCombo;
  it("isn't announced; with a spell to cast, it is", () => {
    const empty = table({ opp: { field: ["Vivi Ornitier", "Quicksilver Elemental", "Island"] } });
    expect(names(empty, fallbackPlan(empty, BOOK, "opp", {}, [loop]))).toEqual([]);
    const full = table({ opp: { field: ["Vivi Ornitier", "Quicksilver Elemental", "Island"], hand: ["Niv-Mizzet, Visionary"] } });
    expect(names(full, fallbackPlan(full, BOOK, "opp", {}, [loop]))).toEqual(["combo:vq", "cast:Niv-Mizzet, Visionary"]);
  });
});
