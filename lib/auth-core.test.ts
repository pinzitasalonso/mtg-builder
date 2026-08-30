import { describe, expect, it } from "vitest";
import {
  EMAIL_RE,
  hashPassword,
  normalizeEmail,
  requestOrigin,
  safeNextPath,
  tokenHash,
  newToken,
  verifyPassword,
} from "./auth-core";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects the wrong password", () => {
    expect(verifyPassword("nope", hashPassword("secret123"))).toBe(false);
  });

  // OAuth-only accounts have no password. They must fail, not throw, and not
  // fail fast enough to be distinguishable from a wrong password.
  it("rejects a null hash", () => {
    expect(verifyPassword("anything", null)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    for (const junk of ["", "x", "s1", "s1:abc:x:y", "s2:16384:a:b", "::::"]) {
      expect(verifyPassword("pw", junk)).toBe(false);
    }
  });

  // N is parsed out of the stored string. An absurd value would hang the
  // process on scrypt rather than returning, so it is clamped.
  it("refuses an out-of-range work factor instead of honoring it", () => {
    const real = hashPassword("pw");
    const [, , salt, hash] = real.split(":");
    expect(verifyPassword("pw", `s1:999999999:${salt}:${hash}`)).toBe(false);
    expect(verifyPassword("pw", `s1:2:${salt}:${hash}`)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Kike@Spellpool.COM ")).toBe("kike@spellpool.com");
  });
  it("turns anything that isn't a string into an empty string", () => {
    for (const junk of [undefined, null, 42, {}, []]) expect(normalizeEmail(junk)).toBe("");
  });
});

describe("EMAIL_RE", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@b.co", "kike+tag@spellpool.com", "x.y@sub.domain.org"]) {
      expect(EMAIL_RE.test(ok)).toBe(true);
    }
  });
  it("rejects the obvious failures", () => {
    for (const bad of ["", "a@b", "no-at-sign.com", "a b@c.com", "a@ b.com", "@b.co"]) {
      expect(EMAIL_RE.test(bad)).toBe(false);
    }
  });
});

describe("tokenHash / newToken", () => {
  it("is stable and 64 hex chars", () => {
    expect(tokenHash("abc")).toBe(tokenHash("abc"));
    expect(tokenHash("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("mints distinct base64url tokens", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(newToken());
  });
});

describe("requestOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

  it("prefers APP_URL and strips its trailing slashes", () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://www.spellpool.com///";
    expect(requestOrigin(req({ host: "ignored.example" }))).toBe("https://www.spellpool.com");
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  });

  it("falls back to the forwarded headers, then host", () => {
    const prev = process.env.APP_URL;
    delete process.env.APP_URL;
    expect(
      requestOrigin(req({ "x-forwarded-proto": "https", "x-forwarded-host": "a.example" }))
    ).toBe("https://a.example");
    expect(requestOrigin(req({ host: "b.example" }))).toBe("http://b.example");
    expect(requestOrigin(req({}))).toBe("http://localhost:3000");
    if (prev !== undefined) process.env.APP_URL = prev;
  });
});

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/decks/abc")).toBe("/decks/abc");
  });

  // "//evil.com" is protocol-relative: the browser leaves the site. Checking
  // only for a leading "/" would let it through.
  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/\\evil.com",
      "/ok\nSet-Cookie: x",
      "decks",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad as string | null | undefined)).toBe("/");
    }
  });
});
