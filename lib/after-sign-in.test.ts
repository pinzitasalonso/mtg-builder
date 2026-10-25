import { describe, expect, it } from "vitest";
import { parseAfterSignIn } from "./after-sign-in";

describe("parseAfterSignIn", () => {
  it("accepts the new-deck step and paths on this site", () => {
    expect(parseAfterSignIn("new")).toBe("new");
    expect(parseAfterSignIn("/deck/abc123")).toBe("/deck/abc123");
  });

  it("refuses other sites and anything else", () => {
    expect(parseAfterSignIn("//evil.example/deck")).toBeNull();
    expect(parseAfterSignIn("/\\evil.example")).toBeNull();
    expect(parseAfterSignIn("https://evil.example")).toBeNull();
    expect(parseAfterSignIn("javascript:alert(1)")).toBeNull();
    expect(parseAfterSignIn("")).toBeNull();
    expect(parseAfterSignIn(null)).toBeNull();
  });
});
