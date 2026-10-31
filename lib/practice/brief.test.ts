import { describe, expect, it } from "vitest";
import { cleanPlan, PLAN_SCHEMA, sinceLastTurn, systemPrompt, turnBrief } from "./brief";
import { cardId, endTurn, newGame, startTurn, type DeckCard } from "./game";
import type { CardBook, CardInfo, PracticeGame } from "./types";

const keep = <T,>(a: T[]) => [...a];
const info = (name: string, o: Partial<CardInfo> = {}): CardInfo => ({ name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o });
const BOOK: CardBook = Object.fromEntries(
  [
    info("Forest", { typeLine: "Basic Land — Forest", producedMana: ["G"] }),
    info("Grizzly Bears", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Craw Wurm", { manaCost: "{4}{G}{G}", manaValue: 6, power: 6, toughness: 4, keywords: ["Trample"] }),
    info("Lightning Bolt", { typeLine: "Instant", manaCost: "{R}", oracleText: "Lightning Bolt deals 3 damage to any target." }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));

function game(): PracticeGame {
  let g = newGame({
    you: { cards: deck("Craw Wurm", ...Array(15).fill("Forest")) },
    opp: { cards: deck("Grizzly Bears", "Craw Wurm", "Forest", "Forest", ...Array(12).fill("Forest")) },
    commanderGame: false,
    first: "you",
    shuffle: keep,
  });
  g = startTurn(g);
  // Your Craw Wurm in play; the AI has two Forests out.
  const wurm = g.sides.you.hand.find((c) => c.name === "Craw Wurm")!;
  g.sides.you = { ...g.sides.you, hand: g.sides.you.hand.filter((c) => c !== wurm), battlefield: [{ ...wurm, enteredTurn: 1 }] };
  g = endTurn(g);
  const forests = g.sides.opp.hand.filter((c) => c.name === "Forest").slice(0, 2);
  g.sides.opp = { ...g.sides.opp, hand: g.sides.opp.hand.filter((c) => !forests.includes(c)), battlefield: forests.map((f) => ({ ...f, enteredTurn: 0 })) };
  return g;
}

describe("the model's brief", () => {
  it("puts the rules and the deck's card text in the cached prefix", () => {
    const { rules, deck: list } = systemPrompt([{ name: "Lightning Bolt", quantity: 4 }, { name: "Forest", quantity: 20 }], BOOK, null);
    expect(rules).toMatch(/Never invent an effect/);
    expect(list).toContain("- 4× Lightning Bolt {R} — Instant — Lightning Bolt deals 3 damage to any target.");
    expect(list.indexOf("Forest")).toBeLessThan(list.indexOf("Lightning Bolt"));
  });

  it("says what's castable now, the mana, and both boards with ids", () => {
    const g = game();
    const brief = turnBrief(g, BOOK, sinceLastTurn(g));
    const bears = g.sides.opp.hand.find((c) => c.name === "Grizzly Bears")!;
    const wurm = g.sides.opp.hand.find((c) => c.name === "Craw Wurm")!;
    expect(brief).toContain(`${cardId(bears.iid)} Grizzly Bears {1}{G} (Creature) — you can pay for it now`);
    expect(brief).toContain(`${cardId(wurm.iid)} Craw Wurm {4}{G}{G} (Creature) — can't pay for it yet`);
    expect(brief).toContain("YOUR MANA RIGHT NOW: 2 mana: G, G.");
    expect(brief).toMatch(/THE PLAYER'S BATTLEFIELD:\n- c\d+ Craw Wurm \(Creature\) 6\/4, Trample, untapped/);
    expect(brief).toContain("Land drop: available.");
    expect(brief).toContain("SINCE YOUR LAST TURN:\n- Turn 1 — your turn.");
  });
});

describe("cleaning the plan", () => {
  it("keeps known shapes, drops junk and clamps numbers", () => {
    const plan = cleanPlan({
      main: [
        { kind: "cast", card: "c10002", x: 999, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [{ type: "damage", target: "player", amount: 500, keywords: [] }, { type: "explode" }] },
        { kind: "dance", card: "c1" },
        { kind: "land", card: "Forest" },
      ],
      attack: ["c10003", "nope", 7],
      after_combat: "x",
      say: "x".repeat(500),
    })!;
    expect(plan.main).toHaveLength(1);
    expect(plan.main[0]!.x).toBe(30);
    expect(plan.main[0]!.effects).toEqual([expect.objectContaining({ type: "damage", target: "player", amount: 99 })]);
    expect(plan.attack).toEqual(["c10003"]);
    expect(plan.after_combat).toEqual([]);
    expect(plan.say).toHaveLength(120);
    expect(cleanPlan("nope")).toBeNull();
  });

  it("asks for a strict schema: every object closed, every field required", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(PLAN_SCHEMA);
  });
});
