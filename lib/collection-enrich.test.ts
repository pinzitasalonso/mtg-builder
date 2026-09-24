import { describe, expect, it } from "vitest";
import { isUnrecognised, planEnrichment, type CardMeta } from "./collection-enrich";

const card = (name: string): CardMeta => ({ name, colorIdentity: "U", typeLine: "Creature", manaCost: "{U}", imageUri: "https://img/" + name });
const row = (id: number, name: string, quantity = 1) => ({ id, name, nameKey: name.toLowerCase(), quantity });

describe("planEnrichment", () => {
  it("fills metadata and leaves failed lookups untouched for the next pass", () => {
    const ops = planEnrichment([row(1, "Sol Ring"), row(2, "Mana Crypt")], new Map([[1, card("Sol Ring")]]), new Set(), []);
    expect(ops).toEqual([{ kind: "update", id: 1, data: { colorIdentity: "U", typeLine: "Creature", manaCost: "{U}", imageUri: "https://img/Sol Ring", enriched: true } }]);
  });

  it("marks names Scryfall doesn't know as done, with nothing resolved", () => {
    const ops = planEnrichment([row(3, "Goblin Nonsense")], new Map(), new Set([3]), []);
    expect(ops).toEqual([{ kind: "update", id: 3, data: { enriched: true, colorIdentity: null, typeLine: null, manaCost: null, imageUri: null } }]);
  });

  it("renames a front-face name to the card's full name", () => {
    const full = "Delver of Secrets // Insectile Aberration";
    const [op] = planEnrichment([row(4, "Delver of Secrets", 2)], new Map([[4, card(full)]]), new Set(), []);
    expect(op).toMatchObject({ kind: "update", id: 4, data: { name: full, nameKey: full.toLowerCase(), enriched: true } });
  });

  it("merges into a row that already holds the canonical name", () => {
    const full = "Delver of Secrets // Insectile Aberration";
    const ops = planEnrichment([row(5, "Delver of Secrets", 2)], new Map([[5, card(full)]]), new Set(), [{ id: 9, nameKey: full.toLowerCase(), quantity: 3 }]);
    expect(ops).toEqual([
      { kind: "quantity", id: 9, quantity: 5 },
      { kind: "delete", id: 5 },
    ]);
  });

  it("merges two rows of one batch that turn out to be the same card", () => {
    const full = "Lim-Dûl's Vault";
    const ops = planEnrichment(
      [row(6, "Lim-Dul's Vault", 1), row(7, full, 2)],
      new Map([[6, card(full)], [7, card(full)]]),
      new Set(),
      []
    );
    expect(ops.filter((o) => o.kind !== "update")).toEqual([
      { kind: "quantity", id: 7, quantity: 3 },
      { kind: "delete", id: 6 },
    ]);
  });
});

describe("isUnrecognised", () => {
  it("is a row with neither a type line nor an image", () => {
    expect(isUnrecognised({ typeLine: null, imageUri: null })).toBe(true);
    expect(isUnrecognised({ typeLine: null, imageUri: "x" })).toBe(false);
  });
});
