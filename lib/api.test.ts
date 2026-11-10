import { describe, expect, it } from "vitest";
import { cleanCardInput, isCardImage, jsonBody, parseId } from "./api";

describe("parseId", () => {
  it("takes positive integers only", () => {
    expect(parseId("12")).toBe(12);
    for (const bad of ["abc", "1.5", "-2", "", "0"]) expect(parseId(bad)).toBeNull();
  });
});

describe("jsonBody", () => {
  const req = (body: string) => new Request("http://x/", { method: "POST", body });
  it("is the body when it's an object, and {} for anything else", async () => {
    expect(await jsonBody(req('{"a":1}'))).toEqual({ a: 1 });
    for (const bad of ["null", "[1,2]", '"text"', "7", "{broken", ""]) expect(await jsonBody(req(bad))).toEqual({});
  });
});

describe("card input", () => {
  const img = "https://cards.scryfall.io/normal/front/a/b/abc.jpg?1";
  it("accepts Scryfall's and Gatherer's images, nothing else", () => {
    expect(isCardImage(img)).toBe(true);
    expect(isCardImage("https://api.scryfall.com/cards/named?exact=Sol+Ring&format=image")).toBe(true);
    expect(isCardImage("https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=1")).toBe(true);
    for (const bad of ["https://tracker.example/x.png", "http://cards.scryfall.io/x.jpg", "https://scryfall.io.evil.example/x.jpg", "javascript:alert(1)", "", null, 5, `${img}${"x".repeat(700)}`]) {
      expect(isCardImage(bad)).toBe(false);
    }
  });

  it("keeps a card's fields, cut to a card's size", () => {
    const c = cleanCardInput({ scryfallId: "id-1", name: "Sol Ring", imageUri: img, manaCost: "{1}", typeLine: "Artifact", oracleText: "x".repeat(9000), extra: "ignored" });
    expect(c).toMatchObject({ scryfallId: "id-1", name: "Sol Ring", imageUri: img, manaCost: "{1}", typeLine: "Artifact" });
    expect(c!.oracleText).toHaveLength(6000);
    expect(Object.keys(c!)).not.toContain("extra");
  });

  it("refuses a card with no id, no name, a name longer than any card's, or someone else's image", () => {
    const ok = { scryfallId: "id-1", name: "Sol Ring", imageUri: img };
    expect(cleanCardInput(ok)).not.toBeNull();
    expect(cleanCardInput({ ...ok, scryfallId: "" })).toBeNull();
    expect(cleanCardInput({ ...ok, name: "  " })).toBeNull();
    expect(cleanCardInput({ ...ok, name: "x".repeat(400) })).toBeNull();
    expect(cleanCardInput({ ...ok, imageUri: "https://tracker.example/x.png" })).toBeNull();
    expect(cleanCardInput(null)).toBeNull();
    expect(cleanCardInput("card")).toBeNull();
  });
});
