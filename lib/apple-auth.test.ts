import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, type JsonWebKey } from "crypto";
import {
  APPLE_ISS,
  appleAudience,
  appleIdentityFromClaims,
  verifyAppleIdentityToken,
} from "./apple-auth";
import { __clearJwksCache } from "./jwks";

describe("appleIdentityFromClaims", () => {
  const base = { sub: "001234.abcdef.0000", email: "kike@example.com" };

  // Apple sends these as a boolean OR the string "true", depending on the
  // flow. Treating "true" as false would mark every relay user unverified.
  it("accepts email_verified as a boolean and as a string", () => {
    expect(appleIdentityFromClaims({ ...base, email_verified: true })?.emailVerified).toBe(true);
    expect(appleIdentityFromClaims({ ...base, email_verified: "true" })?.emailVerified).toBe(true);
  });

  it("treats anything else as unverified", () => {
    for (const v of ["false", false, undefined, null, 1, "yes"]) {
      expect(appleIdentityFromClaims({ ...base, email_verified: v })?.emailVerified).toBe(false);
    }
  });

  it("spots a relay address from the claim, in either form", () => {
    expect(appleIdentityFromClaims({ ...base, is_private_email: "true" })?.isPrivateRelay).toBe(true);
    expect(appleIdentityFromClaims({ ...base, is_private_email: true })?.isPrivateRelay).toBe(true);
  });

  // On a repeat sign-in the claim can be absent while the address still is a
  // relay, so the domain has to settle it too.
  it("spots a relay address from the domain alone", () => {
    const id = appleIdentityFromClaims({ sub: "x", email: "abc123@privaterelay.appleid.com" });
    expect(id?.isPrivateRelay).toBe(true);
  });

  it("does not mistake an ordinary address for a relay", () => {
    expect(appleIdentityFromClaims(base)?.isPrivateRelay).toBe(false);
  });

  it("normalizes the address", () => {
    expect(appleIdentityFromClaims({ sub: "x", email: "  Kike@Example.COM " })?.email).toBe(
      "kike@example.com"
    );
  });

  // Apple sends the address only on the FIRST authorization. Every later
  // token is sub-only, and that is a perfectly good identity.
  it("accepts a token with no email at all", () => {
    const id = appleIdentityFromClaims({ sub: "001234.abcdef.0000" });
    expect(id).toMatchObject({ sub: "001234.abcdef.0000", email: null, emailVerified: false });
  });

  it("rejects claims with no subject", () => {
    expect(appleIdentityFromClaims({ email: "a@b.co" })).toBeNull();
    expect(appleIdentityFromClaims({ sub: "" })).toBeNull();
    expect(appleIdentityFromClaims({ sub: 42 })).toBeNull();
  });
});

describe("verifyAppleIdentityToken", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid: "apple-k1" };
  const now = new Date("2026-08-30T12:00:00Z");
  const t = Math.floor(now.getTime() / 1000);

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  function mint(payload: Record<string, unknown>, kid = "apple-k1") {
    const input = `${b64({ alg: "RS256", kid })}.${b64(payload)}`;
    return `${input}.${cryptoSign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
  }
  const claims = {
    iss: APPLE_ISS,
    aud: "com.ios.spellpool",
    sub: "001234.abcdef.0000",
    email: "kike@example.com",
    email_verified: "true",
    iat: t - 5,
    exp: t + 600,
  };

  beforeEach(() => {
    __clearJwksCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "max-age=3600" },
      json: async () => ({ keys: [jwk] }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  const opts = { audience: "com.ios.spellpool", now };

  it("accepts a genuine token", async () => {
    const id = await verifyAppleIdentityToken(mint(claims), opts);
    expect(id).toMatchObject({ sub: "001234.abcdef.0000", email: "kike@example.com", emailVerified: true });
  });

  it("rejects a token minted for a different app", async () => {
    expect(await verifyAppleIdentityToken(mint({ ...claims, aud: "com.other.app" }), opts)).toBeNull();
  });

  it("rejects a token signed by someone else", async () => {
    const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const input = `${b64({ alg: "RS256", kid: "apple-k1" })}.${b64(claims)}`;
    const forged = `${input}.${cryptoSign("sha256", Buffer.from(input), impostor.privateKey).toString("base64url")}`;
    expect(await verifyAppleIdentityToken(forged, opts)).toBeNull();
  });

  it("rejects an unknown signing key", async () => {
    expect(await verifyAppleIdentityToken(mint(claims, "not-apples"), opts)).toBeNull();
  });

  it("rejects an expired token, and one too old to trust", async () => {
    expect(await verifyAppleIdentityToken(mint({ ...claims, exp: t - 3600 }), opts)).toBeNull();
    // Signed an hour ago but still unexpired — refused on age.
    expect(
      await verifyAppleIdentityToken(mint({ ...claims, iat: t - 3600, exp: t + 600 }), opts)
    ).toBeNull();
  });

  it("checks the nonce when one is expected", async () => {
    const withNonce = mint({ ...claims, nonce: "hashed-nonce" });
    expect(await verifyAppleIdentityToken(withNonce, { ...opts, nonce: "hashed-nonce" })).not.toBeNull();
    expect(await verifyAppleIdentityToken(withNonce, { ...opts, nonce: "different" })).toBeNull();
    // A token carrying no nonce cannot satisfy one we demand.
    expect(await verifyAppleIdentityToken(mint(claims), { ...opts, nonce: "wanted" })).toBeNull();
  });

  it("rejects unsigned and malformed tokens", async () => {
    const unsigned = `${b64({ alg: "none", kid: "apple-k1" })}.${b64(claims)}.`;
    expect(await verifyAppleIdentityToken(unsigned, opts)).toBeNull();
    expect(await verifyAppleIdentityToken("nonsense", opts)).toBeNull();
    expect(await verifyAppleIdentityToken("", opts)).toBeNull();
  });

  it("propagates an outage rather than reporting a bad token", async () => {
    __clearJwksCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("apple is down"); }));
    await expect(verifyAppleIdentityToken(mint(claims), opts)).rejects.toThrow();
  });
});

describe("appleAudience", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to the app's bundle id", () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "");
    expect(appleAudience()).toBe("com.ios.spellpool");
  });
  it("can be overridden", () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.ios.spellpool.beta");
    expect(appleAudience()).toBe("com.ios.spellpool.beta");
  });
});
