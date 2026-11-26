// A storm deck's spells, with Scryfall's text (fixtures/field.json): the
// cheap red card draw (a card discarded for two, two cards exiled to play),
// and loops that end the game through something else: a storm spell copied
// for every spell of the loop, or a permanent that hurts with each one.

import { describe, expect, it, vi } from "vitest";
import { fallbackPlan, winningTurn } from "./ai";
import { reachesLibrary, type DeckCombo } from "./combos";
import { applyAction, cardId, endTurn, loopPayoff, newGame, startTurn, type DeckCard } from "./game";
import { drawSpellOf, lootOf } from "./spells";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";
import CARDS from "./fixtures/field.json";

const keep = <T,>(a: T[]) => [...a];
const info = (name: string, o: Partial<CardInfo> = {}): CardInfo => ({ name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o });
const BOOK: CardBook = Object.fromEntries(
  [
    ...(CARDS as CardInfo[]).map((c) => info(c.name, c)),
    info("Bear", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2, typeLine: "Creature — Bear" }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const of = (name: string) => BOOK[name.toLowerCase()]!;
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: of(name).typeLine }));

type Zones = { field?: string[]; hand?: string[]; top?: string[]; grave?: string[] };
/** The opponent's turn 5, laid out by hand. Its library is Swamps under `top`. */
function table(o: { opp?: Zones; you?: Zones }): PracticeGame {
  const all = (z?: Zones) => [...(z?.field ?? []), ...(z?.hand ?? []), ...(z?.top ?? []), ...(z?.grave ?? [])];
  const g = newGame({
    you: { cards: deck(...all(o.you), ...Array(20).fill("Island")) },
    opp: { cards: deck(...all(o.opp), ...Array(20).fill("Swamp")), commander: null },
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
    const graveyard = (z?.grave ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, graveyard, library: [...top, ...pool] };
  }
  return { ...g, turn: 5, active: "opp", landPlayed: true };
}
const at = (g: PracticeGame, name: string, zone: "battlefield" | "hand" | "graveyard" | "exile" = "hand") => g.sides.opp[zone].find((c) => c.name === name);
const act = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const cast = (g: PracticeGame, name: string, o: Partial<PlanAction> = {}, combos: DeckCombo[] = []) => applyAction(g, "opp", act("cast", at(g, name)!.iid, o), BOOK, { combos });
const said = (g: PracticeGame) => g.log.map((l) => l.text).join("\n");
const names = (g: PracticeGame, plan: { main: PlanAction[] }) =>
  plan.main.map((a) => (a.kind === "combo" ? `combo:${a.card}` : `${a.kind}:${[...g.sides.opp.hand, ...g.sides.opp.command, ...g.sides.opp.battlefield].find((c) => cardId(c.iid) === a.card)?.name}`));
const combo = (id: string, pieces: [string, string][], produces: string[], manaNeeded = ""): DeckCombo => ({ id, pieces: pieces.map(([name, zones]) => ({ name, zones: zones.split("") })), produces, manaNeeded, steps: "", prerequisites: "" }) as DeckCombo;
const draw = (n: number) => ({ type: "draw" as const, target: null, player: null, amount: n, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null });

describe("a card for two cards", () => {
  it("is read from the text", () => {
    for (const n of ["Abandon Attachments", "Vision of Love", "Highway Robbery", "Demand Answers", "Romantic Rendezvous"]) expect(drawSpellOf(of(n)), n).toMatchObject({ draw: 2, discard: 1, discardFirst: true });
    expect(drawSpellOf(of("Frantic Search"))).toMatchObject({ draw: 2, discard: 2, discardFirst: false, untap: 3 });
    expect(drawSpellOf(of("Twinned Vision"))).toMatchObject({ draw: 1 });
    expect(drawSpellOf(of("Energybending"))).toMatchObject({ draw: 1 });
    for (const n of ["Reckless Impulse", "Wrenn's Resolve"]) expect(drawSpellOf(of(n)), n).toEqual({ draw: 0, lose: 0, impulse: 2 });
    // Rob the Archives: this turn only.
    expect(drawSpellOf(of("Rob the Archives"))).toMatchObject({ impulse: 2, impulseNow: true });
    // The table carries these out itself.
    expect(lootOf(of("Romantic Rendezvous"))).not.toBeNull();
    expect(lootOf(of("Twinned Vision"))).toBeNull();
    // Not one it knows: the hand exiled and drawn again.
    expect(drawSpellOf(of("Hex Magic"))).toBeNull();
  });

  it("Romantic Rendezvous discards one and draws two, once, whatever the plan says", () => {
    const g0 = table({ opp: { field: ["Mountain", "Mountain"], hand: ["Romantic Rendezvous", "Forest", "Island"], top: ["Bear", "Bear"] } });
    const g = cast(g0, "Romantic Rendezvous", { effects: [draw(2)] }).game;
    expect(said(g)).toMatch(/Romantic Rendezvous: the opponent discards (Forest|Island)\./i);
    // Two lands and the spell were the hand: one land left, and the two Bears.
    expect(g.sides.opp.hand.map((c) => c.name).filter((n) => n === "Bear")).toHaveLength(2);
    expect(g.sides.opp.hand).toHaveLength(3);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toContain("Romantic Rendezvous");
  });

  it("with no card to discard, Abandon Attachments draws nothing, and the planner doesn't cast it", () => {
    const g0 = table({ opp: { field: ["Mountain", "Island"], hand: ["Abandon Attachments"], top: ["Bear", "Bear"] } });
    expect(cast(g0, "Abandon Attachments").game.sides.opp.hand).toHaveLength(0);
    expect(names(g0, fallbackPlan(g0, BOOK))).toEqual([]);
    const withCard = table({ opp: { field: ["Mountain", "Island"], hand: ["Abandon Attachments", "Forest"], top: ["Bear", "Bear"] } });
    expect(names(withCard, fallbackPlan(withCard, BOOK))).toEqual(["cast:Abandon Attachments"]);
  });

  it("a discard keeps a piece of the deck's combo", () => {
    const breach = combo("b", [["Underworld Breach", "B"], ["Lion's Eye Diamond", "B"], ["Brain Freeze", "G"]], ["Near-infinite mill"]);
    const g0 = table({ opp: { field: ["Mountain", "Mountain"], hand: ["Demand Answers", "Underworld Breach", "Bear"], top: ["Swamp", "Swamp"] } });
    const g = cast(g0, "Demand Answers", {}, [breach]).game;
    expect(said(g)).toMatch(/Demand Answers: the opponent discards Bear/i);
    expect(at(g, "Underworld Breach")).toBeDefined();
  });

  it("Frantic Search draws two, discards two, and untaps three lands", () => {
    const g0 = table({ opp: { field: ["Island", "Island", "Mountain"], hand: ["Frantic Search", "Forest"], top: ["Bear", "Bear"] } });
    const g = cast(g0, "Frantic Search").game;
    expect(g.sides.opp.hand).toHaveLength(1);
    expect(g.sides.opp.battlefield.filter((c) => c.tapped)).toHaveLength(0);
    expect(said(g)).toMatch(/Frantic Search: the opponent untaps /i);
  });

  it("Reckless Impulse's two cards are the opponent's to play until the end of its next turn", () => {
    const g0 = table({ opp: { field: ["Mountain", "Mountain"], hand: ["Reckless Impulse"], top: ["Bear", "Sol Ring"] } });
    const g = cast(g0, "Reckless Impulse").game;
    expect(said(g)).toMatch(/Reckless Impulse: the opponent exiles the top 2 cards of its library, and may play them until the end of its next turn/);
    expect(at(g, "Bear")).toMatchObject({ fleeting: true, fleetingUntil: 7 });
    // Still there after this turn and the player's.
    let t = startTurn(endTurn(g, BOOK), BOOK);
    expect(at(t, "Bear")).toBeDefined();
    t = startTurn(endTurn(t, BOOK), BOOK);
    expect(at(t, "Sol Ring")).toBeDefined();
    // Gone at the end of its next turn, unplayed.
    t = endTurn(t, BOOK);
    expect(at(t, "Bear")).toBeUndefined();
    expect(at(t, "Bear", "exile")).toBeDefined();
    expect(said(t)).toMatch(/stay in exile: not played in time/);
  });
});

describe("a loop that ends the game through something else", () => {
  const loop = combo("r", [["Reiterate", "H"], ["Seething Song", "H"], ["Bonus Round", "H"]], ["Infinite magecraft triggers", "Infinite red mana", "Infinite storm count"], "{4}{R}{R}{R}");
  const lands = Array(7).fill("Mountain");

  it("Grapeshot in hand, copied for every spell: a win", () => {
    const g0 = table({ opp: { field: lands, hand: ["Reiterate", "Seething Song", "Bonus Round", "Grapeshot"] } });
    expect(loopPayoff(g0, "opp", loop, BOOK)).toMatchObject({ kind: "win", how: "storm" });
    const g = applyAction(g0, "opp", { ...act("cast", 0), kind: "combo", card: "r" }, BOOK, { combos: [loop] }).game;
    expect(said(g)).toMatch(/Grapeshot, copied for every spell of the loop, ends it\. The opponent wins/);
    expect(g.winner).toBe("opp");
    // The planner takes it.
    expect(winningTurn(g0, BOOK, "opp", [loop])).not.toBeNull();
  });

  it("Brain Freeze: the player's library", () => {
    const g0 = table({ opp: { field: lands, hand: ["Reiterate", "Seething Song", "Bonus Round", "Brain Freeze"] } });
    const g = applyAction(g0, "opp", { ...act("cast", 0), kind: "combo", card: "r" }, BOOK, { combos: [loop] }).game;
    expect(said(g)).toMatch(/Brain Freeze, copied for every spell of the loop, puts your whole library into the graveyard/);
    expect(g.sides.you.library).toHaveLength(0);
  });

  it("with neither, it is only mana; with Gandalf out, every spell is a hit", () => {
    const bare = table({ opp: { field: lands, hand: ["Reiterate", "Seething Song", "Bonus Round"] } });
    expect(loopPayoff(bare, "opp", loop, BOOK)).toBeNull();
    expect(applyAction(bare, "opp", { ...act("cast", 0), kind: "combo", card: "r" }, BOOK, { combos: [loop] }).game.winner).toBeNull();
    const gandalf = table({ opp: { field: [...lands, "Gandalf, Goblins' Bane // Flameshape"], hand: ["Reiterate", "Seething Song", "Bonus Round"] } });
    const g = applyAction(gandalf, "opp", { ...act("cast", 0), kind: "combo", card: "r" }, BOOK, { combos: [loop] }).game;
    expect(said(g)).toMatch(/Every spell of the loop is a hit from Gandalf, Goblins' Bane/);
    expect(g.winner).toBe("opp");
  });

  it("a loop with no mana of its own counts too, and one that reaches the library finds its storm spell there", () => {
    // "Infinite magecraft triggers; Infinite storm count" alone was a combo the table left to the player.
    const dry = combo("d", [["Reiterate", "H"], ["Seething Song", "H"], ["Bonus Round", "H"]], ["Infinite magecraft triggers", "Infinite storm count"], "{4}{R}{R}{R}");
    const g0 = table({ opp: { field: lands, hand: ["Reiterate", "Seething Song", "Bonus Round", "Grapeshot"] } });
    expect(winningTurn(g0, BOOK, "opp", [dry])).not.toBeNull();
    expect(reachesLibrary(["Infinite draw triggers", "Infinite looting"])).toBe(true);
    expect(reachesLibrary(["Infinite looting for opponents"])).toBe(false);
    expect(reachesLibrary(["Exile your library with the ability to play the exiled cards until end of turn"])).toBe(true);
    const looting = combo("l", [["Frantic Search", "H"], ["Underworld Breach", "B"], ["Bonus Round", "H"]], ["Infinite draw triggers", "Infinite looting", "Near-infinite mana lands you control can produce"]);
    // Grapeshot somewhere in the library.
    const far = table({ opp: { field: [...lands, "Underworld Breach"], hand: ["Frantic Search", "Bonus Round"], top: ["Swamp", "Swamp", "Swamp", "Grapeshot"] } });
    expect(loopPayoff(far, "opp", looting, BOOK)).toMatchObject({ kind: "win", how: "storm" });
    // A loop that only casts needs it in hand.
    const away = table({ opp: { field: lands, hand: ["Reiterate", "Seething Song", "Bonus Round"], top: ["Grapeshot"] } });
    expect(loopPayoff(away, "opp", loop, BOOK)).toBeNull();
  });
});

describe("Gamble for a combo piece", () => {
  it("is cast for a piece the combo also takes from the graveyard, never for another", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const breach = combo("b", [["Underworld Breach", "B"], ["Lion's Eye Diamond", "B"], ["Brain Freeze", "HG"]], ["Near-infinite mill"]);
    const g0 = table({ opp: { field: ["Mountain", "Mountain", "Volcanic Island", "Underworld Breach", "Lion's Eye Diamond"], hand: ["Gamble"], top: ["Swamp", "Brain Freeze"] } });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [breach]);
    expect(names(g0, plan)[0]).toBe("cast:Gamble");
    expect(plan.main[0]!.effects[0]).toMatchObject({ type: "search", name: "Brain Freeze" });
    // The Diamond has to be on the battlefield: Gamble could throw it away.
    const needsDiamond = table({ opp: { field: ["Mountain", "Mountain", "Volcanic Island", "Underworld Breach"], hand: ["Gamble", "Brain Freeze"], top: ["Swamp", "Lion's Eye Diamond"] } });
    const other = fallbackPlan(needsDiamond, BOOK, "opp", {}, [breach]);
    expect(other.main.some((a) => a.kind === "combo")).toBe(false);
    vi.restoreAllMocks();
  });
});
