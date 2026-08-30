// Google sign-in over the server-side authorization-code flow, with PKCE.
//
// One OAuth client serves both the website and the iOS app: the app opens
// ASWebAuthenticationSession pointed at our own /start, so from Google's side
// there is only ever a web app talking to it. That keeps the client secret on
// the server and means the iOS app ships no Google SDK.
//
// No `@/` imports — see lib/jwt.ts.

import { createHash, randomBytes } from "crypto";
import { decodeJwt, checkClaims } from "./jwt";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Google mints tokens with either spelling of the issuer.
export const GOOGLE_ISS = ["https://accounts.google.com", "accounts.google.com"];

/* The redirect_uri, which Google compares byte for byte against the console
   entry and against the value sent at authorize time. Defined once so those
   three can't drift apart. */
export const googleCallbackUrl = (origin: string) => `${origin}/api/auth/oauth/google/callback`;

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";
export const googleConfigured = () => Boolean(googleClientId() && googleClientSecret());

/* PKCE: the verifier stays on our server, only its digest travels. */
export const newVerifier = (): string => randomBytes(32).toString("base64url");

export const codeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
}

/* Where to send the browser to start the dance. */
export function authorizeUrl(p: AuthorizeParams): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", codeChallenge(p.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Always offer the account chooser: on a shared machine, silently reusing
  // whichever Google account the browser already holds is a nasty surprise.
  url.searchParams.set("prompt", "select_account");
  // We never call Google again on the user's behalf, so a refresh token would
  // be a credential we store for nothing.
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

/* PURE: read an identity out of an id_token's claims, after they've been
   checked. Google sends email_verified as a real boolean, unlike Apple. */
export function googleIdentityFromClaims(
  payload: Record<string, unknown>
): GoogleIdentity | null {
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) return null;
  const raw = payload.email;
  const name = payload.name;
  return {
    sub,
    email: typeof raw === "string" && raw ? raw.trim().toLowerCase() : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    displayName: typeof name === "string" && name.trim() ? name.trim() : null,
  };
}

export interface ExchangeInput {
  code: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
  now?: Date;
}

/* Trade the authorization code for an id_token and read the identity out.

   The id_token's signature is deliberately NOT re-verified. It arrives over
   TLS straight from Google's token endpoint, in response to a request
   carrying our client secret — the exact condition Google documents for
   skipping validation. Everything a signature would not have told us is still
   checked: issuer, audience, expiry, and the nonce that ties this token to
   the sign-in we started. */
export async function exchangeCode(input: ExchangeInput): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`google token exchange failed: ${res.status} ${body.slice(0, 300)}`);
    return null;
  }

  const payload = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!payload || typeof payload.id_token !== "string") return null;

  const parts = decodeJwt(payload.id_token);
  if (!parts) return null;

  const claims = checkClaims(parts.payload, {
    iss: GOOGLE_ISS,
    aud: googleClientId(),
    nonce: input.nonce,
    now: input.now,
  });
  if (!claims.ok) {
    console.error(`google id_token rejected: ${claims.reason}`);
    return null;
  }

  return googleIdentityFromClaims(parts.payload);
}
