// Underworld Breach, with Scryfall's text (fixtures/field.json): a card of
// the graveyard cast again for its cost and three other cards exiled. And
// two things its lines showed about the planner: a rehearsal can't count on
// what comes off the library, and a wheel is the last thing cast.

import { describe, expect, it } from "vitest";
import { fallbackPlan } from "./ai";
import { turnBrief } from "./brief";
import { graveyardEscapeOf } from "./cards";
import type { DeckCombo } from "./combos";
import { applyAction, cardId, castable, escapable, escapeCost, newGame, type DeckCard } from "./game";
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
type Z = "battlefield" | "hand" | "graveyard" | "exile";
const at = (g: PracticeGame, name: string, zone: Z = "hand") => g.sides.opp[zone].find((c) => c.name === name);
const act = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const cast = (g: PracticeGame, name: string, zone: Z = "hand", combos: DeckCombo[] = []) => applyAction(g, "opp", act("cast", at(g, name, zone)!.iid), BOOK, { combos });
const said = (g: PracticeGame) => g.log.map((l) => l.text).join("\n");
const names = (g: PracticeGame, plan: { main: PlanAction[] }) =>
  plan.main.map((a) => (a.kind === "combo" ? `combo:${a.card}` : `${a.kind}:${[...g.sides.opp.hand, ...g.sides.opp.command, ...g.sides.opp.battlefield, ...g.sides.opp.graveyard].find((c) => cardId(c.iid) === a.card)?.name}`));
const combo = (id: string, pieces: [string, string][], produces: string[], manaNeeded = ""): DeckCombo => ({ id, pieces: pieces.map(([name, zones]) => ({ name, zones: zones.split("") })), produces, manaNeeded, steps: "", prerequisites: "" }) as DeckCombo;
const PETAL = combo("b", [["Underworld Breach", "B"], ["Lotus Petal", "B"], ["Brain Freeze", "HG"]], ["Infinite self-mill", "Near-infinite mill"]);

describe("escape", () => {
  it("is read from Underworld Breach", () => {
    expect(graveyardEscapeOf(of("Underworld Breach"))).toBe(3);
    expect(graveyardEscapeOf(of("Dark Ritual"))).toBe(0);
  });

  it("casts a card of the graveyard for its cost and three other cards exiled", () => {
    const g0 = table({ opp: { field: ["Underworld Breach", "Badlands"], grave: ["Dark Ritual", "Forest", "Forest", "Island", "Bear"] } });
    expect(escapeCost(g0, "opp", BOOK)).toBe(3);
    const ritual = at(g0, "Dark Ritual", "graveyard")!;
    expect(escapable(g0, "opp", ritual, BOOK)).toBe(true);
    expect(castable(g0, "opp", ritual, BOOK, "graveyard")).toBe(true);
    const g = cast(g0, "Dark Ritual", "graveyard").game;
    // The lands go first: the Bear stays.
    expect(said(g)).toMatch(/The opponent exiles (Forest|Island), (Forest|Island), (Forest|Island) from its graveyard: Dark Ritual escapes/);
    expect(said(g)).toMatch(/The opponent casts Dark Ritual from its graveyard/);
    expect(g.pool?.opp).toEqual(["B", "B", "B"]);
    // It goes back to the graveyard, with one other card: it can't escape again.
    const again = at(g, "Dark Ritual", "graveyard")!;
    expect(g.sides.opp.graveyard.map((c) => c.name).sort()).toEqual(["Bear", "Dark Ritual"]);
    expect(escapable(g, "opp", again, BOOK)).toBe(false);
    expect(applyAction(g, "opp", act("cast", again.iid), BOOK).ok).toBe(false);
  });

  it("the smart opponent is told what it can cast again, by id", () => {
    const g0 = table({ opp: { field: ["Underworld Breach", "Badlands"], grave: ["Dark Ritual", "Forest", "Forest", "Island", "Bear"] } });
    const brief = turnBrief(g0, BOOK, []);
    expect(brief).toMatch(/YOU CAN CAST FROM YOUR GRAVEYARD \(escape, while Underworld Breach is out/);
    expect(brief).toContain(`- ${cardId(at(g0, "Dark Ritual", "graveyard")!.iid)} Dark Ritual {B} (Instant)`);
    // Lands aren't offered, and with no Breach there is no such list.
    expect(brief).not.toContain(`${cardId(at(g0, "Forest", "graveyard")!.iid)} Forest`);
    const none = table({ opp: { field: ["Badlands"], grave: ["Dark Ritual", "Forest", "Forest", "Island"] } });
    expect(turnBrief(none, BOOK, [])).not.toMatch(/CAST FROM YOUR GRAVEYARD/);
  });

  it("needs Underworld Breach, and never casts a land", () => {
    const none = table({ opp: { field: ["Badlands"], grave: ["Dark Ritual", "Forest", "Forest", "Island"] } });
    expect(cast(none, "Dark Ritual", "graveyard").ok).toBe(false);
    const g0 = table({ opp: { field: ["Underworld Breach"], grave: ["Dark Ritual", "Forest", "Forest", "Island"] } });
    expect(escapable(g0, "opp", at(g0, "Forest", "graveyard")!, BOOK)).toBe(false);
  });

  it("keeps a piece of the combo and a storm spell: other cards are exiled first", () => {
    const g0 = table({ opp: { field: ["Underworld Breach", "Badlands"], grave: ["Dark Ritual", "Brain Freeze", "Lotus Petal", "Grapeshot", "Bear", "Forest", "Island"] } });
    const g = cast(g0, "Dark Ritual", "graveyard", [PETAL]).game;
    expect(g.sides.opp.exile.map((c) => c.name).sort()).toEqual(["Bear", "Forest", "Island"]);
  });
});

describe("the combo line with Underworld Breach", () => {
  it("casts the Breach, then a piece from the graveyard, and goes off", () => {
    const g0 = table({
      opp: { field: ["Badlands", "Volcanic Island", "Underground Sea", "Mountain"], hand: ["Underworld Breach", "Brain Freeze"], grave: ["Lotus Petal", "Forest", "Forest", "Island", "Bear"] },
    });
    const plan = names(g0, fallbackPlan(g0, BOOK, "opp", {}, [PETAL]));
    expect(plan).toEqual(["cast:Underworld Breach", "cast:Lotus Petal", "combo:b"]);
    // Played as planned: the player's library is gone.
    let g = g0;
    for (const a of fallbackPlan(g0, BOOK, "opp", {}, [PETAL]).main) g = applyAction(g, "opp", a, BOOK, { combos: [PETAL] }).game;
    expect(said(g)).toMatch(/Lotus Petal escapes/);
    expect(g.sides.you.library).toHaveLength(0);
  });

  it("casts a tutor from the graveyard for the piece it lacks", () => {
    const g0 = table({
      opp: { field: ["Underworld Breach", "Lotus Petal", "Badlands", "Volcanic Island", "Underground Sea", "Mountain"], grave: ["Demonic Tutor", "Forest", "Forest", "Island"], top: ["Swamp", "Brain Freeze"] },
    });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [PETAL]);
    expect(names(g0, plan)[0]).toBe("cast:Demonic Tutor");
    expect(plan.main[0]!.effects[0]).toMatchObject({ type: "search", name: "Brain Freeze" });
    expect(plan.main.at(-1)!.kind).toBe("combo");
  });

  it("with too few cards to exile, the piece stays where it is", () => {
    const g0 = table({ opp: { field: ["Badlands", "Volcanic Island", "Underground Sea", "Mountain"], hand: ["Underworld Breach", "Brain Freeze"], grave: ["Lotus Petal", "Forest"] } });
    expect(fallbackPlan(g0, BOOK, "opp", {}, [PETAL]).main.some((a) => a.kind === "combo")).toBe(false);
  });
});

describe("a rehearsal doesn't count on what comes off the library", () => {
  it("Twisted Image is cast for its card, and the card isn't in the plan", () => {
    // Rhystic Study is the next card. A plan that cast it would have looked.
    const g0 = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Mountain"], hand: ["Twisted Image"], top: ["Rhystic Study"] } });
    expect(names(g0, fallbackPlan(g0, BOOK))).toEqual(["cast:Twisted Image"]);
    // A pump that draws nothing, with nothing to spend its mana on, is kept.
    const idle = table({ opp: { field: ["Vivi Ornitier", "Island", "Island", "Mountain"], hand: ["Wild Ride"], top: ["Rhystic Study"] } });
    expect(names(idle, fallbackPlan(idle, BOOK))).toEqual([]);
  });
});

describe("a wheel", () => {
  it("is paid for in its turn and cast last: what's cast before it isn't shuffled away", () => {
    const g0 = table({ opp: { field: ["Volcanic Island", "Island", "Mountain", "Forest", "Forest"], hand: ["Timetwister", "Bear"] } });
    expect(names(g0, fallbackPlan(g0, BOOK))).toEqual(["cast:Bear", "cast:Timetwister"]);
  });
});
