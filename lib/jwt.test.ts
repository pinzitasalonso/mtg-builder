import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, type JsonWebKey } from "crypto";
import { checkClaims, decodeJwt, verifyJwtSignature } from "./jwt";

// A real RSA keypair, so these tests exercise the same path an Apple token
// takes rather than a stand-in for it.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function mint(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "k1" },
  key = privateKey
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = cryptoSign("sha256", Buffer.from(input), key).toString("base64url");
  return `${input}.${sig}`;
}

describe("decodeJwt", () => {
  it("parses a well-formed token", () => {
    const parts = decodeJwt(mint({ sub: "abc", iss: "https://appleid.apple.com" }));
    expect(parts?.header.alg).toBe("RS256");
    expect(parts?.header.kid).toBe("k1");
    expect(parts?.payload.sub).toBe("abc");
  });

  it("returns null for anything malformed", () => {
    const goodPayload = b64({ sub: "a" });
    for (const junk of [
      "",
      "one.two",
      "a.b.c.d",
      `not-base64url!.${goodPayload}.sig`,
      `${b64({ alg: "RS256" })}.${Buffer.from("not json").toString("base64url")}.sig`,
      // A JSON array is valid JSON but not a claims object.
      `${b64({ alg: "RS256" })}.${b64([1, 2])}.sig`,
      "..",
    ]) {
      expect(decodeJwt(junk)).toBeNull();
    }
    expect(decodeJwt(undefined as unknown as string)).toBeNull();
  });
});

describe("verifyJwtSignature", () => {
  it("accepts a genuine signature", () => {
    expect(verifyJwtSignature(decodeJwt(mint({ sub: "abc" }))!, jwk)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = mint({ sub: "abc", email: "real@example.com" });
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64({ sub: "abc", email: "attacker@example.com" })}.${s}`;
    expect(verifyJwtSignature(decodeJwt(forged)!, jwk)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const token = mint({ sub: "abc" }, { alg: "RS256", kid: "k1" }, other.privateKey);
    expect(verifyJwtSignature(decodeJwt(token)!, jwk)).toBe(false);
  });

  // The classic JWT bypasses. Each is refused on the algorithm alone, before
  // any key is loaded — so none of them can reach the crypto at all.
  it("refuses every algorithm that is not literally RS256", () => {
    for (const alg of ["none", "None", "NONE", "HS256", "PS256", "RS512", "ES256", ""]) {
      const token = mint({ sub: "abc" }, { alg, kid: "k1" });
      expect(verifyJwtSignature(decodeJwt(token)!, jwk)).toBe(false);
    }
    const noAlg = mint({ sub: "abc" }, { kid: "k1" });
    expect(verifyJwtSignature(decodeJwt(noAlg)!, jwk)).toBe(false);
  });

  it("rejects an empty signature", () => {
    const parts = decodeJwt(mint({ sub: "abc" }))!;
    expect(verifyJwtSignature({ ...parts, signature: Buffer.alloc(0) }, jwk)).toBe(false);
  });

  it("rejects a key that isn't RSA, and junk keys, without throwing", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecJwk = ec.publicKey.export({ format: "jwk" }) as JsonWebKey;
    const parts = decodeJwt(mint({ sub: "abc" }))!;
    expect(verifyJwtSignature(parts, ecJwk)).toBe(false);
    expect(verifyJwtSignature(parts, {} as JsonWebKey)).toBe(false);
  });
});

describe("checkClaims", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const t = (d: Date) => Math.floor(d.getTime() / 1000);
  const base = {
    iss: "https://appleid.apple.com",
    aud: "com.ios.spellpool",
    exp: t(now) + 600,
    iat: t(now) - 10,
  };
  const expected = { iss: "https://appleid.apple.com", aud: "com.ios.spellpool", now };

  it("accepts a token we asked for", () => {
    expect(checkClaims(base, expected)).toEqual({ ok: true });
  });

  // A valid Apple signature on a token minted for a different app is still a
  // valid signature. `aud` is the only thing that makes it ours.
  it("rejects another app's audience", () => {
    expect(checkClaims({ ...base, aud: "com.someone.else" }, expected)).toEqual({
      ok: false,
      reason: "aud",
    });
  });

  it("rejects a wrong or missing issuer", () => {
    expect(checkClaims({ ...base, iss: "https://evil.example" }, expected).ok).toBe(false);
    const { iss: _iss, ...noIss } = base;
    expect(checkClaims(noIss, expected).ok).toBe(false);
  });

  it("accepts an issuer or audience matched out of a list", () => {
    expect(
      checkClaims(base, { ...expected, iss: ["https://accounts.google.com", base.iss] })
    ).toEqual({ ok: true });
    expect(checkClaims({ ...base, aud: ["x", "com.ios.spellpool"] }, expected)).toEqual({
      ok: true,
    });
  });

  it("rejects an expired token but forgives clock skew", () => {
    expect(checkClaims({ ...base, exp: t(now) - 600 }, expected)).toEqual({
      ok: false,
      reason: "expired",
    });
    // 30s past expiry, inside the 60s leeway.
    expect(checkClaims({ ...base, exp: t(now) - 30 }, expected)).toEqual({ ok: true });
  });

  it("requires exp at all", () => {
    const { exp: _exp, ...noExp } = base;
    expect(checkClaims(noExp, expected)).toEqual({ ok: false, reason: "exp-missing" });
  });

  it("bounds how old a token may be when asked to", () => {
    const old = { ...base, iat: t(now) - 3600 };
    expect(checkClaims(old, { ...expected, maxAgeSec: 600 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(checkClaims(base, { ...expected, maxAgeSec: 600 })).toEqual({ ok: true });
    // Without iat there is nothing to bound, so the demand can't be satisfied.
    const { iat: _iat, ...noIat } = base;
    expect(checkClaims(noIat, { ...expected, maxAgeSec: 600 }).ok).toBe(false);
  });

  it("rejects a token minted in the future", () => {
    expect(checkClaims({ ...base, iat: t(now) + 600 }, expected)).toEqual({
      ok: false,
      reason: "iat-future",
    });
  });

  // The nonce is what ties a token to the sign-in attempt in front of us; a
  // replayed one is otherwise perfectly valid.
  it("checks the nonce when one is expected", () => {
    expect(checkClaims({ ...base, nonce: "abc" }, { ...expected, nonce: "abc" })).toEqual({
      ok: true,
    });
    expect(checkClaims({ ...base, nonce: "xyz" }, { ...expected, nonce: "abc" })).toEqual({
      ok: false,
      reason: "nonce",
    });
    // Missing entirely must fail too, not pass by absence.
    expect(checkClaims(base, { ...expected, nonce: "abc" })).toEqual({
      ok: false,
      reason: "nonce",
    });
  });
});
