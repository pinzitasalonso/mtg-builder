import { describe, expect, it } from "vitest";
import { jsonWithEtag } from "./http-cache";

const get = (inm?: string) => new Request("http://x/api/decks", inm ? { headers: { "If-None-Match": inm } } : undefined);

describe("jsonWithEtag", () => {
  it("sends the data with a tag the browser must re-check", async () => {
    const res = jsonWithEtag(get(), { a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toMatch(/^W\/".+"$/);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("answers 304 with no body when nothing changed", async () => {
    const tag = jsonWithEtag(get(), { a: 1 }).headers.get("ETag")!;
    const res = jsonWithEtag(get(tag), { a: 1 });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("sends the new data when it changed", () => {
    const tag = jsonWithEtag(get(), { a: 1 }).headers.get("ETag")!;
    expect(jsonWithEtag(get(tag), { a: 2 }).status).toBe(200);
  });

  it("matches a tag in a list", () => {
    const tag = jsonWithEtag(get(), [1, 2]).headers.get("ETag")!;
    expect(jsonWithEtag(get(`W/"other", ${tag}`), [1, 2]).status).toBe(304);
  });
});
