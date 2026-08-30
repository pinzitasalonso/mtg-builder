// Just enough JWT to verify an identity token from Apple: RS256, nothing else.
// Node's crypto already does the signature maths — createPublicKey imports a
// JWK directly — so this is the parsing and the claim checks around it, kept
// pure and separately testable. That is where the bugs in this kind of code
// actually live.
//
// No `@/` imports: there is no vitest config, so no path alias resolves under
// the test runner.

// Node's JsonWebKey, not the DOM one — they are structurally different and
// only Node's is accepted by createPublicKey.
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "crypto";

export type { JsonWebKey };

export interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

export interface JwtParts {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: string; // "<header>.<payload>", exactly as it was signed
  signature: Buffer;
}

function decodeSegment(seg: string): unknown {
  try {
    return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/* Parse only — no trust decisions of any kind. Returns null on anything
   malformed, so callers never see a half-built token. */
export function decodeJwt(token: string): JwtParts | null {
  if (typeof token !== "string") return null;
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  const [h, p, s] = segments as [string, string, string];
  if (!h || !p || !s) return null;

  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  if (!isObject(header) || !isObject(payload)) return null;

  return {
    header: header as JwtHeader,
    payload,
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

/* RS256 and nothing else. The algorithm is checked against a literal before a
   key is ever loaded, so a token cannot talk us into "none", into HMAC (where
   the public key becomes the secret), or into a different padding scheme. */
export function verifyJwtSignature(parts: JwtParts, jwk: JsonWebKey): boolean {
  if (parts.header.alg !== "RS256") return false;
  if (parts.signature.length === 0) return false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (key.asymmetricKeyType !== "rsa") return false;
    return cryptoVerify("sha256", Buffer.from(parts.signingInput), key, parts.signature);
  } catch {
    return false;
  }
}

export interface ClaimExpectations {
  iss: string | string[];
  aud: string | string[];
  nonce?: string;
  now?: Date; // injectable so expiry is testable without faking the clock
  leewaySec?: number; // clock skew allowance, default 60
  maxAgeSec?: number; // optional bound on how old `iat` may be
}

export type ClaimResult = { ok: true } | { ok: false; reason: string };

const asList = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);

/* The checks that actually decide whether a correctly-signed token is one we
   asked for. A valid signature from Apple on a token minted for somebody
   else's app is still a valid signature. */
export function checkClaims(
  payload: Record<string, unknown>,
  expect: ClaimExpectations
): ClaimResult {
  const now = Math.floor((expect.now?.getTime() ?? Date.now()) / 1000);
  const leeway = expect.leewaySec ?? 60;

  const iss = payload.iss;
  if (typeof iss !== "string" || !asList(expect.iss).includes(iss)) {
    return { ok: false, reason: "iss" };
  }

  // `aud` is a string or an array of them, per RFC 7519.
  const audClaim = payload.aud;
  const audValues = Array.isArray(audClaim) ? audClaim : [audClaim];
  const wanted = asList(expect.aud);
  if (!audValues.some((a) => typeof a === "string" && wanted.includes(a))) {
    return { ok: false, reason: "aud" };
  }

  const exp = payload.exp;
  if (typeof exp !== "number") return { ok: false, reason: "exp-missing" };
  if (now > exp + leeway) return { ok: false, reason: "expired" };

  const iat = payload.iat;
  if (typeof iat === "number") {
    if (iat - leeway > now) return { ok: false, reason: "iat-future" };
    // Bounding the age is what actually limits replay: a stolen token stays
    // signed and unexpired for as long as the issuer said it would.
    if (expect.maxAgeSec !== undefined && now - iat > expect.maxAgeSec + leeway) {
      return { ok: false, reason: "stale" };
    }
  } else if (expect.maxAgeSec !== undefined) {
    return { ok: false, reason: "iat-missing" };
  }

  if (expect.nonce !== undefined && payload.nonce !== expect.nonce) {
    return { ok: false, reason: "nonce" };
  }

  return { ok: true };
}
