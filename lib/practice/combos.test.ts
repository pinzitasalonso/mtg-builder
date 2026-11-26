import { describe, expect, it } from "vitest";
import { normalizeCombos } from "../combos";
import { fallbackPlan, simpleTurn, winningTurn } from "./ai";
import { cleanPlan, comboBrief, systemPrompt } from "./brief";
import { asCombos, comboOutcome, deckCombos, type DeckCombo } from "./combos";
import { applyAction, applyCombo, cardId, comboStatus, moveAnyCard, newGame, type DeckCard } from "./game";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const BOOK: CardBook = Object.fromEntries(
  [
    info("Mountain", { typeLine: "Basic Land — Mountain", producedMana: ["R"] }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
    info("Forest", { typeLine: "Basic Land — Forest", producedMana: ["G"] }),
    info("Mirror Goblin", { typeLine: "Legendary Creature — Goblin Shaman", manaCost: "{2}{R}{R}{R}", manaValue: 5, power: 2, toughness: 2, keywords: ["Haste"], oracleText: "Haste\n{T}: Create a token that's a copy of target nonlegendary creature you control." }),
    info("Untapper", { typeLine: "Creature — Human Warrior", manaCost: "{4}{R}", manaValue: 5, power: 3, toughness: 3, keywords: ["Haste"], oracleText: "Haste\nWhen this creature enters, untap target permanent." }),
    info("Stone Loop", { typeLine: "Artifact", manaCost: "{3}", manaValue: 3, oracleText: "{T}: Add {C}{C}{C}." }),
    info("Loop Ring", { typeLine: "Artifact", manaCost: "{3}", manaValue: 3, oracleText: "Copy an ability." }),
    info("Dark Tutor", { typeLine: "Sorcery", manaCost: "{1}{B}", manaValue: 2, oracleText: "Search your library for a card, put that card into your hand, then shuffle." }),
    info("Big Beast", { manaCost: "{3}{R}", manaValue: 4, power: 6, toughness: 6 }),
    info("Bear", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));

function table(o: { opp?: { field?: string[]; hand?: string[]; top?: string[] }; you?: { field?: string[] } }): PracticeGame {
  const names = (x?: { field?: string[]; hand?: string[]; top?: string[] }) => [...(x?.field ?? []), ...(x?.hand ?? []), ...(x?.top ?? [])];
  const g = newGame({ you: { cards: deck(...names(o.you), ...Array(12).fill("Forest")) }, opp: { cards: deck(...names(o.opp), ...Array(12).fill("Mountain")) }, commanderGame: true, first: "opp", shuffle: keep });
  for (const seat of ["you", "opp"] as const) {
    const x = o[seat] as { field?: string[]; hand?: string[]; top?: string[] } | undefined;
    const all = [...g.sides[seat].hand, ...g.sides[seat].library];
    const take = (n: string) => all.splice(all.findIndex((c) => c.name === n), 1)[0]!;
    const field = (x?.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
    const hand = (x?.hand ?? []).map(take);
    const top = (x?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, library: [...top, ...all], life: 40 };
  }
  return { ...g, turn: 3, active: "opp" };
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "graveyard" | "library" = "battlefield") => g.sides[seat][zone].find((c) => c.name === name)!;

// Kiki-Jiki and Zealous Conscripts, as Spellbook gives them: both on the battlefield.
const HASTE: DeckCombo = {
  id: "100-200",
  pieces: [
    { name: "Mirror Goblin", zones: ["B"] },
    { name: "Untapper", zones: ["B"] },
  ],
  produces: ["Infinite creature tokens with haste", "Infinite creature ETB"],
  manaNeeded: "",
  steps: "Activate Mirror Goblin by tapping it, targeting Untapper.\nThe token untaps Mirror Goblin.\nRepeat.",
  prerequisites: "",
};
const MANA: DeckCombo = { id: "300-400", pieces: [{ name: "Loop Ring", zones: ["B"] }, { name: "Stone Loop", zones: ["B"] }], produces: ["Infinite colorless mana"], manaNeeded: "{2}", steps: "Tap Stone Loop for mana. Copy its untap.", prerequisites: "" };
const comboAction = (id: string): PlanAction => ({ kind: "combo", card: id, x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [] });

describe("what Spellbook says of a combo", () => {
  it("keeps where each piece has to be, and what else it asks", () => {
    const { combos } = normalizeCombos({
      results: {
        included: [
          { id: "1-2", uses: [{ card: { name: "A" }, zoneLocations: ["B"] }, { card: { name: "B" }, zoneLocations: ["H", "x"] }], produces: [{ feature: { name: "Win the game" } }], manaNeeded: "{U}", description: "Do it.", easyPrerequisites: "A is untapped.", notablePrerequisites: "" },
        ],
      },
    });
    expect(combos[0]).toMatchObject({ zones: { A: ["B"], B: ["H"] }, prerequisites: "A is untapped." });
  });

  it("is a win, a mill, mana, or something the table only says", () => {
    expect(comboOutcome(["Infinite creature ETB", "Win the game"])).toBe("win");
    expect(comboOutcome(["Infinite damage"])).toBe("win");
    expect(comboOutcome(["Infinite creature tokens with haste"])).toBe("win");
    expect(comboOutcome(["Near-infinite mill", "Infinite self-mill"])).toBe("mill");
    expect(comboOutcome(["Infinite self-mill"])).toBe("other");
    expect(comboOutcome(["Infinite colorless mana"])).toBe("mana");
    expect(comboOutcome(["Infinite lifegain"])).toBe("other");
  });

  it("the ones that end the game come first, and a stored list is read back with a combo's shape", () => {
    const lines = [
      { id: "m", pieces: ["Loop Ring", "Stone Loop"], produces: ["Infinite colorless mana"], manaNeeded: "{2}", steps: "", zones: { "Loop Ring": ["B"], "Stone Loop": ["B"] } },
      { id: "w", pieces: ["Mirror Goblin", "Untapper"], produces: ["Infinite creature tokens with haste"], manaNeeded: "", steps: "" },
    ];
    const combos = deckCombos(lines);
    expect(combos.map((c) => c.id)).toEqual(["w", "m"]);
    // With no zones from Spellbook, a piece is taken to belong on the battlefield.
    expect(combos[0]!.pieces[0]).toEqual({ name: "Mirror Goblin", zones: ["B"] });
    expect(asCombos(JSON.parse(JSON.stringify(combos)))).toEqual(combos);
    expect(asCombos([{ nope: true }, null, "x"])).toEqual([]);
  });
});

describe("a combo at the table", () => {
  it("is ready with every piece in place; says what to cast, and what's missing and where", () => {
    const both = table({ opp: { field: ["Mirror Goblin", "Untapper"] } });
    expect(comboStatus(both, "opp", HASTE, BOOK)).toMatchObject({ ready: true, toCast: [], missing: [] });
    const one = table({ opp: { field: ["Mirror Goblin"], hand: ["Untapper"] } });
    expect(comboStatus(one, "opp", HASTE, BOOK)).toMatchObject({ ready: false, toCast: [{ name: "Untapper" }] });
    const none = table({ opp: { field: ["Mirror Goblin"], top: ["Untapper"] } });
    expect(comboStatus(none, "opp", HASTE, BOOK)).toMatchObject({ ready: false, missing: [{ name: "Untapper", where: "library" }] });
    // Its mana has to be there.
    const poor = table({ opp: { field: ["Loop Ring", "Stone Loop"] } });
    const tapped = { ...poor, sides: { ...poor.sides, opp: { ...poor.sides.opp, battlefield: poor.sides.opp.battlefield.map((c) => ({ ...c, tapped: true })) } } };
    expect(comboStatus(tapped, "opp", MANA, BOOK)).toMatchObject({ ready: false });
    expect(comboStatus(tapped, "opp", MANA, BOOK).blocked).toMatch(/needs \{2\}/);
  });

  it("wins when it goes off, and stops for your answer in between", () => {
    const g0 = table({ opp: { field: ["Mirror Goblin", "Untapper"] } });
    // Announced: nothing has happened yet.
    const paid = applyAction(g0, "opp", comboAction("100-200"), BOOK, { stage: "pay", combos: [HASTE] });
    expect(paid.ok).toBe(true);
    expect(paid.game.winner).toBeFalsy();
    expect(paid.game.log.map((l) => l.text).join(" ")).toMatch(/goes for a combo: Mirror Goblin \+ Untapper/);
    // You let it happen.
    const won = applyAction(paid.game, "opp", comboAction("100-200"), BOOK, { stage: "resolve", combos: [HASTE] }).game;
    expect(won.winner).toBe("opp");
    // Or you answer: with a piece gone, it's broken, and the game goes on.
    const answered = moveAnyCard(paid.game, at(paid.game, "opp", "Untapper").iid, "graveyard");
    const broken = applyAction(answered, "opp", comboAction("100-200"), BOOK, { stage: "resolve", combos: [HASTE] }).game;
    expect(broken.winner).toBeFalsy();
    expect(broken.log.map((l) => l.text).join(" ")).toMatch(/The combo is broken: Untapper is gone/);
  });

  it("refuses one that isn't ready, or isn't the deck's", () => {
    const g0 = table({ opp: { field: ["Mirror Goblin"], hand: ["Untapper"] } });
    const r = applyAction(g0, "opp", comboAction("100-200"), BOOK, { combos: [HASTE] });
    expect(r.ok).toBe(false);
    expect(r.game.winner).toBeFalsy();
    expect(r.game.log.map((l) => l.text).join(" ")).toMatch(/Untapper must be cast first/);
    expect(applyAction(g0, "opp", comboAction("9-9"), BOOK, { combos: [HASTE] }).ok).toBe(false);
    expect(applyAction(g0, "opp", comboAction("100-200"), BOOK).ok).toBe(false);
  });

  it("endless mana pays for the rest of the turn", () => {
    const g0 = table({ opp: { field: ["Loop Ring", "Stone Loop", "Mountain", "Mountain"], hand: ["Big Beast", "Mirror Goblin"] } });
    const g = applyCombo(g0, "opp", MANA, BOOK).game;
    expect(g.winner).toBeFalsy();
    expect(g.pool!.opp.length).toBeGreaterThan(20);
    // Colourless only: it pays for a spell's generic part, not its red.
    const beast = applyAction(g, "opp", { ...comboAction(""), kind: "cast", card: cardId(at(g, "opp", "Big Beast", "hand").iid) }, BOOK);
    expect(beast.ok).toBe(true);
  });

  it("a creature that has to tap can't the turn it arrives, unless it has haste", () => {
    const slow = { ...BOOK, "mirror goblin": { ...BOOK["mirror goblin"]!, keywords: [], oracleText: "{T}: Create a token that's a copy of target nonlegendary creature you control." } };
    const g0 = table({ opp: { field: ["Mirror Goblin", "Untapper"] } });
    const fresh = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: g0.sides.opp.battlefield.map((c) => ({ ...c, enteredTurn: g0.turn })) } } };
    expect(comboStatus(fresh, "opp", HASTE, slow).ready).toBe(false);
    expect(comboStatus(fresh, "opp", HASTE, BOOK).ready).toBe(true);
  });
});

describe("the planner and its deck's combos", () => {
  const lands = ["Mountain", "Mountain", "Mountain", "Mountain", "Mountain"];

  it("casts the piece it holds and goes for it, and that is a turn it wins", () => {
    const g0 = table({ opp: { field: ["Mirror Goblin", ...lands], hand: ["Untapper"] }, you: { field: ["Bear"] } });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [HASTE]);
    expect(plan.main.map((a) => a.kind)).toEqual(["cast", "combo"]);
    expect(plan.attack).toEqual([]);
    expect(winningTurn(g0, BOOK, "opp", [HASTE])).not.toBeNull();
    // Without the deck's combos it just develops and attacks, as before.
    expect(fallbackPlan(g0, BOOK).main.every((a) => a.kind !== "combo")).toBe(true);
    expect(winningTurn(g0, BOOK)).toBeNull();
  });

  it("a combo sitting on the battlefield isn't a turn with nothing to decide", () => {
    const g0 = table({ opp: { field: ["Mirror Goblin", "Untapper"] } });
    expect(simpleTurn(g0, BOOK, "opp", [HASTE])).toBeNull();
  });

  it("its tutor finds the piece it lacks, not the biggest card", () => {
    const g0 = table({ opp: { field: ["Mirror Goblin", "Swamp", "Swamp"], hand: ["Dark Tutor"], top: ["Big Beast", "Untapper"] } });
    const find = (combos: DeckCombo[]) => fallbackPlan(g0, BOOK, "opp", {}, combos).main.flatMap((a) => a.effects).find((e) => e.type === "search")?.name;
    expect(find([HASTE])).toBe("Untapper");
    expect(find([])).not.toBe("Untapper");
  });
});

describe("what the model is told", () => {
  it("the deck's combos, and each turn where every one stands", () => {
    const { deck: text } = systemPrompt([{ name: "Mirror Goblin", quantity: 1 }], BOOK, null, [HASTE]);
    expect(text).toMatch(/YOUR DECK'S COMBOS/);
    expect(text).toMatch(/\[100-200\] Mirror Goblin \(battlefield\) \+ Untapper \(battlefield\) → Infinite creature tokens with haste/);
    const ready = table({ opp: { field: ["Mirror Goblin", "Untapper"] } });
    expect(comboBrief(ready, BOOK, [HASTE])).toMatch(/READY\. Go for it: \{"kind":"combo","card":"100-200"\}/);
    const far = table({ opp: { field: ["Mirror Goblin"], top: ["Untapper"] } });
    expect(comboBrief(far, BOOK, [HASTE])).toMatch(/not yet\. missing: Untapper \(in your library\)/);
    expect(comboBrief(ready, BOOK, [])).toBe("");
  });

  it("a plan may name a combo by its id", () => {
    const plan = cleanPlan({ main: [comboAction("100-200"), { ...comboAction("c12"), kind: "cast" }, comboAction("bad id!")], attack: [], after_combat: [], say: "" });
    expect(plan!.main.map((a) => `${a.kind}:${a.card}`)).toEqual(["combo:100-200", "cast:c12"]);
  });
});
