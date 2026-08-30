import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { newToken, requestOrigin, safeNextPath, tokenHash } from "@/lib/auth";
import { authorizeUrl, googleClientId, googleConfigured, newVerifier } from "@/lib/google-auth";
import { authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Ten minutes is plenty to pick an account and long enough to survive a
// password manager prompt.
const STATE_MINUTES = 10;

export const googleCallbackUrl = (origin: string) => `${origin}/api/auth/oauth/google/callback`;

/* Begin the flow. `mode=app` marks a sign-in started by the iOS app, which
   needs a one-time code handed back over the custom scheme rather than a
   cookie; `mode=web` gets the cookie directly. */
export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "app" ? "app" : "web";

  if (!googleConfigured()) {
    // The button is hidden when Google isn't configured, so reaching this is
    // either a stale page or a hand-made request.
    return mode === "app"
      ? appRedirect("unconfigured")
      : NextResponse.redirect(`${origin}/login?oauth=unconfigured`, 303);
  }
  if (!authRateLimit("oauth-start", clientIp(req))) {
    return mode === "app"
      ? appRedirect("throttled")
      : NextResponse.redirect(`${origin}/login?oauth=throttled`, 303);
  }

  const state = newToken();
  const verifier = newVerifier();
  const nonce = newToken();

  // The verifier and nonce have to outlive this request but must never reach
  // the browser, so they wait here keyed by the state's digest.
  await prisma.oAuthState.create({
    data: {
      id: tokenHash(state),
      provider: "google",
      verifier,
      nonce,
      mode,
      next: mode === "web" ? safeNextPath(url.searchParams.get("next")) : null,
      expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000),
    },
  });

  return NextResponse.redirect(
    authorizeUrl({
      clientId: googleClientId(),
      redirectUri: googleCallbackUrl(origin),
      state,
      nonce,
      verifier,
    }),
    303
  );
}

/* iOS is waiting inside ASWebAuthenticationSession; the only way to end it is
   to reach the custom scheme, so even failures redirect there. */
function appRedirect(error: string): NextResponse {
  const scheme = process.env.IOS_CALLBACK_SCHEME || "spellpool";
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${scheme}://auth/callback?error=${encodeURIComponent(error)}` },
  });
}
