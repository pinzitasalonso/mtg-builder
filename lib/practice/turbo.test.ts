// A turbo deck's tools, with Scryfall's text (fixtures/turbo.json, from a
// Rograkh + Silas Renn list): cards that end with the turn, creatures and
// cards turned into mana, rituals, Ad Nauseam, and the planner going for
// its combo.

import { describe, expect, it, vi } from "vitest";
import { aiMulligan, arrivalsPlan, chooseBlocks, fallbackPlan, guardPlan, safeAttackers, spareManaPlan, winningTurn } from "./ai";
import { comboBrief, lineBrief } from "./brief";
import { scaleDamage } from "./damage";
import { entersTapped, handManaOf, manaOutput, manaSinkOf, ownTurnOf, sacManaOf, searchAbility } from "./cards";
import { comboNeeds, type DeckCombo } from "./combos";
import { report, selfplay } from "./selfplay";
import { applyAction, availableMana, cardId, comboStatus, declareAttackers, endTurn, manaAhead, newGame, playerSpellResolves, shownLog, startTurn, uncastable, type DeckCard } from "./game";
import { manaSources, manaTotal, parseCost, payCost } from "./mana";
import { cardTypesAmong, drawSpellOf, tutorOf, tutorSearch } from "./spells";
import { readTriggers } from "./triggers";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";
import { adNauseamOf, extraTurnLosesOf, impulseOf, ritualMana, sacrificeCostOf } from "./wincons";
import CARDS from "./fixtures/turbo.json";
import COMBOS from "./fixtures/turbo-combos.json";

const keep = <T,>(a: T[]) => [...a];
const info = (name: string, o: Partial<CardInfo> = {}): CardInfo => ({ name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o });
const BOOK: CardBook = Object.fromEntries(
  [
    ...(CARDS as CardInfo[]).map((c) => info(c.name, c)),
    info("Island", { typeLine: "Basic Land — Island", producedMana: ["U"] }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
    info("Bear", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Counterspell", { typeLine: "Instant", manaCost: "{U}{U}", manaValue: 2, oracleText: "Counter target spell." }),
    // A third match's cards, with Scryfall's text.
    info("City of Traitors", { typeLine: "Land", producedMana: ["C"], oracleText: "When you play another land, sacrifice this land.\n{T}: Add {C}{C}." }),
    info("Starting Town", { typeLine: "Land — Town", producedMana: ["B", "C", "G", "R", "U", "W"], oracleText: "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color." }),
    info("Hexing Squelcher", { typeLine: "Creature — Goblin Sorcerer", manaCost: "{1}{R}", manaValue: 2, power: 2, toughness: 2, oracleText: "This spell can't be countered.\nWard—Pay 2 life.\nSpells you control can't be countered.\nOther creatures you control have \"Ward—Pay 2 life.\"" }),
    info("Copy Enchantment", { typeLine: "Enchantment", manaCost: "{2}{U}", manaValue: 3, oracleText: "You may have this enchantment enter as a copy of any enchantment on the battlefield." }),
    // A fourth match's.
    info("Lim-Dûl's Vault", { typeLine: "Instant", manaCost: "{U}{B}", manaValue: 2, oracleText: "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order." }),
    info("Fiendish Duo", { typeLine: "Creature — Devil", manaCost: "{4}{R}{R}", manaValue: 6, power: 5, toughness: 5, oracleText: "First strike (This creature deals combat damage before creatures without first strike.)\nIf a source would deal damage to an opponent, it deals double that damage to that player instead." }),
    // A fifth match's (Vivi).
    info("Mana Vault", { typeLine: "Artifact", manaCost: "{1}", manaValue: 1, producedMana: ["C"], oracleText: "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}." }),
    info("Drift of Phantasms", { typeLine: "Creature — Spirit", manaCost: "{3}", manaValue: 3, power: 0, toughness: 5, keywords: ["Flying", "Defender", "Transmute"], oracleText: "Flying, defender\nTransmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)" }),
    info("Dizzy Spell", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, keywords: ["Transmute"], oracleText: "Target creature gets -3/-0 until end of turn.\nTransmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)" }),
    info("War God", { typeLine: "Legendary Creature — God", manaCost: "{1}{R}{R}", manaValue: 3, power: 2, toughness: 4, oracleText: "At the beginning of each player's end step, War God deals damage to that player equal to the number of creatures that player controls that didn't attack this turn." }),
    info("Goblin Piker", { typeLine: "Creature — Goblin Warrior", manaCost: "{1}{R}", manaValue: 2, power: 0, toughness: 3, oracleText: "Whenever this creature attacks, it gets +2/+0 until end of turn." }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const of = (name: string) => BOOK[name.toLowerCase()]!;
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: of(name).typeLine }));
const [ORACLE, BREACH] = COMBOS as DeckCombo[] as [DeckCombo, DeckCombo];

type Zones = { field?: string[]; hand?: string[]; top?: string[]; grave?: string[]; command?: string[] };
/** The opponent's turn 5, laid out by hand. Its library is Swamps under `top`. */
function table(o: { opp?: Zones; you?: Zones; active?: "you" | "opp"; life?: number }): PracticeGame {
  const all = (z?: Zones) => [...(z?.field ?? []), ...(z?.hand ?? []), ...(z?.top ?? []), ...(z?.grave ?? [])];
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
    const grave = (z?.grave ?? []).map(take);
    const top = (z?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, graveyard: grave, library: [...top, ...pool], life: seat === "opp" ? (o.life ?? 40) : 40 };
  }
  return { ...g, turn: 5, active: o.active ?? "opp", landPlayed: true };
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "graveyard" | "command" | "exile" | "library" = "hand") => g.sides[seat][zone].find((c) => c.name === name);
const act = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const cast = (g: PracticeGame, name: string, o: Partial<PlanAction> = {}) => applyAction(g, "opp", act("cast", (at(g, "opp", name) ?? at(g, "opp", name, "command"))!.iid, o), BOOK);
const said = (g: PracticeGame) => g.log.map((l) => l.text).join("\n");
const names = (g: PracticeGame, plan: { main: PlanAction[] }) =>
  plan.main.map((a) => (a.kind === "combo" ? `combo:${a.card}` : `${a.kind}:${[...g.sides.opp.hand, ...g.sides.opp.command, ...g.sides.opp.battlefield].find((c) => cardId(c.iid) === a.card)?.name}`));

describe("cards that end with the turn", () => {
  it("Underworld Breach is sacrificed at the end step, yours and the opponent's", () => {
    expect(readTriggers(of("Underworld Breach").oracleText ?? "", "Underworld Breach").endSacrifice).toBe(true);
    const g = endTurn(table({ opp: { field: ["Underworld Breach"] }, you: { field: [] } }), BOOK);
    expect(at(g, "opp", "Underworld Breach", "battlefield")).toBeUndefined();
    expect(at(g, "opp", "Underworld Breach", "graveyard")).toBeDefined();
    expect(said(g)).toMatch(/The opponent sacrifices Underworld Breach: it only lasts the turn/);
  });

  it("Final Fortune: the extra turn, and the game lost at its end step", () => {
    expect(extraTurnLosesOf(of("Final Fortune"))).toBe(true);
    const g0 = table({ opp: { field: ["Badlands", "Volcanic Island"], hand: ["Final Fortune"] } });
    const g1 = cast(g0, "Final Fortune").game;
    expect(said(g1)).toMatch(/takes an extra turn after this one, and loses the game at its end step/);
    const extra = endTurn(g1, BOOK);
    expect(extra.active).toBe("opp");
    expect(extra.winner).toBeFalsy();
    const over = endTurn(extra, BOOK);
    expect(over.winner).toBe("you");
    expect(said(over)).toMatch(/it loses the game\. You win!/);
  });

  it("your own Final Fortune costs you the game too", () => {
    const g0 = table({ you: { grave: ["Final Fortune"] }, active: "you" });
    const g1 = playerSpellResolves(g0, at(g0, "you", "Final Fortune", "graveyard")!.iid, BOOK);
    const over = endTurn(endTurn(g1, BOOK), BOOK);
    expect(over.winner).toBe("opp");
  });

  it("the planner casts neither on its own", () => {
    const g = table({ opp: { field: ["Badlands", "Volcanic Island", "Underground Sea"], hand: ["Underworld Breach", "Final Fortune", "Sol Ring"] } });
    expect(names(g, fallbackPlan(g, BOOK, "opp", {}, [BREACH]))).toEqual(["cast:Sol Ring"]);
    // With no combos known, Breach still only lasts the turn.
    expect(names(g, fallbackPlan(g, BOOK))).toEqual(["cast:Sol Ring"]);
  });
});

describe("a creature turned into mana", () => {
  it("Culling the Weak sacrifices the commander that costs nothing, and adds four", () => {
    expect(sacrificeCostOf(of("Culling the Weak"))).toBe("creature");
    const g0 = table({ opp: { field: ["Badlands", "Rograkh, Son of Rohgahh", "Silas Renn, Seeker Adept"], hand: ["Culling the Weak"] } });
    // (Both are commanders here only by name: the free one is still the fodder.)
    const r = cast(g0, "Culling the Weak");
    expect(r.ok).toBe(true);
    expect(at(r.game, "opp", "Rograkh, Son of Rohgahh", "battlefield")).toBeUndefined();
    expect(at(r.game, "opp", "Silas Renn, Seeker Adept", "battlefield")).toBeDefined();
    expect(r.game.pool!.opp).toEqual(["B", "B", "B", "B"]);
    expect(said(r.game)).toMatch(/The opponent sacrifices Rograkh, Son of Rohgahh for Culling the Weak/);
  });

  it("with no creature it can't be cast, and the planner doesn't try", () => {
    const g0 = table({ opp: { field: ["Badlands"], hand: ["Culling the Weak", "Diabolic Intent"] } });
    expect(uncastable(g0, "opp", at(g0, "opp", "Culling the Weak")!, BOOK)).toMatch(/needs a creature to sacrifice/);
    expect(cast(g0, "Culling the Weak").ok).toBe(false);
    expect(fallbackPlan(g0, BOOK).main).toEqual([]);
  });

  it("Diabolic Intent is a tutor that takes a creature; Gamble, one that throws a card away", () => {
    expect(tutorOf(of("Diabolic Intent"))).toMatchObject({ lose: 0 });
    expect(tutorOf(of("Gamble"))).toMatchObject({ discardRandom: true });
    const g0 = table({ opp: { field: ["Badlands", "Underground Sea", "Rograkh, Son of Rohgahh"], hand: ["Diabolic Intent"], top: ["Thassa's Oracle"] } });
    const r = cast(g0, "Diabolic Intent", { effects: [{ type: "search", target: null, player: null, amount: null, name: "Thassa's Oracle", power: null, toughness: null, keywords: [], to: "hand", tapped: null, text: null }] });
    expect(at(r.game, "opp", "Thassa's Oracle")).toBeDefined();
    expect(at(r.game, "opp", "Rograkh, Son of Rohgahh", "battlefield")).toBeUndefined();
    const g1 = table({ opp: { field: ["Badlands"], hand: ["Gamble", "Bear"], top: ["Sol Ring"] } });
    const gambled = cast(g1, "Gamble", { effects: [{ type: "search", target: null, player: null, amount: null, name: "Sol Ring", power: null, toughness: null, keywords: [], to: "hand", tapped: null, text: null }] }).game;
    expect(gambled.sides.opp.hand).toHaveLength(1);
    expect(said(gambled)).toMatch(/Gamble: The opponent discards (Bear|Sol Ring) at random/);
  });

  it("Phyrexian Tower: activated, it takes a creature and adds {B}{B}", () => {
    expect(sacManaOf(of("Phyrexian Tower"))).toEqual({ units: ["B", "B"], tap: true });
    const g0 = table({ opp: { field: ["Phyrexian Tower", "Rograkh, Son of Rohgahh"] } });
    const tower = at(g0, "opp", "Phyrexian Tower", "battlefield")!;
    const r = applyAction(g0, "opp", act("activate", tower.iid), BOOK);
    expect(r.ok).toBe(true);
    expect(r.game.pool!.opp).toEqual(["B", "B"]);
    expect(at(r.game, "opp", "Phyrexian Tower", "battlefield")!.tapped).toBe(true);
    expect(at(r.game, "opp", "Rograkh, Son of Rohgahh", "battlefield")).toBeUndefined();
    // With nothing to feed it, nothing happens.
    const none = table({ opp: { field: ["Phyrexian Tower"] } });
    expect(applyAction(none, "opp", act("activate", at(none, "opp", "Phyrexian Tower", "battlefield")!.iid), BOOK).ok).toBe(false);
  });

  it("Simian Spirit Guide in the opponent's hand is mana, exiled when it's used", () => {
    expect(handManaOf(of("Simian Spirit Guide"))).toEqual(["R"]);
    const g0 = table({ opp: { field: ["Underground Sea"], hand: ["Simian Spirit Guide", "Gamble"] } });
    expect(manaTotal(availableMana(g0, "opp", BOOK))).toBe(2);
    // Gamble is {R}: the land can't pay it, the Guide can.
    const r = cast(g0, "Gamble");
    expect(r.ok).toBe(true);
    expect(at(r.game, "opp", "Simian Spirit Guide", "exile")).toBeDefined();
    expect(said(r.game)).toMatch(/exiles Simian Spirit Guide from its hand for mana/);
    // Yours is yours to exile by hand.
    const mine = table({ you: { hand: ["Simian Spirit Guide"] }, active: "you" });
    expect(manaTotal(availableMana(mine, "you", BOOK))).toBe(0);
    // And the planner keeps it as mana: it isn't cast as a 2/2.
    const rich = table({ opp: { field: ["Badlands", "Volcanic Island", "Underground Sea"], hand: ["Simian Spirit Guide"] } });
    expect(fallbackPlan(rich, BOOK).main).toEqual([]);
  });
});

describe("rituals", () => {
  const here = { graveyard: 0, ritesInGraveyards: 0, foeHand: 0 };
  it("the mana each adds, as the table stands", () => {
    expect(ritualMana(of("Dark Ritual"), here)).toEqual(["B", "B", "B"]);
    expect(ritualMana(of("Culling the Weak"), here)).toEqual(["B", "B", "B", "B"]);
    expect(ritualMana(of("Infernal Plunge"), here)).toEqual(["R", "R", "R"]);
    expect(ritualMana(of("Rite of Flame"), here)).toEqual(["R", "R"]);
    expect(ritualMana(of("Rite of Flame"), { ...here, ritesInGraveyards: 2 })).toEqual(["R", "R", "R", "R"]);
    expect(ritualMana(of("Cabal Ritual"), here)).toEqual(["B", "B", "B"]);
    expect(ritualMana(of("Cabal Ritual"), { ...here, graveyard: 7 })).toEqual(["B", "B", "B", "B", "B"]);
    expect(ritualMana(of("Jeska's Will"), { ...here, foeHand: 6 })).toEqual(Array(6).fill("R"));
    expect(ritualMana(of("Demonic Tutor"), here)).toBeNull();
    expect(ritualMana(of("Sol Ring"), here)).toBeNull();
  });

  it("the table adds it as the spell resolves, whatever the plan said", () => {
    const g0 = table({ opp: { field: ["Badlands"], hand: ["Dark Ritual"] } });
    const mana = (text: string) => ({ type: "mana" as const, target: null, player: null, amount: null, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text });
    expect(cast(g0, "Dark Ritual").game.pool!.opp).toEqual(["B", "B", "B"]);
    // A plan that claims more gets what the card gives.
    expect(cast(g0, "Dark Ritual", { effects: [mana("{B}{B}{B}{B}{B}{B}")] }).game.pool!.opp).toEqual(["B", "B", "B"]);
  });
});

describe("Ad Nauseam", () => {
  it("fills the hand for life, and stops with some left", () => {
    expect(adNauseamOf(of("Ad Nauseam"))).toBe(true);
    const g0 = table({ opp: { field: ["Badlands", "Underground Sea", "Volcanic Island", "Sol Ring"], hand: ["Ad Nauseam"], top: Array(30).fill("Bear") }, life: 20 });
    const g = cast(g0, "Ad Nauseam").game;
    // Six Bears at 2 life each: from 20 down to 8.
    expect(g.sides.opp.hand.filter((c) => c.name === "Bear")).toHaveLength(6);
    expect(g.sides.opp.life).toBe(8);
    expect(said(g)).toMatch(/Ad Nauseam: The opponent puts 6 cards into its hand and loses 12 life/);
  });
});

describe("going for the combo", () => {
  it("what a combo asks for besides its pieces", () => {
    expect(comboNeeds("You have at least six other cards in your graveyard, plus an additional four cards if Brain Freeze is in your graveyard.")).toEqual({ graveyard: 6, plus: [{ name: "Brain Freeze", count: 4 }], handOrGraveyard: 0 });
    expect(comboNeeds(BREACH.prerequisites)).toMatchObject({ handOrGraveyard: 6 });
    expect(comboNeeds("Aftermath Analyst is untapped.")).toEqual({ graveyard: 0, plus: [], handOrGraveyard: 0 });
  });

  it("Underworld Breach's combo waits for the graveyard, and the model is told", () => {
    const thin = table({ opp: { field: ["Badlands", "Volcanic Island", "Underground Sea", "Lion's Eye Diamond"], hand: ["Underworld Breach", "Brain Freeze"] } });
    const st = comboStatus(thin, "opp", BREACH, BOOK);
    expect(st.ready).toBe(false);
    expect(st.needs).toMatch(/It needs 6 other cards between your hand and graveyard \(0 there\)/);
    // Brain Freeze belongs in the graveyard: cast from the hand, it gets there.
    expect(st.toCast.map((c) => c.name).sort()).toEqual(["Brain Freeze", "Underworld Breach"]);
    expect(comboBrief(thin, BOOK, [BREACH])).toMatch(/It needs 6 other cards between your hand and graveyard/);
    // So Breach stays in hand.
    expect(names(thin, fallbackPlan(thin, BOOK, "opp", {}, [BREACH]))).toEqual([]);
  });

  it("with the graveyard full it casts the pieces and goes: your library is gone", () => {
    const g0 = table({ opp: { field: ["Badlands", "Volcanic Island", "Underground Sea", "Sol Ring", "Lion's Eye Diamond"], hand: ["Underworld Breach", "Brain Freeze"], grave: Array(6).fill("Bear") } });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [BREACH]);
    expect(names(g0, plan)).toEqual(["cast:Underworld Breach", "cast:Brain Freeze", `combo:${BREACH.id}`]);
    expect(winningTurn(g0, BOOK, "opp", [BREACH])).not.toBeNull();
    let g = g0;
    for (const a of plan.main) g = applyAction(g, "opp", a, BOOK, { combos: [BREACH] }).game;
    expect(g.sides.you.library).toHaveLength(0);
  });

  it("holds Thassa's Oracle and Consultation until both are there, then wins", () => {
    const one = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle"], top: ["Bear"] } });
    expect(fallbackPlan(one, BOOK, "opp", {}, [ORACLE]).main).toEqual([]);
    const both = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle", "Demonic Consultation"] } });
    expect(winningTurn(both, BOOK, "opp", [ORACLE])).not.toBeNull();
  });

  it("finds the missing piece, makes the mana with a ritual and a sacrifice, and goes off in one turn", () => {
    // Two lands. Demonic Tutor ({1}{B}) for the Oracle, then Consultation
    // and the Oracle ({U}{U}{B}): five mana. Lotus Petal, and Culling the
    // Weak on Rograkh from the command zone, make it.
    const g0 = table({
      opp: { field: ["Underground Sea", "Underground Sea"], hand: ["Demonic Tutor", "Demonic Consultation", "Culling the Weak", "Lotus Petal"], top: ["Bear", "Thassa's Oracle"], command: ["Rograkh, Son of Rohgahh"] },
    });
    const plan = winningTurn(g0, BOOK, "opp", [ORACLE]);
    expect(plan).not.toBeNull();
    const order = names(g0, plan!);
    expect(order).toContain("cast:Demonic Tutor");
    expect(order).toContain("cast:Culling the Weak");
    expect(order).toContain("cast:Rograkh, Son of Rohgahh");
    expect(order.at(-1)).toBe(`combo:${ORACLE.id}`);
    expect(order.indexOf("cast:Rograkh, Son of Rohgahh")).toBeLessThan(order.indexOf("cast:Culling the Weak"));
    let g = g0;
    for (const a of plan!.main) g = applyAction(g, "opp", a, BOOK, { combos: [ORACLE] }).game;
    expect(g.winner).toBe("opp");
  });

  it("when it can't finish, it keeps its rituals and spends nothing on the line", () => {
    // No blue mana for the Oracle: the ritual and the Consultation stay.
    const g0 = table({ opp: { field: ["Badlands"], hand: ["Thassa's Oracle", "Demonic Consultation", "Dark Ritual"] } });
    expect(winningTurn(g0, BOOK, "opp", [ORACLE])).toBeNull();
    expect(fallbackPlan(g0, BOOK, "opp", {}, [ORACLE]).main).toEqual([]);
  });

  it("at the end of its turn it keeps the cards that win, and throws the rest", () => {
    const g0 = table({ opp: { hand: ["Thassa's Oracle", "Demonic Consultation", "Demonic Tutor", "Ad Nauseam", "Dark Ritual", "Underworld Breach", "Vampiric Tutor", "Counterspell", "Bear"] } });
    const g = endTurn(g0, BOOK);
    expect(said(g)).toMatch(/discards down to 7 cards: (Counterspell, Bear|Bear, Counterspell)/);
  });
});

describe("draw engines", () => {
  it("Necropotence: no draw step, and at its end step every life above 15 becomes a card", () => {
    const g0 = table({ opp: { field: ["Necropotence", "Swamp"], hand: ["Bear"] }, life: 30 });
    const g1 = endTurn(g0, BOOK);
    // Fifteen cards for fifteen life; the best seven are kept.
    expect(g1.sides.opp.life).toBe(15);
    expect(g1.sides.opp.hand).toHaveLength(7);
    expect(said(g1)).toMatch(/Necropotence: the opponent pays 15 life for 15 cards/);
    // Its next turn: no draw. At its end step, two more while it has the life.
    const g2 = endTurn(g1, BOOK);
    expect(g2.active).toBe("opp");
    expect(g2.sides.opp.hand).toHaveLength(7);
    expect(said(g2)).toMatch(/Necropotence: The opponent skips the draw step/);
    expect(endTurn(g2, BOOK).sides.opp.life).toBe(13);
  });

  it("what it digs up is sorted at cleanup: the win stays", () => {
    const g0 = table({ opp: { field: ["Necropotence", "Swamp"], hand: ["Thassa's Oracle", "Demonic Consultation", "Bear", "Bear", "Bear", "Bear", "Bear"] }, life: 30 });
    const g = endTurn(g0, BOOK);
    expect(g.sides.opp.life).toBe(15);
    expect(g.sides.opp.hand).toHaveLength(7);
    expect(g.sides.opp.hand.map((c) => c.name)).toEqual(expect.arrayContaining(["Thassa's Oracle", "Demonic Consultation"]));
  });

  it("at 8 life it pays nothing more", () => {
    const g = endTurn(table({ opp: { field: ["Necropotence"], hand: [] }, life: 8 }), BOOK);
    expect(g.sides.opp.life).toBe(8);
    expect(g.sides.opp.hand).toHaveLength(0);
  });

  it("Necrodominance: draws, and the hand size is five", () => {
    const g0 = table({ opp: { field: ["Necrodominance"], hand: ["Bear", "Bear", "Bear", "Bear", "Bear", "Bear", "Bear"] }, life: 25 });
    const g = endTurn(g0, BOOK);
    expect(g.sides.opp.life).toBe(15);
    expect(g.sides.opp.hand).toHaveLength(5);
    expect(said(g)).toMatch(/discards down to 5 cards/);
  });

  it("yours is yours to use by hand: you're reminded, and you skip your draw", () => {
    const g0 = table({ you: { field: ["Necropotence"] }, active: "you" });
    const g = endTurn(g0, BOOK);
    expect(said(g)).toMatch(/Necropotence: pay life for cards now if you want them/);
    expect(g.sides.you.life).toBe(40);
    const back = endTurn(g, BOOK);
    expect(said(back)).toMatch(/Necropotence: You skip the draw step/);
  });

  it("Mystic Remora: its upkeep is paid at {1} and {2}, then it's sacrificed; it taxes your noncreature spells", () => {
    expect(readTriggers(of("Mystic Remora").oracleText ?? "", "Mystic Remora").tax).toEqual({ noncreature: true, first: false, cost: 4 });
    let g = table({ opp: { field: ["Mystic Remora", "Underground Sea", "Underground Sea", "Underground Sea"] } });
    g = startTurn(g, BOOK);
    expect(said(g)).toMatch(/pays \{1\} for Mystic Remora's cumulative upkeep/);
    g = startTurn(g, BOOK);
    expect(said(g)).toMatch(/pays \{2\} for Mystic Remora's cumulative upkeep/);
    g = startTurn(g, BOOK);
    expect(said(g)).toMatch(/doesn't pay Mystic Remora's cumulative upkeep: it's sacrificed/);
    expect(at(g, "opp", "Mystic Remora", "graveyard")).toBeDefined();
  });

  it("the planner casts a ritual to land its draw engine", () => {
    const g0 = table({ opp: { field: ["Swamp"], hand: ["Dark Ritual", "Necrodominance"] } });
    const plan = fallbackPlan(g0, BOOK);
    expect(names(g0, plan)).toEqual(["cast:Dark Ritual", "cast:Necrodominance"]);
    let g = g0;
    for (const a of plan.main) g = applyAction(g, "opp", a, BOOK).game;
    expect(at(g, "opp", "Necrodominance", "battlefield")).toBeDefined();
    // And the model is shown that line.
    expect(lineBrief(g0, plan)).toMatch(/^cast c\d+ Dark Ritual; cast c\d+ Necrodominance\.$/);
    // A ritual isn't spent on nothing.
    expect(fallbackPlan(table({ opp: { field: ["Swamp"], hand: ["Dark Ritual", "Bear"] } }), BOOK).main).toEqual([]);
  });
});

describe("cantrips and tutors", () => {
  it("Gitaxian Probe, Borne Upon a Wind and Brainstorm draw", () => {
    expect(drawSpellOf(of("Gitaxian Probe"))).toEqual({ draw: 1, lose: 0 });
    expect(drawSpellOf(of("Borne Upon a Wind"))).toEqual({ draw: 1, lose: 0 });
    expect(drawSpellOf(of("Brainstorm"))).toEqual({ draw: 3, lose: 0, back: 2 });
  });

  it("Brainstorm draws three and puts back the two worst", () => {
    const g0 = table({ opp: { field: ["Underground Sea"], hand: ["Brainstorm", "Thassa's Oracle"], top: ["Swamp", "Sol Ring", "Swamp"] } });
    const g = cast(g0, "Brainstorm").game;
    // Three drawn, two back: the Oracle stays, with one of the three.
    expect(g.sides.opp.hand).toHaveLength(2);
    expect(g.sides.opp.hand.map((c) => c.name)).toContain("Thassa's Oracle");
    expect(at(g, "opp", "Brainstorm", "graveyard")).toBeDefined();
    // The other two are back on top.
    const kept = g.sides.opp.hand.map((c) => c.name).filter((n) => n !== "Thassa's Oracle");
    expect([...kept, ...g.sides.opp.library.slice(0, 2).map((c) => c.name)].sort()).toEqual(["Sol Ring", "Swamp", "Swamp"]);
    expect(said(g)).toMatch(/Brainstorm: The opponent puts 2 cards back on top/);
  });

  it("Demonic Counsel finds a Demon, or any card with four card types in the graveyard", () => {
    const t = tutorOf(of("Demonic Counsel"))!;
    expect(t.delirium).toBeDefined();
    const demon = info("Imp", { typeLine: "Creature — Demon" });
    const thin = [{ typeLine: "Instant" }, { typeLine: "Sorcery" }];
    const full = [...thin, { typeLine: "Basic Land — Swamp" }, { typeLine: "Artifact Creature — Golem" }];
    expect(cardTypesAmong(full.map((c) => c.typeLine))).toBe(5);
    expect(tutorSearch(t, thin).test("Instant", of("Dark Ritual"))).toBe(false);
    expect(tutorSearch(t, thin).test(demon.typeLine, demon)).toBe(true);
    expect(tutorSearch(t, full).test("Instant", of("Dark Ritual"))).toBe(true);
  });

  it("Beseech the Mirror is a tutor to the hand", () => {
    const t = tutorOf(of("Beseech the Mirror"))!;
    expect(t.search.to).toEqual([{ zone: "hand" }]);
    expect(t.search.test("Instant", of("Dark Ritual"))).toBe(true);
  });

  it("Wishclaw Talisman: the opponent uses it for a combo piece, and you get it", () => {
    expect(searchAbility(of("Wishclaw Talisman"))).toMatchObject({ tap: true, mana: "{1}", givesAway: true });
    const g0 = table({ opp: { field: ["Wishclaw Talisman", "Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle"], top: ["Bear", "Demonic Consultation"] } });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [ORACLE]);
    expect(names(g0, plan)).toEqual(["activate:Wishclaw Talisman"]);
    let g = g0;
    for (const a of plan.main) g = applyAction(g, "opp", a, BOOK, { combos: [ORACLE] }).game;
    expect(at(g, "opp", "Demonic Consultation")).toBeDefined();
    expect(at(g, "you", "Wishclaw Talisman", "battlefield")).toBeDefined();
    expect(said(g)).toMatch(/You gain control of Wishclaw Talisman/);
    // Not for anything else: it would hand you a tutor.
    expect(fallbackPlan(table({ opp: { field: ["Wishclaw Talisman", "Underground Sea", "Underground Sea"], top: ["Bear"] } }), BOOK).main).toEqual([]);
  });

  it("…and with the mana for the rest, it's the turn it wins", () => {
    const g0 = table({ opp: { field: ["Wishclaw Talisman", "Underground Sea", "Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle"], top: ["Bear", "Demonic Consultation"] } });
    const plan = winningTurn(g0, BOOK, "opp", [ORACLE]);
    expect(plan).not.toBeNull();
    let g = g0;
    for (const a of plan!.main) g = applyAction(g, "opp", a, BOOK, { combos: [ORACLE] }).game;
    expect(g.winner).toBe("opp");
  });
});

describe("mana it used to miss", () => {
  it("Gemstone Mine taps for any colour", () => {
    expect(manaOutput(of("Gemstone Mine"), of("Gemstone Mine").typeLine)).toMatchObject({ amount: 1 });
    expect(manaOutput(of("Gemstone Mine"), of("Gemstone Mine").typeLine)!.colors.sort()).toEqual(["B", "G", "R", "U", "W"]);
  });

  it("Paradise Mantle's creature taps for one of any colour", () => {
    const g0 = table({ opp: { field: ["Rograkh, Son of Rohgahh", "Paradise Mantle"] } });
    const bare = manaTotal(availableMana(g0, "opp", BOOK));
    const rog = at(g0, "opp", "Rograkh, Son of Rohgahh", "battlefield")!;
    const g = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: g0.sides.opp.battlefield.map((c) => (c.name === "Paradise Mantle" ? { ...c, attachedTo: rog.iid } : c)) } } };
    expect(manaTotal(availableMana(g, "opp", BOOK))).toBe(bare + 1);
  });
});

describe("the opponent's mulligan", () => {
  const seven = (...names: string[]) => {
    const g = newGame({ you: { cards: deck(...Array(20).fill("Island")) }, opp: { cards: deck(...names, ...Array(30).fill("Swamp")) }, commanderGame: true, first: "opp", shuffle: keep });
    return g.sides.opp;
  };
  it("keeps one land with fast mana", () => {
    const side = seven("Badlands", "Lotus Petal", "Sol Ring", "Dark Ritual", "Brainstorm", "Thassa's Oracle", "Bear");
    expect(aiMulligan(side, BOOK).mulligans).toBe(0);
  });
  it("never keeps a hand with no land: down to five at most", () => {
    const side = seven("Lotus Petal", "Sol Ring", "Dark Ritual", "Brainstorm", "Thassa's Oracle", "Bear", "Gitaxian Probe");
    const kept = aiMulligan(side, BOOK);
    expect(kept.mulligans).toBeGreaterThanOrEqual(1);
    expect(kept.mulligans).toBeLessThanOrEqual(2);
    expect(kept.hand).toHaveLength(7 - kept.mulligans);
    if (kept.mulligans === 1) expect(kept.hand.some((c) => /Land/.test(c.typeLine ?? ""))).toBe(true);
  });
});

describe("the smart opponent's plan", () => {
  const oracle = (g: PracticeGame) => act("cast", at(g, "opp", "Thassa's Oracle")!.iid);
  it("a combo piece cast on a turn that doesn't go off is taken out", () => {
    const g = table({ opp: { field: ["Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle", "Sol Ring", "Final Fortune"] } });
    const plan = { main: [oracle(g), act("cast", at(g, "opp", "Sol Ring")!.iid), act("cast", at(g, "opp", "Final Fortune")!.iid)], attack: [], after_combat: [], say: "" };
    expect(names(g, guardPlan(g, plan, BOOK))).toEqual(["cast:Sol Ring"]);
  });
  it("a plan that goes off is left alone", () => {
    const g = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Thassa's Oracle", "Demonic Consultation"] } });
    const plan = { main: [act("cast", at(g, "opp", "Demonic Consultation")!.iid), oracle(g)], attack: [], after_combat: [], say: "" };
    expect(guardPlan(g, plan, BOOK)).toBe(plan);
    const combo = { main: [act("combo", 0, { card: ORACLE.id })], attack: [], after_combat: [], say: "" };
    expect(guardPlan(g, combo, BOOK)).toBe(combo);
  });
});

describe("a line over two turns", () => {
  it("a ritual pays for the tutor that finds the missing half; the win is next turn's", () => {
    // Your log: Cabal Ritual and Beseech the Mirror sat in hand for ten
    // turns, because the whole win didn't fit in one.
    const g0 = table({ opp: { field: ["Badlands", "Underground Sea", "Underground Sea"], hand: ["Cabal Ritual", "Beseech the Mirror", "Demonic Consultation"], top: ["Bear", "Thassa's Oracle"] } });
    expect(winningTurn(g0, BOOK, "opp", [ORACLE])).toBeNull();
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [ORACLE]);
    expect(names(g0, plan)).toEqual(["cast:Cabal Ritual", "cast:Beseech the Mirror"]);
    let g = g0;
    for (const a of plan.main) g = applyAction(g, "opp", a, BOOK, { combos: [ORACLE] }).game;
    expect(at(g, "opp", "Thassa's Oracle")).toBeDefined();
    // Its next turn, with its lands untapped: the win.
    const next = endTurn(endTurn(g, BOOK, [ORACLE]), BOOK, [ORACLE]);
    expect(winningTurn(next, BOOK, "opp", [ORACLE])).not.toBeNull();
  });

  it("a tutor that can't find the piece finds one that can", () => {
    // Mystical Tutor can't find a creature: with Consultation in hand it
    // used to fetch Tainted Pact, a second copy of what it held.
    const g0 = table({ opp: { field: ["Underground Sea"], hand: ["Mystical Tutor", "Demonic Consultation"], top: ["Bear", "Tainted Pact", "Demonic Tutor", "Thassa's Oracle"] } });
    const plan = fallbackPlan(g0, BOOK, "opp", {}, COMBOS as DeckCombo[]);
    expect(plan.main.flatMap((a) => a.effects).find((e) => e.type === "search")?.name).toBe("Demonic Tutor");
  });

  it("at cleanup it keeps a piece of its combo over a card it could cast", () => {
    const g0 = table({ opp: { hand: ["Brain Freeze", "Bear", "Bear", "Bear", "Bear", "Bear", "Bear", "Bear"] } });
    expect(said(endTurn(g0, BOOK, [BREACH]))).toMatch(/discards down to 7 cards: Bear\./);
  });
});

describe("refilling the hand", () => {
  it("Wheel of Fortune throws away a hand of answers, never both halves of a win", () => {
    const lands = ["Badlands", "Volcanic Island", "Underground Sea"];
    const dead = table({ opp: { field: lands, hand: ["Wheel of Fortune", "Counterspell", "Counterspell", "Counterspell", "Counterspell", "Sol Ring"] } });
    expect(names(dead, fallbackPlan(dead, BOOK))).toContain("cast:Wheel of Fortune");
    const win = table({ opp: { field: ["Badlands"], hand: ["Wheel of Fortune", "Thassa's Oracle", "Demonic Consultation", "Counterspell", "Counterspell"] } });
    expect(names(win, fallbackPlan(win, BOOK, "opp", {}, [ORACLE]))).not.toContain("cast:Wheel of Fortune");
    const live = table({ opp: { field: lands, hand: ["Wheel of Fortune", "Bear", "Bear", "Demonic Tutor", "Sol Ring"] } });
    expect(names(live, fallbackPlan(live, BOOK))).not.toContain("cast:Wheel of Fortune");
  });

  it("Jeska's Will with a commander out: the mana, and three cards for the turn only", () => {
    expect(impulseOf(of("Jeska's Will"))).toBe(3);
    const g0 = table({
      opp: { field: ["Badlands", "Volcanic Island", "Volcanic Island"], hand: ["Jeska's Will"], top: ["Sol Ring", "Bear", "Counterspell"], command: ["Rograkh, Son of Rohgahh"] },
      you: { hand: ["Bear", "Bear", "Bear", "Bear"] },
    });
    // Rograkh first (it costs nothing), so the Will has a commander.
    const g1 = cast(g0, "Rograkh, Son of Rohgahh").game;
    expect(names(g1, fallbackPlan(g1, BOOK))[0]).toBe("cast:Jeska's Will");
    const g2 = cast(g1, "Jeska's Will").game;
    expect(g2.pool!.opp).toEqual(["R", "R", "R", "R"]);
    expect(g2.sides.opp.hand.map((c) => c.name)).toEqual(["Sol Ring", "Bear", "Counterspell"]);
    expect(said(g2)).toMatch(/Jeska's Will: the opponent exiles the top 3 cards of its library, and may play them this turn/);
    // It plays what it can; the rest is gone at the end of the turn.
    const g3 = applyAction(g2, "opp", act("cast", at(g2, "opp", "Sol Ring")!.iid), BOOK).game;
    const over = endTurn(g3, BOOK);
    expect(at(over, "opp", "Sol Ring", "battlefield")).toBeDefined();
    expect(over.sides.opp.hand.map((c) => c.name)).not.toContain("Counterspell");
    expect(at(over, "opp", "Counterspell", "exile")).toBeDefined();
    expect(said(over)).toMatch(/stay in exile: not played this turn/);
  });
});

describe("endless mana", () => {
  const LOOP: DeckCombo = { id: "9-9", pieces: [{ name: "Sol Ring", zones: ["B"] }, { name: "Lotus Petal", zones: ["B"] }], produces: ["Infinite colored mana"], manaNeeded: "", steps: "Loop.", prerequisites: "" };
  const go = (g: PracticeGame) => applyAction(g, "opp", act("combo", 0, { card: LOOP.id }), BOOK, { combos: [LOOP] }).game;

  it("with a way to spend it for ever on the table, it's the game", () => {
    expect(manaSinkOf(of("Kinnan, Bonder Prodigy"))).toBe("{5}{G}{U}");
    expect(manaSinkOf(of("Sol Ring"))).toBeNull();
    const g = go(table({ opp: { field: ["Sol Ring", "Lotus Petal", "Kinnan, Bonder Prodigy"] } }));
    expect(g.winner).toBe("opp");
    expect(said(g)).toMatch(/With endless mana, Kinnan, Bonder Prodigy's ability takes the opponent through its whole library/);
  });

  it("without one it's mana for the turn, as before", () => {
    const g = go(table({ opp: { field: ["Sol Ring", "Lotus Petal"] } }));
    expect(g.winner).toBeFalsy();
    expect(g.pool!.opp.length).toBeGreaterThan(20);
  });
});

describe("the benchmark's self-play", () => {
  it("a seed is the same game every time, and the report counts its wins", () => {
    const cards = [...Array(30).fill("Swamp"), ...Array(8).fill("Bear"), "Sol Ring", "Thassa's Oracle", "Demonic Consultation", "Demonic Tutor", "Underground Sea", "Underground Sea", "Underground Sea"].map((name) => ({ name, imageUri: "", typeLine: of(name).typeLine }));
    const list = { cards, commander: null, book: BOOK, combos: [ORACLE] };
    const a = selfplay(list, 7, 6);
    const b = selfplay(list, 7, 6);
    expect(a).toEqual(b);
    expect(a.turns.length).toBeGreaterThan(0);
    expect(a.turns[0]!.hand.length).toBeGreaterThan(0);
    const r = report([a, selfplay(list, 8, 6)], 6);
    expect(r.games).toBe(2);
    expect(r.wonBy[6]).toBeLessThanOrEqual(2);
    expect(r.idle).toBeGreaterThanOrEqual(0);
  });
});

// Two matches against Rograkh + Silas Renn, read from their traces
// (lib/practice/trace.ts): what the table got wrong around a good plan.
describe("what two real matches showed", () => {
  const search = (name: string, to: "hand" | "top" = "hand") => ({ type: "search" as const, target: null, player: null, amount: null, name, power: null, toughness: null, keywords: [], to, tapped: null, text: null });
  /** A plan played the way the table plays it: each action paid for knowing what comes after. */
  const play = (g0: PracticeGame, actions: PlanAction[]) => actions.reduce((g, a, i) => applyAction(g, "opp", a, BOOK, { keep: manaAhead(g, actions.slice(i + 1), BOOK) }).game, g0);

  // Turn 4: Mana Vault, then Jeska's Will, then Gamble. The rock was paid
  // for with the only red land, and the two red spells couldn't be cast.
  it("pays a generic cost with the land the rest of the plan doesn't need", () => {
    const g0 = table({ opp: { field: ["Badlands", "Watery Grave", "Rograkh, Son of Rohgahh"], hand: ["Sol Ring", "Jeska's Will", "Gamble"], top: ["Tainted Pact"] }, you: { hand: ["Bear", "Bear", "Bear"] } });
    const plan = [act("cast", at(g0, "opp", "Sol Ring")!.iid), act("cast", at(g0, "opp", "Jeska's Will")!.iid), act("cast", at(g0, "opp", "Gamble")!.iid, { effects: [search("Tainted Pact")] })];
    expect(manaAhead(g0, plan.slice(1), BOOK)).toEqual(["R", "R"]);
    // As it was: the first land listed paid for the rock, and that was the red one.
    const blind = plan.reduce((g, a) => applyAction(g, "opp", a, BOOK).game, g0);
    expect(said(blind)).toMatch(/can't pay for Jeska's Will/);
    const g = play(g0, plan);
    expect(said(g)).not.toMatch(/can't pay/);
    expect(said(g)).toMatch(/The opponent casts Jeska's Will/);
    expect(said(g)).toMatch(/Gamble finds Tainted Pact/);
    // The payment itself: of two lands, the one that isn't red.
    const sources = manaSources(g0.sides.opp, BOOK, g0.turn);
    const paid = payCost(parseCost("{1}"), sources, { keep: ["R", "R"] })!;
    expect(paid.tap.map((iid) => g0.sides.opp.battlefield.find((c) => c.iid === iid)!.name)).toEqual(["Watery Grave"]);
    // With nothing wanted after, nothing changes.
    expect(payCost(parseCost("{1}"), sources)!.tap.map((iid) => g0.sides.opp.battlefield.find((c) => c.iid === iid)!.name)).toEqual(["Badlands"]);
  });

  // "The opponent discards Force of Negation. Gamble: The opponent discards
  // Culling the Weak at random." The plan listed Gamble's discard, and the
  // table did Gamble's discard too.
  it("Gamble throws one card away, whatever the plan lists", () => {
    const g0 = table({ opp: { field: ["Badlands"], hand: ["Gamble", "Bear", "Bear", "Bear"], top: ["Necropotence"] } });
    const discard = { ...search(""), type: "discard" as const, player: "ai" as const, amount: 1, name: null, to: null };
    const g = cast(g0, "Gamble", { effects: [search("Necropotence"), discard] }).game;
    // Three Bears and the Necropotence found, less one.
    expect(g.sides.opp.hand).toHaveLength(3);
    expect(said(g).match(/discards/g)).toHaveLength(1);
  });

  // Turn 5: Gamble found Necropotence, Cabal Ritual made {B}{B}{B}, and the
  // turn ended with both: the model can't name a card it doesn't hold yet.
  it("plays what the turn brought, with the mana that's left, and leaves the held cards held", () => {
    const g0 = table({ opp: { field: ["Badlands", "Watery Grave", "Volcanic Island"], hand: ["Gamble", "Cabal Ritual", "Rhystic Study", "Bear"], top: ["Necropotence"] } });
    const held = new Set(g0.sides.opp.hand.map((c) => c.iid));
    // Nothing new yet: nothing for the table to add.
    expect(arrivalsPlan(g0, BOOK, held)).toBeNull();
    const plan = [act("cast", at(g0, "opp", "Gamble")!.iid, { effects: [search("Necropotence")] }), act("cast", at(g0, "opp", "Cabal Ritual")!.iid)];
    // Gamble's discard is at random: here it's the Bear (the third of four).
    const random = vi.spyOn(Math, "random").mockReturnValue(0.6);
    const g = play(g0, plan);
    random.mockRestore();
    expect(g.sides.opp.hand.map((c) => c.name).sort()).toEqual(["Necropotence", "Rhystic Study"]);
    expect(g.pool?.opp).toEqual(["B", "B", "B"]);
    const more = arrivalsPlan(g, BOOK, held)!;
    // Necropotence, which arrived. Not Rhystic Study, which the model held.
    expect(names(g, more)).toEqual(["cast:Necropotence"]);
    const after = play(g, more.main);
    expect(at(after, "opp", "Necropotence", "battlefield")).toBeDefined();
    expect(at(after, "opp", "Rhystic Study")).toBeDefined();
  });

  // Turn 9: Mystical Tutor put Tainted Pact on top. Necropotence skips the
  // draw, the table took no cards at 7 life, and the plan's own activation
  // was a note that told the player what was on top.
  it("Necropotence takes the card its tutor put on top, and isn't activated by the plan", () => {
    const g0 = table({ opp: { field: ["Necropotence", "Underground Sea"], hand: ["Mystical Tutor"], top: ["Swamp", "Tainted Pact"] }, life: 7 });
    const tutored = cast(g0, "Mystical Tutor", { effects: [search("Tainted Pact", "top")] }).game;
    expect(tutored.sides.opp.library[0]).toMatchObject({ name: "Tainted Pact", sought: true });
    // The plan's activation: refused, out of the player's sight, and free.
    const necro = at(tutored, "opp", "Necropotence", "battlefield")!;
    const note = { ...search(""), type: "note" as const, name: null, to: null, text: "Exile top card (Tainted Pact) face down; put it into hand at next end step." };
    const tried = applyAction(tutored, "opp", act("activate", necro.iid, { life: 1, effects: [note] }), BOOK);
    expect(tried.ok).toBe(false);
    expect(tried.game.sides.opp.life).toBe(7);
    expect(shownLog(tried.game).map((l) => l.text).join("\n")).not.toMatch(/Tainted Pact/);
    // The end step: one life, for that card.
    const ended = endTurn(tried.game, BOOK);
    expect(said(ended)).toMatch(/Necropotence: the opponent pays 1 life for 1 card/);
    expect(at(ended, "opp", "Tainted Pact")).toBeDefined();
    expect(at(ended, "opp", "Tainted Pact")!.sought).toBeUndefined();
    expect(ended.sides.opp.life).toBe(6);
    // With nothing sought, 7 life buys nothing, as before.
    expect(said(endTurn(g0, BOOK))).not.toMatch(/pays \d+ life/);
  });
});

// A third match: the opponent sat on one land for eleven turns and lost.
// Its draws were poor. What it did with its mana was worse.
describe("mana sense", () => {
  // Turn 7: it played Starting Town, and City of Traitors was sacrificed
  // untapped. A player taps the City for {C}{C} first.
  it("City of Traitors is tapped for its mana before another land takes it", () => {
    const g0 = { ...table({ opp: { field: ["City of Traitors"], hand: ["Starting Town", "Hexing Squelcher"] } }), landPlayed: false };
    const played = applyAction(g0, "opp", act("land", at(g0, "opp", "Starting Town")!.iid), BOOK).game;
    expect(said(played)).toMatch(/The opponent taps City of Traitors for \{C\}\{C\} first: it goes when another land is played/);
    expect(at(played, "opp", "City of Traitors", "graveyard")).toBeDefined();
    expect(played.pool?.opp).toEqual(["C", "C"]);
    // {1}{R}: the floating mana, and the Town's red for a life.
    const cast = applyAction(played, "opp", act("cast", at(played, "opp", "Hexing Squelcher")!.iid), BOOK);
    expect(cast.ok).toBe(true);
    expect(at(cast.game, "opp", "Hexing Squelcher", "battlefield")).toBeDefined();
    // A City that was already tapped for the turn has nothing more to give.
    const spent = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, battlefield: g0.sides.opp.battlefield.map((c) => ({ ...c, tapped: true })) } } };
    expect(applyAction(spent, "opp", act("land", at(spent, "opp", "Starting Town")!.iid), BOOK).game.pool?.opp ?? []).toEqual([]);
  });

  it("the planner counts on that mana: the land, then a spell the two together pay for", () => {
    const g0 = { ...table({ opp: { field: ["City of Traitors"], hand: ["Starting Town", "Hexing Squelcher"] } }), landPlayed: false };
    const plan = fallbackPlan(g0, BOOK);
    expect(names(g0, plan)).toEqual(["land:Starting Town", "cast:Hexing Squelcher"]);
    const g = plan.main.reduce((x, a2) => applyAction(x, "opp", a2, BOOK).game, g0);
    expect(at(g, "opp", "Hexing Squelcher", "battlefield")).toBeDefined();
  });

  // It entered untapped on the opponent's fourth turn, and paid for a spell.
  it("Starting Town enters tapped from its controller's fourth turn", () => {
    expect(ownTurnOf(5)).toBe(3);
    expect(ownTurnOf(6)).toBe(3);
    expect(ownTurnOf(7)).toBe(4);
    expect(entersTapped(of("Starting Town"), 3)).toBe(false);
    expect(entersTapped(of("Starting Town"), 4)).toBe(true);
    const play = (turn: number) => {
      const g0 = { ...table({ opp: { hand: ["Starting Town"] } }), landPlayed: false, turn };
      return at(applyAction(g0, "opp", act("land", at(g0, "opp", "Starting Town")!.iid), BOOK).game, "opp", "Starting Town", "battlefield")!;
    };
    expect(play(5).tapped).toBe(false);
    expect(play(7).tapped).toBe(true);
  });

  // Turn 9: its only land paid Mystic Remora's {1}, and the turn was gone.
  it("pays a cumulative upkeep only while that leaves mana for the turn", () => {
    const one = startTurn(table({ opp: { field: ["Mystic Remora", "Underground Sea"] } }), BOOK);
    expect(said(one)).toMatch(/doesn't pay Mystic Remora's cumulative upkeep: it's sacrificed/);
    expect(at(one, "opp", "Underground Sea", "battlefield")!.tapped).toBe(false);
    // Two lands, or one and a land to play: {1} is paid.
    expect(said(startTurn(table({ opp: { field: ["Mystic Remora", "Underground Sea", "Badlands"] } }), BOOK))).toMatch(/pays \{1\} for Mystic Remora/);
    expect(said(startTurn(table({ opp: { field: ["Mystic Remora", "Underground Sea"], hand: ["Badlands"] } }), BOOK))).toMatch(/pays \{1\} for Mystic Remora/);
  });

  // City of Traitors, and a hand of blue, black and red spells: kept at six.
  it("doesn't keep one land that makes none of the colours the hand asks for", () => {
    const seven = (...names: string[]) => newGame({ you: { cards: deck(...Array(20).fill("Island")) }, opp: { cards: deck(...names, ...Array(30).fill("Swamp")) }, commanderGame: true, first: "opp", shuffle: keep }).sides.opp;
    const spells = ["Copy Enchantment", "Final Fortune", "Hexing Squelcher", "Culling the Weak"];
    // One land and two rocks was a keep, whatever they made.
    expect(aiMulligan(seven("City of Traitors", "Sol Ring", "Sol Ring", ...spells), BOOK).mulligans).toBeGreaterThanOrEqual(1);
    // The same hand on a land that makes its colours is kept.
    expect(aiMulligan(seven("Badlands", "Sol Ring", "Sol Ring", ...spells), BOOK).mulligans).toBe(0);
    // So is a hand that asks for no colour.
    expect(aiMulligan(seven("City of Traitors", "Sol Ring", "Sol Ring", "Sol Ring", "Lotus Petal", "Paradise Mantle", "Lion's Eye Diamond"), BOOK).mulligans).toBe(0);
  });

  // "Slow start, but the little kobold still swings": a 0/1, every turn.
  it("an attacker with no power stays home, unless attacking is the point", () => {
    const g = table({ opp: { field: ["Rograkh, Son of Rohgahh", "Goblin Piker", "Bear"] } });
    const id = (name: string) => cardId(at(g, "opp", name, "battlefield")!.iid);
    const plan = { say: "", main: [], attack: [id("Rograkh, Son of Rohgahh"), id("Goblin Piker"), id("Bear")], after_combat: [] };
    // Rograkh is 0/1. The Piker is 0/3 with a trigger on attacking. The Bear is 2/2.
    expect(guardPlan(g, plan, BOOK).attack).toEqual([id("Goblin Piker"), id("Bear")]);
  });
});

// A fourth match: it held Demonic Consultation from its first turn, cast
// Lim-Dûl's Vault for Thassa's Oracle on its second, and the table did
// nothing with the Vault. It lost on turn 16.
describe("the lines of a competitive deck", () => {
  const search = (name: string, to: "hand" | "top" = "hand") => ({ type: "search" as const, target: null, player: null, amount: null, name, power: null, toughness: null, keywords: [], to, tapped: null, text: null });

  it("Lim-Dûl's Vault is a tutor to the top, a life for every five cards it passes", () => {
    expect(tutorOf(of("Lim-Dûl's Vault"))).toMatchObject({ dig: 5, lose: 0 });
    // The Oracle is the thirteenth card down: two fives are passed.
    const g0 = table({ opp: { field: ["Underground Sea", "Underground Sea"], hand: ["Lim-Dûl's Vault", "Demonic Consultation"], top: [...Array(12).fill("Bear"), "Thassa's Oracle"] } });
    // The plan said "hand", and added a note that named the card: the card says the top, and says no more.
    const note = { ...search(""), type: "note" as const, name: null, to: null, text: "Look until Thassa's Oracle is found; put it on top." };
    const g = cast(g0, "Lim-Dûl's Vault", { effects: [search("Thassa's Oracle", "hand"), note] }).game;
    expect(g.sides.opp.library[0]).toMatchObject({ name: "Thassa's Oracle", sought: true });
    expect(g.sides.opp.life).toBe(38);
    expect(said(g)).toMatch(/Lim-Dûl's Vault: The opponent pays 2 life to look further/);
    expect(said(g)).not.toMatch(/Resolve:/);
    expect(shownLog(g).map((l) => l.text).join("\n")).not.toMatch(/Thassa's Oracle/);
    // The planner casts it for the half it's missing…
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [ORACLE]);
    expect(names(g0, plan)).toContain("cast:Lim-Dûl's Vault");
    expect(plan.main.find((a) => a.effects.some((e) => e.type === "search"))!.effects[0]).toMatchObject({ name: "Thassa's Oracle", to: "top" });
    // …draws it, and has the win it was built for: a land later, three mana.
    const next = startTurn(g, BOOK);
    expect(at(next, "opp", "Thassa's Oracle")).toBeDefined();
    const third = { ...next, sides: { ...next.sides, opp: { ...next.sides.opp, battlefield: [...next.sides.opp.battlefield.map((c) => ({ ...c, tapped: false })), { ...next.sides.opp.library.find((c) => c.name === "Swamp")!, enteredTurn: 0 }] } } };
    expect(winningTurn(third, BOOK, "opp", [ORACLE])).not.toBeNull();
    // Not at a life total the digging could end.
    expect(names(g0, fallbackPlan({ ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, life: 12 } } }, BOOK, "opp", {}, [ORACLE]))).not.toContain("cast:Lim-Dûl's Vault");
  });

  // "Demonic Consultation: The opponent exiles 40 cards and puts Commandeer into its hand."
  it("Demonic Consultation without the Oracle is cast only for a card it names", () => {
    const g0 = table({ opp: { field: ["Underground Sea"], hand: ["Demonic Consultation"], top: [...Array(8).fill("Bear"), "Necropotence"] } });
    const blind = cast(g0, "Demonic Consultation");
    expect(blind.ok).toBe(false);
    expect(blind.game.sides.opp.exile).toHaveLength(0);
    expect(blind.game.log.at(-1)).toMatchObject({ hidden: true });
    const named = cast(g0, "Demonic Consultation", { effects: [search("Necropotence")] });
    expect(named.ok).toBe(true);
    expect(at(named.game, "opp", "Necropotence")).toBeDefined();
    expect(named.game.sides.opp.exile).toHaveLength(8);
    // With the Oracle in hand it is the win, and needs no name.
    const win = table({ opp: { field: ["Underground Sea"], hand: ["Demonic Consultation", "Thassa's Oracle"] } });
    expect(cast(win, "Demonic Consultation").ok).toBe(true);
    // A plan with a lone Consultation isn't "going off": its wasted casts are still taken out.
    const lone = table({ opp: { field: ["Underground Sea", "Volcanic Island", "Badlands"], hand: ["Demonic Consultation", "Underworld Breach"] } });
    const plan = { say: "", attack: [], after_combat: [], main: [act("cast", at(lone, "opp", "Demonic Consultation")!.iid, { effects: [search("Necropotence")] }), act("cast", at(lone, "opp", "Underworld Breach")!.iid)] };
    expect(names(lone, guardPlan(lone, plan, BOOK))).toEqual(["cast:Demonic Consultation"]);
  });

  // Copy Enchantment sat in its hand all game: "the app's line: cast Copy Enchantment", with nothing to copy.
  it("a clone is cast only with something to copy, and enters as it", () => {
    const empty = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Copy Enchantment"] } });
    expect(uncastable(empty, "opp", at(empty, "opp", "Copy Enchantment")!, BOOK)).toMatch(/no enchantment to copy/);
    expect(names(empty, fallbackPlan(empty, BOOK))).not.toContain("cast:Copy Enchantment");
    const g0 = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea", "Mystic Remora"], hand: ["Copy Enchantment"] } });
    const g = cast(g0, "Copy Enchantment").game;
    expect(said(g)).toMatch(/Copy Enchantment enters as a copy of Mystic Remora/);
    const copies = g.sides.opp.battlefield.filter((c) => c.name === "Mystic Remora");
    expect(copies).toHaveLength(2);
    const clone = copies.find((c) => c.cloneOf)!;
    expect(clone.cloneOf).toMatchObject({ name: "Copy Enchantment" });
    // It's itself again when it leaves.
    const gone = endTurn({ ...g, sides: { ...g.sides, opp: { ...g.sides.opp, hand: [], battlefield: g.sides.opp.battlefield.filter((c) => !c.name.includes("Sea")) } } }, BOOK);
    expect(gone).toBeDefined();
  });

  // Kike took the life off by hand: the Duo doubles what its controller's opponent takes.
  it("Fiendish Duo doubles the damage its controller's opponents take, from any source", () => {
    const g = table({ you: { field: ["Fiendish Duo", "Bear"] }, opp: { field: ["Bear"] } });
    const bear = at(g, "you", "Bear", "battlefield")!;
    const theirs = at(g, "opp", "Bear", "battlefield")!;
    // Your Bear hits the opponent: doubled. Their own source hurting them: doubled too.
    expect(scaleDamage(g, BOOK, "you", bear, "opp", 2, true)).toBe(4);
    expect(scaleDamage(g, BOOK, "opp", theirs, "opp", 3)).toBe(6);
    // Damage to you, or to a creature: as printed.
    expect(scaleDamage(g, BOOK, "opp", theirs, "you", 2, true)).toBe(2);
    expect(scaleDamage(g, BOOK, "you", bear, "opp", 2, true, true)).toBe(2);
  });

  // Turn 15: nine mana, one spell, and a two-mana creature left in hand.
  it("leftover mana is spent on the permanents it holds, keeping an answer's mana", () => {
    const start = (lands: number, hand: string[]) => table({ opp: { field: Array(lands).fill("Command Tower"), hand, command: ["Rograkh, Son of Rohgahh"] } });
    const four = start(4, ["Bear", "Counterspell"]);
    // The Bear ({1}{G}), with {U}{U} kept for the Counterspell. Not the commander: that's the model's call.
    expect(names(four, spareManaPlan(four, BOOK)!)).toEqual(["cast:Bear"]);
    // Three lands: the Bear would leave one, and the Counterspell needs two.
    expect(spareManaPlan(start(3, ["Bear", "Counterspell"]), BOOK)).toBeNull();
    // No answer in hand: nothing is kept back.
    const two = start(2, ["Bear"]);
    expect(names(two, spareManaPlan(two, BOOK)!)).toEqual(["cast:Bear"]);
    // An instant or a sorcery isn't a thing to spend leftover mana on.
    expect(spareManaPlan(start(4, ["Dark Ritual", "Brainstorm"]), BOOK)).toBeNull();
  });
});

// A fifth match, a Vivi list: stuck on one land, then slow, then dead to
// attackers it never blocked.
describe("what a Vivi match showed", () => {
  const search = (name: string) => ({ type: "search" as const, target: null, player: null, amount: null, name, power: null, toughness: null, keywords: [], to: "hand" as const, tapped: null, text: null });

  // "The opponent can't pay for Drift of Phantasms yet": six mana, a three-mana
  // commander, and Mana Vault's other two mana gone with the {1} it paid.
  it("what a rock makes and a payment doesn't use floats for the next spell", () => {
    const g0 = table({ opp: { field: ["Underground Sea", "Badlands", "Volcanic Island", "Mana Vault"], hand: ["Rhystic Study", "Drift of Phantasms"] } });
    const first = cast(g0, "Rhystic Study");
    expect(first.ok).toBe(true);
    const second = cast(first.game, "Drift of Phantasms");
    expect(second.ok).toBe(true);
    expect(at(second.game, "opp", "Drift of Phantasms", "battlefield")).toBeDefined();
    // And the planner counts on it: both, from the same six mana.
    expect(names(g0, fallbackPlan(g0, BOOK)).sort()).toEqual(["cast:Drift of Phantasms", "cast:Rhystic Study"]);
  });

  // "(The opponent tried to use Drift of Phantasms, which isn't in play.)"
  it("Transmute: from the hand, for a card of the same mana value", () => {
    const g0 = table({ opp: { field: ["Underground Sea", "Underground Sea", "Underground Sea"], hand: ["Drift of Phantasms", "Dizzy Spell", "Thassa's Oracle"], top: ["Necropotence", "Demonic Consultation"] } });
    const drift = at(g0, "opp", "Drift of Phantasms")!;
    const done = applyAction(g0, "opp", act("activate", drift.iid, { mana: "{1}{U}{U}", effects: [search("Necropotence")] }), BOOK);
    expect(done.ok).toBe(true);
    expect(at(done.game, "opp", "Necropotence")).toBeDefined();
    expect(at(done.game, "opp", "Drift of Phantasms", "graveyard")).toBeDefined();
    expect(said(done.game)).toMatch(/The opponent transmutes Drift of Phantasms: it finds Necropotence/);
    // Only the same mana value: the Oracle's half costs one, the Drift three.
    expect(applyAction(g0, "opp", act("activate", drift.iid, { mana: "{1}{U}{U}", effects: [search("Demonic Consultation")] }), BOOK).ok).toBe(false);
    // The planner transmutes for the piece its combo lacks: Dizzy Spell (1) for Demonic Consultation (1).
    const plan = fallbackPlan(g0, BOOK, "opp", {}, [ORACLE]);
    const tm = plan.main.find((a) => a.kind === "activate")!;
    expect(g0.sides.opp.hand.find((c) => cardId(c.iid) === tm.card)!.name).toBe("Dizzy Spell");
    expect(tm.effects[0]).toMatchObject({ type: "search", name: "Demonic Consultation" });
    const after = applyAction(g0, "opp", tm, BOOK);
    expect(after.ok).toBe(true);
    expect(at(after.game, "opp", "Demonic Consultation")).toBeDefined();
  });

  // A 0/5 flier, untapped, and "No blocks" until it was dead.
  it("blocks when its blocker lives through it", () => {
    const g0 = table({ active: "you", you: { field: ["Bear", "Fiendish Duo"] }, opp: { field: ["Drift of Phantasms"] } });
    const attack = (...names2: string[]) => declareAttackers(g0, "you", names2.map((n) => at(g0, "you", n, "battlefield")!.iid), BOOK);
    const drift = at(g0, "opp", "Drift of Phantasms", "battlefield")!.iid;
    // The Bear (2/2) bounces off it.
    const one = attack("Bear");
    expect(chooseBlocks(one, BOOK)).toEqual({ [at(g0, "you", "Bear", "battlefield")!.iid]: [drift] });
    // Both attack: the Duo (5/5) would kill it, so it stands in front of the Bear.
    const both = attack("Bear", "Fiendish Duo");
    expect(chooseBlocks(both, BOOK)).toEqual({ [at(g0, "you", "Bear", "battlefield")!.iid]: [drift] });
    // The Duo alone, at 40 life: no block is worth the wall.
    expect(chooseBlocks(attack("Fiendish Duo"), BOOK)).toEqual({});
  });

  // Kratos punishes creatures that don't attack. The last change kept a
  // 0-power attacker home whatever was across the table.
  it("attacks with everything when not attacking is punished", () => {
    const calm = table({ opp: { field: ["Rograkh, Son of Rohgahh", "Underground Sea", "Underground Sea"], hand: ["Bear"] } });
    const war = table({ you: { field: ["War God"] }, opp: { field: ["Rograkh, Son of Rohgahh", "Command Tower", "Command Tower"], hand: ["Bear"] } });
    const id = (g: PracticeGame) => cardId(at(g, "opp", "Rograkh, Son of Rohgahh", "battlefield")!.iid);
    const plan = (g: PracticeGame) => ({ say: "", main: [], attack: [id(g)], after_combat: [] });
    expect(guardPlan(calm, plan(calm), BOOK).attack).toEqual([]);
    expect(guardPlan(war, plan(war), BOOK).attack).toEqual([id(war)]);
    expect(safeAttackers(calm, "opp", BOOK)).toEqual([]);
    // Rograkh has menace: one blocker can't stop it, so it goes.
    expect(safeAttackers(war, "opp", BOOK).map((c) => c.name)).toEqual(["Rograkh, Son of Rohgahh"]);
    // And leftover mana isn't spent on a creature that would sit there for the War God to count.
    expect(spareManaPlan(war, BOOK)).toBeNull();
  });
});
