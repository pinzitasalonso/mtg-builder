// The engines of the top competitive decks, with Scryfall's text
// (fixtures/field.json, cards from the lists in calibration/practice/decks):
// a commander's ability used turn after turn, creature tutors that pay X,
// a Pact owed at the next upkeep, and the loops a commander's own trigger
// turns into a win.

import { describe, expect, it } from "vitest";
import { fallbackPlan, pactPayable, winningTurn } from "./ai";
import { castTriggerOf, creatureManaGrantOf, digAbilityOf, nonlandManaBonusOf, permanentFetchOf, stats, tapTreasureOf } from "./cards";
import { castsWithoutEnd, comboOutcome, type DeckCombo } from "./combos";
import { applyAction, availableMana, cardId, declareAttackers, newGame, startTurn, type DeckCard } from "./game";
import { manaTotal, parseCost, payCost } from "./mana";
import { tutorOf } from "./spells";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";
import CARDS from "./fixtures/field.json";

const keep = <T,>(a: T[]) => [...a];
const info = (name: string, o: Partial<CardInfo> = {}): CardInfo => ({ name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o });
const BOOK: CardBook = Object.fromEntries(
  [
    ...(CARDS as CardInfo[]).map((c) => info(c.name, c)),
    info("Bear", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2, typeLine: "Creature — Bear" }),
    info("Townsfolk", { manaCost: "{4}{G}", manaValue: 5, power: 4, toughness: 4, typeLine: "Creature — Human Peasant" }),
    info("Wurm", { manaCost: "{4}{G}{G}", manaValue: 6, power: 6, toughness: 6, typeLine: "Creature — Wurm" }),
    info("Red Ogre", { manaCost: "{2}{R}", manaValue: 3, power: 3, toughness: 3, typeLine: "Creature — Ogre" }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const of = (name: string) => BOOK[name.toLowerCase()]!;
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: of(name).typeLine }));

type Zones = { field?: string[]; hand?: string[]; top?: string[]; command?: string[] };
/** The opponent's turn 5, laid out by hand. Its library is Swamps under `top`. */
function table(o: { opp?: Zones; you?: Zones; life?: number }): PracticeGame {
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
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, library: [...top, ...pool], life: seat === "opp" ? (o.life ?? 40) : 40 };
  }
  return { ...g, turn: 5, active: "opp", landPlayed: true };
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "graveyard" | "command" | "library" = "hand") => g.sides[seat][zone].find((c) => c.name === name);
const act = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const search = (name: string, to: "hand" | "top" | "battlefield" = "hand") => ({ type: "search" as const, target: null, player: null, amount: null, name, power: null, toughness: null, keywords: [], to, tapped: null, text: null });
const said = (g: PracticeGame) => g.log.map((l) => l.text).join("\n");
const names = (g: PracticeGame, plan: { main: PlanAction[] }) =>
  plan.main.map((a) => (a.kind === "combo" ? `combo:${a.card}` : `${a.kind}:${[...g.sides.opp.hand, ...g.sides.opp.command, ...g.sides.opp.battlefield].find((c) => cardId(c.iid) === a.card)?.name}`));

describe("Kinnan, Bonder Prodigy", () => {
  // Ten mana on its fourth turn, Kinnan in play, and nothing done with it for five turns.
  it("makes one more mana from each nonland permanent tapped for it", () => {
    expect(nonlandManaBonusOf(of("Kinnan, Bonder Prodigy"))).toBe(true);
    const without = table({ opp: { field: ["Tropical Island", "Sol Ring", "Llanowar Elves"] } });
    const withIt = table({ opp: { field: ["Tropical Island", "Sol Ring", "Llanowar Elves", "Kinnan, Bonder Prodigy"] } });
    // A land, Sol Ring (2) and an Elf (1): four. With Kinnan the Ring makes three and the Elf two.
    expect(manaTotal(availableMana(without, "opp", BOOK))).toBe(4);
    expect(manaTotal(availableMana(withIt, "opp", BOOK))).toBe(6);
  });

  it("its ability puts the best creature of the top five onto the battlefield, never a Human", () => {
    expect(digAbilityOf(BOOK, { iid: 0, name: "Kinnan, Bonder Prodigy", imageUri: "", typeLine: of("Kinnan, Bonder Prodigy").typeLine, tapped: false, commander: false })).toMatchObject({ cost: "{5}{G}{U}", kind: "creature", look: 5 });
    const g0 = table({ opp: { field: ["Kinnan, Bonder Prodigy", "Tropical Island", "Breeding Pool", "Sol Ring", "Arcane Signet", "Llanowar Elves"], top: ["Bear", "Townsfolk", "Wurm", "Swamp", "Pili-Pala"] } });
    const kinnan = at(g0, "opp", "Kinnan, Bonder Prodigy", "battlefield")!;
    const r = applyAction(g0, "opp", act("activate", kinnan.iid, { mana: "{5}{G}{U}" }), BOOK);
    expect(r.ok).toBe(true);
    // The Wurm (6): the Townsfolk is a Human.
    expect(at(r.game, "opp", "Wurm", "battlefield")).toBeDefined();
    expect(said(r.game)).toMatch(/The opponent activates Kinnan, Bonder Prodigy: of 5 cards, Wurm enters the battlefield/);
    // The other four go to the bottom.
    expect(r.game.sides.opp.library.slice(-4).map((c) => c.name).sort()).toEqual(["Bear", "Pili-Pala", "Swamp", "Townsfolk"]);
    // A piece of its combo comes before a bigger creature.
    const combo = { id: "k", pieces: [{ name: "Pili-Pala", zones: ["B"] }], produces: ["Infinite colored mana"], manaNeeded: "", steps: "", prerequisites: "" } as DeckCombo;
    const piece = applyAction(g0, "opp", act("activate", kinnan.iid, { mana: "{5}{G}{U}" }), BOOK, { combos: [combo] });
    expect(at(piece.game, "opp", "Pili-Pala", "battlefield")).toBeDefined();
    // The planner spends its leftover mana on it.
    const plan = fallbackPlan(g0, BOOK);
    expect(names(g0, plan)).toContain("activate:Kinnan, Bonder Prodigy");
  });
});

describe("Thrasios, Triton Hero", () => {
  it("its ability draws a card, or puts a land onto the battlefield tapped", () => {
    const land = table({ opp: { field: ["Thrasios, Triton Hero", "Tropical Island", "Breeding Pool", "Sol Ring"], top: ["Forest"] } });
    const thrasios = (g: PracticeGame) => at(g, "opp", "Thrasios, Triton Hero", "battlefield")!.iid;
    const a = applyAction(land, "opp", act("activate", thrasios(land), { mana: "{4}" }), BOOK).game;
    expect(at(a, "opp", "Forest", "battlefield")).toMatchObject({ tapped: true });
    const spell = table({ opp: { field: ["Thrasios, Triton Hero", "Tropical Island", "Breeding Pool", "Sol Ring"], top: ["Bear"] } });
    const b = applyAction(spell, "opp", act("activate", thrasios(spell), { mana: "{4}" }), BOOK).game;
    expect(at(b, "opp", "Bear")).toBeDefined();
    // Three mana isn't four.
    const short = table({ opp: { field: ["Thrasios, Triton Hero", "Tropical Island", "Breeding Pool", "Forest"], top: ["Bear"] } });
    expect(applyAction(short, "opp", act("activate", thrasios(short), { mana: "{4}" }), BOOK).ok).toBe(false);
  });
});

describe("creature tutors", () => {
  it("Green Sun's Zenith, Chord of Calling, Finale of Devastation and Nature's Rhythm find a creature as big as X", () => {
    for (const n of ["Green Sun's Zenith", "Chord of Calling", "Finale of Devastation", "Nature's Rhythm"]) expect(tutorOf(of(n)), n).toMatchObject({ x: true, lose: 0 });
    expect(tutorOf(of("Green Sun's Zenith"))!.search.to[0]!.zone).toBe("battlefield");
    // Only green, for the Zenith.
    expect(tutorOf(of("Green Sun's Zenith"))!.search.test("Creature — Ogre", of("Red Ogre"))).toBe(false);
    expect(tutorOf(of("Chord of Calling"))!.search.test("Creature — Ogre", of("Red Ogre"))).toBe(true);
    const g0 = table({ opp: { field: ["Forest", "Forest", "Forest", "Forest"], hand: ["Green Sun's Zenith"], top: ["Bear", "Wurm"] } });
    const gsz = at(g0, "opp", "Green Sun's Zenith")!;
    // X = 2: the Bear, straight onto the battlefield.
    const r = applyAction(g0, "opp", act("cast", gsz.iid, { x: 2, effects: [search("Bear", "hand")] }), BOOK);
    expect(r.ok).toBe(true);
    expect(at(r.game, "opp", "Bear", "battlefield")).toBeDefined();
    // X = 2 doesn't reach a six-drop, whatever the plan says.
    const big = applyAction(g0, "opp", act("cast", gsz.iid, { x: 2, effects: [search("Wurm", "battlefield")] }), BOOK).game;
    expect(at(big, "opp", "Wurm", "battlefield")).toBeUndefined();
    expect(said(big)).toMatch(/Green Sun's Zenith finds nothing it can take \(X is 2\)/);
  });

  it("the planner casts one for the piece its combo lacks, with X to fit", () => {
    const combo = { id: "k", pieces: [{ name: "Kinnan, Bonder Prodigy", zones: ["B"] }, { name: "Pili-Pala", zones: ["B"] }, { name: "Cryptolith Rite", zones: ["B"] }], produces: ["Infinite colored mana"], manaNeeded: "", steps: "", prerequisites: "" } as DeckCombo;
    const lands = (n: number) => table({ opp: { field: ["Kinnan, Bonder Prodigy", "Cryptolith Rite", ...Array(n).fill("Forest")], hand: ["Chord of Calling"], top: ["Wurm", "Pili-Pala"] } });
    // Chord of Calling is {X}{G}{G}{G}, and Pili-Pala costs 2: five mana.
    // Three Forests, and Kinnan taps for two under the Rite.
    const g0 = lands(3);
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [combo]);
    const chord = plan.main.find((a) => a.effects.some((e) => e.type === "search"))!;
    expect(chord.effects[0]).toMatchObject({ name: "Pili-Pala", to: "battlefield" });
    expect(chord.x).toBe(2);
    expect(names(g0, plan)).toEqual(["cast:Chord of Calling", "combo:k"]);
    // With two it waits.
    expect(names(lands(2), fallbackPlan(lands(2), BOOK, "opp", {}, [combo]))).toEqual([]);
  });

  it("Summoner's Pact is paid for at the next upkeep, or the game is lost", () => {
    expect(tutorOf(of("Summoner's Pact"))).toMatchObject({ upkeep: "{2}{G}{G}" });
    const cast = (lands: string[]) => {
      const g0 = table({ opp: { field: lands, hand: ["Summoner's Pact"], top: ["Bear"] } });
      const g = applyAction(g0, "opp", act("cast", at(g0, "opp", "Summoner's Pact")!.iid, { effects: [search("Bear")] }), BOOK).game;
      expect(at(g, "opp", "Bear")).toBeDefined();
      return startTurn(g, BOOK);
    };
    expect(said(cast(["Forest", "Forest", "Forest", "Forest"]))).toMatch(/The opponent pays \{2\}\{G\}\{G\} for Summoner's Pact/);
    const lost = cast(["Forest", "Forest"]);
    expect(said(lost)).toMatch(/can't pay \{2\}\{G\}\{G\} for Summoner's Pact: it loses the game/);
    expect(lost.winner).toBe("you");
    // So the planner casts it only with that mana in play.
    const combo = { id: "k", pieces: [{ name: "Pili-Pala", zones: ["B"] }], produces: ["Infinite colored mana"], manaNeeded: "", steps: "", prerequisites: "" } as DeckCombo;
    const poor = table({ opp: { field: ["Forest", "Forest"], hand: ["Summoner's Pact"], top: ["Pili-Pala"] } });
    expect(names(poor, fallbackPlan(poor, BOOK, "opp", {}, [combo]))).not.toContain("cast:Summoner's Pact");
  });
});

describe("a commander that hurts with every spell", () => {
  it("Crystal deals as much as the spell has colours", () => {
    const crystal = { iid: 0, name: "Crystal, Inhuman Princess", imageUri: "", typeLine: of("Crystal, Inhuman Princess").typeLine, tapped: false, commander: true };
    expect(castTriggerOf(BOOK, crystal)).toMatchObject({ damagePerColor: true });
    const g0 = table({ opp: { field: ["Crystal, Inhuman Princess", "Tropical Island", "Mountain"], hand: ["Gut Shot", "Sol Ring"] } });
    // Gut Shot is red: one. (And its own damage isn't the table's to add here.)
    const shot = applyAction(g0, "opp", act("cast", at(g0, "opp", "Gut Shot")!.iid), BOOK).game;
    expect(said(shot)).toMatch(/Crystal, Inhuman Princess deals 1 damage to you/);
    // Sol Ring has no colour: nothing.
    const ring = applyAction(g0, "opp", act("cast", at(g0, "opp", "Sol Ring")!.iid), BOOK).game;
    expect(said(ring)).not.toMatch(/Crystal, Inhuman Princess deals/);
  });

  it("a loop that casts without end is a win with Vivi or Crystal out", () => {
    const loop = { id: "v", pieces: [{ name: "Hullbreaker Horror", zones: ["B"] }, { name: "Sol Ring", zones: ["B"] }], produces: ["Infinite colorless mana", "Infinite storm count"], manaNeeded: "", steps: "", prerequisites: "" } as DeckCombo;
    expect(castsWithoutEnd(loop.produces)).toBe(true);
    const go = (field: string[]) => {
      const g = table({ opp: { field } });
      return applyAction(g, "opp", { ...act("cast", 0), kind: "combo", card: "v" }, BOOK, { combos: [loop] }).game;
    };
    const vivi = go(["Hullbreaker Horror", "Sol Ring", "Vivi Ornitier"]);
    expect(vivi.winner).toBe("opp");
    expect(said(vivi)).toMatch(/Every spell of the loop is a hit from Vivi Ornitier/);
    // Without it, the loop is only mana.
    expect(go(["Hullbreaker Horror", "Sol Ring"]).winner).toBeNull();
    // And the planner goes for it.
    const ready = table({ opp: { field: ["Hullbreaker Horror", "Sol Ring", "Vivi Ornitier"] } });
    expect(winningTurn(ready, BOOK, "opp", [loop])).not.toBeNull();
  });

  it("what else counts as the game: the other library exiled, Magda's whole library on the table", () => {
    expect(comboOutcome(["Exile each opponent's library"])).toBe("mill");
    expect(comboOutcome(["Infinite artifact ETB", "Infinite tapped Treasure tokens", "Put all artifact cards and a subset of creature cards from your library onto the battlefield"])).toBe("win");
    expect(comboOutcome(["Infinite creature ETB", "Infinite creature LTB"])).toBe("other");
  });
});

describe("Magda, Brazen Outlaw", () => {
  it("makes a Treasure when a Dwarf becomes tapped, and finds an artifact for five", () => {
    const magda = (g: PracticeGame) => at(g, "opp", "Magda, Brazen Outlaw", "battlefield")!;
    const g0 = table({ opp: { field: ["Magda, Brazen Outlaw", "Dwarven Grunt", "Axgard Cavalry", "Mountain"], top: ["Clock of Omens", "Grim Monolith"] } });
    expect(tapTreasureOf(BOOK, magda(g0))).toBe("dwarf");
    // Three Dwarves attack: three Treasures.
    const attacked = declareAttackers(g0, "opp", ["Magda, Brazen Outlaw", "Dwarven Grunt", "Axgard Cavalry"].map((n) => at(g0, "opp", n, "battlefield")!.iid), BOOK);
    const treasures = (g: PracticeGame) => g.sides.opp.battlefield.filter((c) => c.name === "Treasure").length;
    expect(treasures(attacked)).toBe(3);
    // Not enough for the ability yet.
    expect(applyAction(attacked, "opp", act("activate", magda(attacked).iid), BOOK).ok).toBe(false);
    // With five: the artifact the plan names, or a combo piece.
    const five = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: [...g0.sides.opp.battlefield, ...Array.from({ length: 5 }, (_, i) => ({ iid: 9000 + i, name: "Treasure", imageUri: "", typeLine: "Token Artifact — Treasure", tapped: false, commander: false, token: { power: 0, toughness: 0, keywords: [], kind: "artifact" as const } }))] } } };
    expect(permanentFetchOf(BOOK, magda(five))).toMatchObject({ treasures: 5, cost: null });
    const named = applyAction(five, "opp", act("activate", magda(five).iid, { effects: [search("Grim Monolith", "battlefield")] }), BOOK).game;
    expect(at(named, "opp", "Grim Monolith", "battlefield")).toBeDefined();
    expect(treasures(named)).toBe(0);
    const combo = { id: "m", pieces: [{ name: "Magda, Brazen Outlaw", zones: ["B"] }, { name: "Clock of Omens", zones: ["B"] }], produces: ["Infinite tapped Treasure tokens"], manaNeeded: "", steps: "", prerequisites: "" } as DeckCombo;
    const piece = applyAction(five, "opp", act("activate", magda(five).iid), BOOK, { combos: [combo] }).game;
    expect(at(piece, "opp", "Clock of Omens", "battlefield")).toBeDefined();
    // The planner uses it as soon as the five are there.
    expect(names(five, fallbackPlan(five, BOOK, "opp", {}, [combo]))).toContain("activate:Magda, Brazen Outlaw");
  });
});

describe("Sisay, Weatherlight Captain", () => {
  it("finds a legendary permanent that costs less than her power, which grows with her legends' colours", () => {
    const five = ["Command Tower", "City of Brass", "Mana Confluence", "Command Tower", "City of Brass"];
    const g0 = table({ opp: { field: ["Sisay, Weatherlight Captain", ...five], top: ["Necrodominance", "Mox Amber", "Kinnan, Bonder Prodigy"] } });
    const sisay = (g: PracticeGame) => at(g, "opp", "Sisay, Weatherlight Captain", "battlefield")!;
    expect(permanentFetchOf(BOOK, sisay(g0))).toMatchObject({ cost: "{W}{U}{B}{R}{G}", underPower: true });
    expect(stats(BOOK, sisay(g0)).power).toBe(2);
    // Power 2: only what costs 0 or 1. Kinnan (2) is out of reach; Mox Amber (0) isn't.
    const first = applyAction(g0, "opp", act("activate", sisay(g0).iid, { mana: "{W}{U}{B}{R}{G}", effects: [search("Kinnan, Bonder Prodigy", "battlefield")] }), BOOK).game;
    expect(at(first, "opp", "Kinnan, Bonder Prodigy", "battlefield")).toBeUndefined();
    expect(at(first, "opp", "Mox Amber", "battlefield")).toBeDefined();
    // With Kinnan (green and blue) beside her she counts as 4: Necrodominance (3) is in reach.
    const g1 = table({ opp: { field: ["Sisay, Weatherlight Captain", "Kinnan, Bonder Prodigy", ...five], top: ["Necrodominance", "Mox Amber"] } });
    const second = applyAction(g1, "opp", act("activate", sisay(g1).iid, { mana: "{W}{U}{B}{R}{G}" }), BOOK).game;
    expect(at(second, "opp", "Necrodominance", "battlefield")).toBeDefined();
    // The planner uses her when the five colours are there.
    expect(names(g1, fallbackPlan(g1, BOOK))).toContain("activate:Sisay, Weatherlight Captain");
  });
});

describe("Cryptolith Rite", () => {
  it("every creature taps for mana, and Kinnan adds his one", () => {
    expect(creatureManaGrantOf(of("Cryptolith Rite"))).toEqual({ colors: ["W", "U", "B", "R", "G"], amount: 1 });
    expect(creatureManaGrantOf(of("Rok-Tahk, Budding Scientist"))).toEqual({ colors: ["G"], amount: 2 });
    expect(creatureManaGrantOf(of("Enduring Vitality"))).toMatchObject({ amount: 1 });
    expect(creatureManaGrantOf(of("Llanowar Elves"))).toBeNull();
    const mana = (field: string[]) => manaTotal(availableMana(table({ opp: { field } }), "opp", BOOK));
    // A Forest, a Bear and a Wurm: one. With the Rite: three.
    expect(mana(["Forest", "Bear", "Wurm"])).toBe(1);
    expect(mana(["Forest", "Bear", "Wurm", "Cryptolith Rite"])).toBe(3);
    // An Elf already taps for one: it isn't counted twice.
    expect(mana(["Forest", "Llanowar Elves", "Cryptolith Rite"])).toBe(2);
    // Kinnan taps too, and each creature's mana is one more.
    expect(mana(["Forest", "Bear", "Kinnan, Bonder Prodigy", "Cryptolith Rite"])).toBe(5);
    // Lands pay first, and the Wurm is the last thing tapped: it attacks.
    const g1 = table({ opp: { field: ["Forest", "Forest", "Bear", "Wurm", "Cryptolith Rite"] } });
    const paid = payCost(parseCost("{3}"), availableMana(g1, "opp", BOOK))!;
    expect(paid.tap).not.toContain(at(g1, "opp", "Wurm", "battlefield")!.iid);
    expect(paid.tap).toContain(at(g1, "opp", "Bear", "battlefield")!.iid);
    // Leftover mana goes into Kinnan's ability only from what wouldn't attack:
    // five lands and two big creatures aren't seven mana to dig with.
    const idle = table({ opp: { field: ["Kinnan, Bonder Prodigy", "Cryptolith Rite", "Wurm", "Tropical Island", "Breeding Pool", "Forest", "Forest", "Forest"], top: ["Bear"] } });
    expect(names(idle, fallbackPlan(idle, BOOK))).not.toContain("activate:Kinnan, Bonder Prodigy");
    // A creature that came this turn can't.
    const g = table({ opp: { field: ["Forest", "Cryptolith Rite", "Bear"] } });
    const fresh = { ...g, sides: { ...g.sides, opp: { ...g.sides.opp, battlefield: g.sides.opp.battlefield.map((c) => (c.name === "Bear" ? { ...c, enteredTurn: g.turn } : c)) } } };
    expect(manaTotal(availableMana(fresh, "opp", BOOK))).toBe(1);
  });
});

describe("a Pact and the mana that will be there", () => {
  it("doesn't count a Lotus Petal it will have spent, or a Mana Vault that stays tapped", () => {
    const g = (field: string[]) => table({ opp: { field } });
    expect(pactPayable(g(["Forest", "Forest", "Forest", "Forest"]), "opp", "{2}{G}{G}", BOOK)).toBe(true);
    expect(pactPayable(g(["Forest", "Forest", "Sol Ring"]), "opp", "{2}{G}{G}", BOOK)).toBe(true);
    expect(pactPayable(g(["Forest", "Forest", "Forest", "Lotus Petal"]), "opp", "{2}{G}{G}", BOOK)).toBe(false);
    expect(pactPayable(g(["Forest", "Forest", "Grim Monolith"]), "opp", "{2}{G}{G}", BOOK)).toBe(false);
    // Tapped lands untap in time.
    const tapped = g(["Forest", "Forest", "Forest", "Forest"]);
    tapped.sides.opp.battlefield = tapped.sides.opp.battlefield.map((c) => ({ ...c, tapped: true }));
    expect(pactPayable(tapped, "opp", "{2}{G}{G}", BOOK)).toBe(true);
  });
});
