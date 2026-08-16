import { describe, expect, it } from "vitest";
import { isPro } from "./limits";

// The record route's two decisions, as pure predicates. The route itself needs
// a database and a session, but WHO gets a log written is a rule worth pinning
// in isolation — it is the half that used to live in the iOS client, where any
// other caller could ignore it.

/** Whether a finished game should have its detail kept. */
function shouldLog(
  user: { id: number; tier?: string | null } | null,
  deck: { userId: number | null }
): boolean {
  return isPro(user) && user?.id != null && deck.userId === user.id;
}

/** Opponent names in, the stored JSON out. Mirrors the route's helper. */
function opponentsJson(value: unknown): string {
  const names = Array.isArray(value)
    ? value.filter((n): n is string => typeof n === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean).slice(0, 12));
}

describe("who gets a game log", () => {
  const pro = { id: 1, tier: "pro" };
  const free = { id: 1, tier: "free" };
  const mine = { userId: 1 };

  // The whole point of moving the gate off the client: the counters are free,
  // the log behind them is not, and a client-side check is a suggestion.
  it("keeps the log for a pro owner and nobody else", () => {
    expect(shouldLog(pro, mine)).toBe(true);
    expect(shouldLog(free, mine)).toBe(false);
    expect(shouldLog(null, mine)).toBe(false);
  });

  // A play-code result reported by a FRIEND'S tracker still bumps the deck's
  // counters — that is the deck's record — but it is not the friend's history
  // to write, and they may not even be pro.
  it("never writes someone else's history onto a deck they don't own", () => {
    expect(shouldLog({ id: 2, tier: "pro" }, mine)).toBe(false);
    // A deck with no owner at all (pre-auth rows) has no history keeper.
    expect(shouldLog(pro, { userId: null })).toBe(false);
  });
});

describe("opponentsJson", () => {
  it("takes an array or a comma-separated line, the way both clients send", () => {
    expect(opponentsJson(["Atraxa", "Krenko"])).toBe('["Atraxa","Krenko"]');
    expect(opponentsJson("Atraxa, Krenko")).toBe('["Atraxa","Krenko"]');
  });

  it("drops blanks so a trailing comma isn't an empty opponent", () => {
    expect(opponentsJson("Atraxa, ,Krenko,")).toBe('["Atraxa","Krenko"]');
    expect(opponentsJson(["", "  "])).toBe("[]");
  });

  it("is always valid JSON, whatever arrives", () => {
    for (const input of [null, undefined, 42, {}, [1, 2, 3]]) {
      expect(() => JSON.parse(opponentsJson(input))).not.toThrow();
    }
  });

  // A pod is at most a few seats; a client sending hundreds is a bug or an
  // attack, and either way the column shouldn't grow without bound.
  it("caps a runaway list", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Deck ${i}`);
    expect(JSON.parse(opponentsJson(many))).toHaveLength(12);
  });
});
