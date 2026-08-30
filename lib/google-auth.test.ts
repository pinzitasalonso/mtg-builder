import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  codeChallenge,
  exchangeCode,
  googleConfigured,
  googleIdentityFromClaims,
  newVerifier,
} from "./google-auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PKCE", () => {
  // The published S256 example from RFC 7636 appendix B. If this drifts,
  // Google rejects every exchange with invalid_grant.
  it("matches the RFC 7636 test vector", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("mints distinct base64url verifiers of a usable length", () => {
    const v = newVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43); // RFC 7636 minimum
    expect(v).not.toBe(newVerifier());
  });
});

describe("authorizeUrl", () => {
  const params = {
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: "https://www.spellpool.com/api/auth/oauth/google/callback",
    state: "st",
    nonce: "no",
    verifier: "ver",
  };

  it("carries everything Google needs, correctly encoded", () => {
    const url = new URL(authorizeUrl(params));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(params.clientId);
    expect(q.get("redirect_uri")).toBe(params.redirectUri);
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("state")).toBe("st");
    expect(q.get("nonce")).toBe("no");
    expect(q.get("code_challenge")).toBe(codeChallenge("ver"));
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  // The verifier must never leave the server; only its digest may.
  it("sends the challenge, never the verifier", () => {
    expect(authorizeUrl(params)).not.toContain("ver&");
    expect(new URL(authorizeUrl(params)).searchParams.get("code_verifier")).toBeNull();
  });

  it("always offers the account chooser and asks for no refresh token", () => {
    const q = new URL(authorizeUrl(params)).searchParams;
    expect(q.get("prompt")).toBe("select_account");
    expect(q.get("access_type")).toBe("online");
  });
});

describe("googleConfigured", () => {
  it("needs both halves of the credential", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    expect(googleConfigured()).toBe(true);
  });
});

describe("googleIdentityFromClaims", () => {
  it("reads a normal profile", () => {
    expect(
      googleIdentityFromClaims({
        sub: "1029",
        email: "  Kike@Example.COM ",
        email_verified: true,
        name: "Kike",
      })
    ).toEqual({ sub: "1029", email: "kike@example.com", emailVerified: true, displayName: "Kike" });
  });

  it("treats an unverified address as unverified", () => {
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.co" })?.emailVerified).toBe(false);
    expect(
      googleIdentityFromClaims({ sub: "1", email: "a@b.co", email_verified: false })?.emailVerified
    ).toBe(false);
  });

  it("needs a subject", () => {
    expect(googleIdentityFromClaims({ email: "a@b.co" })).toBeNull();
  });

  it("leaves a blank name null rather than empty", () => {
    expect(googleIdentityFromClaims({ sub: "1", name: "   " })?.displayName).toBeNull();
  });
});

describe("exchangeCode", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = new Date("2026-08-30T12:00:00Z");
  const t = Math.floor(now.getTime() / 1000);

  // The signature is not re-checked (it came over TLS from Google's token
  // endpoint against our client secret), so the token here is unsigned on
  // purpose — what these tests pin is the claim checking around it.
  const idToken = (over: Record<string, unknown> = {}) =>
    `${b64({ alg: "RS256" })}.${b64({
      iss: "https://accounts.google.com",
      aud: "cid",
      sub: "1029",
      email: "kike@example.com",
      email_verified: true,
      exp: t + 600,
      iat: t - 5,
      nonce: "the-nonce",
      ...over,
    })}.sig`;

  const mockToken = (body: unknown, ok = true) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok, status: ok ? 200 : 400, json: async () => body, text: async () => "",
    })));

  const input = {
    code: "c",
    redirectUri: "https://www.spellpool.com/api/auth/oauth/google/callback",
    verifier: "v",
    nonce: "the-nonce",
    now,
  };

  it("returns the identity from a good exchange", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    mockToken({ id_token: idToken() });
    expect(await exchangeCode(input)).toMatchObject({ sub: "1029", emailVerified: true });
  });

  it("posts the verifier and the secret as form data", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    const fetchFn = vi.fn(async (_url: string, _init: { body: URLSearchParams }) => ({
      ok: true, status: 200, json: async () => ({ id_token: idToken() }), text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchFn);
    await exchangeCode(input);
    const body = fetchFn.mock.calls[0]![1].body;
    expect(body.get("code_verifier")).toBe("v");
    expect(body.get("client_secret")).toBe("sec");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("gives up when Google rejects the exchange", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockToken({ error: "invalid_grant" }, false);
    expect(await exchangeCode(input)).toBeNull();
    err.mockRestore();
  });

  it("gives up when there is no id_token in the response", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    mockToken({ access_token: "at" });
    expect(await exchangeCode(input)).toBeNull();
  });

  // These are the checks a signature would not have given us anyway.
  it("rejects a token for another client, expired, or with the wrong nonce", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    mockToken({ id_token: idToken({ aud: "someone-else" }) });
    expect(await exchangeCode(input)).toBeNull();

    mockToken({ id_token: idToken({ exp: t - 3600 }) });
    expect(await exchangeCode(input)).toBeNull();

    mockToken({ id_token: idToken({ nonce: "replayed" }) });
    expect(await exchangeCode(input)).toBeNull();

    mockToken({ id_token: idToken({ iss: "https://evil.example" }) });
    expect(await exchangeCode(input)).toBeNull();

    err.mockRestore();
  });

  it("accepts either spelling of Google's issuer", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    mockToken({ id_token: idToken({ iss: "accounts.google.com" }) });
    expect(await exchangeCode(input)).not.toBeNull();
  });
});
