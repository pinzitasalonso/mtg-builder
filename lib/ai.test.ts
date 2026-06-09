import { describe, expect, it } from "vitest";
import { extractJson, strArr } from "./ai";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside ```json fences", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON inside bare ``` fences", () => {
    expect(extractJson('```\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
  });

  it("parses JSON wrapped in prose", () => {
    expect(extractJson('Sure! The result is {"cards": ["Sol Ring"]} — enjoy.')).toEqual({
      cards: ["Sol Ring"],
    });
  });

  it("handles nested braces", () => {
    expect(extractJson('{"a": {"b": 2}}')).toEqual({ a: { b: 2 } });
  });

  it("returns null when there is no JSON object", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("")).toBeNull();
  });

  it("returns null for irreparably broken JSON", () => {
    expect(extractJson('{"a": unquoted}')).toBeNull();
  });
});

describe("strArr", () => {
  it("keeps trimmed non-empty strings", () => {
    expect(strArr([" a ", "b", "", "  ", 3, null, "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns [] for non-arrays", () => {
    expect(strArr(null)).toEqual([]);
    expect(strArr("a")).toEqual([]);
    expect(strArr({ 0: "a" })).toEqual([]);
  });
});
