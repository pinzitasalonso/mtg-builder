// Paddle.js settings for the browser, read on the server at request time.
// Both values are public (a client-side token is made to be exposed); the
// server-side API key is never read here. The environment is never defaulted:
// a missing or unknown value throws, so the page can't quietly run against the
// wrong Paddle account.

export type PaddleEnv = "sandbox" | "production";

export interface PaddleClientConfig {
  environment: PaddleEnv;
  token: string;
}

/** The Paddle environment, for the browser and the server alike. Throws when unset. */
export function paddleEnv(): PaddleEnv {
  const environment = process.env.NEXT_PUBLIC_PADDLE_ENV;
  if (environment !== "sandbox" && environment !== "production") {
    // Never echo the value: if a key was pasted here by mistake, it must not
    // reach a log or an error page.
    throw new Error(
      `NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (${environment ? "it holds something else" : "it is unset"})`,
    );
  }
  return environment;
}

export function paddleClientConfig(): PaddleClientConfig {
  const environment = paddleEnv();
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  if (!token) throw new Error("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set");
  // A sandbox token starts test_, a live one live_. A mismatch means the two
  // variables point at different accounts.
  const expected = environment === "sandbox" ? "test_" : "live_";
  if (!token.startsWith(expected)) {
    throw new Error(`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with ${expected} for ${environment}`);
  }
  return { environment, token };
}

// The visitor's country from the edge's geo header, or undefined. Undefined
// means "send no address": PricePreview then detects the country from the IP.
// Railway sets no geo header, so on spellpool.com today this is undefined.
// XX and T1 are Cloudflare's "unknown" and "Tor".
export function countryFromHeaders(h: Headers): string | undefined {
  const raw = (h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw) || raw === "XX" || raw === "T1") return undefined;
  return raw;
}
