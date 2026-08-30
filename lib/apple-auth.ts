// Verifying a Sign in with Apple identity token.
//
// The native iOS flow hands us a token the app got from Apple, so it must be
// checked against Apple's published keys — but that is ALL it needs. There is
// no Services ID, no .p8 key and no client-secret JWT here, because the
// audience of a native token is the app's bundle id. That is the whole reason
// this design asks Kike for one checkbox in the developer portal instead of a
// key rotation story.
//
// No `@/` imports — see lib/jwt.ts.

import { checkClaims, decodeJwt, verifyJwtSignature } from "./jwt";
import { getSigningKey } from "./jwks";

export const APPLE_ISS = "https://appleid.apple.com";
export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com";

// A token older than this is refused even if Apple says it is still valid.
// Expiry alone is what bounds replay otherwise, and Apple's is generous.
const MAX_TOKEN_AGE_SEC = 10 * 60;

export interface AppleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelay: boolean;
}

/* Apple sends these as either a real boolean or the STRING "true". Comparing
   with === true silently marks every Hide My Email user unverified, which
   then denies them account linking for a reason that isn't real. */
function appleBool(value: unknown): boolean {
  return value === true || value === "true";
}

/* PURE: read an identity out of already-verified claims. Split from the
   verification so the claim-shape quirks above are testable on their own. */
export function appleIdentityFromClaims(payload: Record<string, unknown>): AppleIdentity | null {
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) return null;

  const raw = payload.email;
  const email = typeof raw === "string" && raw ? raw.trim().toLowerCase() : null;

  return {
    sub,
    email,
    emailVerified: appleBool(payload.email_verified),
    // The claim is authoritative, but the domain settles it either way — and
    // on a repeat sign-in the claim may be absent while the address is not.
    isPrivateRelay:
      appleBool(payload.is_private_email) || (email?.endsWith(`@${APPLE_RELAY_DOMAIN}`) ?? false),
  };
}

export interface VerifyAppleOptions {
  audience: string;
  nonce?: string;
  now?: Date;
}

/* Verify an identity token end to end: parse, find the key by kid, check the
   RS256 signature, then check the claims.

   Returns null for every failure without saying which. The caller answers
   with one generic message: a client that can tell "wrong audience" from
   "bad signature" is being handed a probe. Throws only when Apple's keys are
   unreachable, which is a 503 rather than a rejection. */
export async function verifyAppleIdentityToken(
  idToken: string,
  opts: VerifyAppleOptions
): Promise<AppleIdentity | null> {
  const parts = decodeJwt(idToken);
  if (!parts || parts.header.alg !== "RS256" || !parts.header.kid) return null;

  const jwk = await getSigningKey(APPLE_JWKS_URL, parts.header.kid);
  if (!jwk) return null;

  if (!verifyJwtSignature(parts, jwk)) return null;

  const claims = checkClaims(parts.payload, {
    iss: APPLE_ISS,
    aud: opts.audience,
    nonce: opts.nonce,
    now: opts.now,
    maxAgeSec: MAX_TOKEN_AGE_SEC,
  });
  if (!claims.ok) return null;

  return appleIdentityFromClaims(parts.payload);
}

/* The bundle id a native token must be addressed to. */
export function appleAudience(): string {
  return process.env.APPLE_BUNDLE_ID || "com.ios.spellpool";
}
