import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createSession, newToken, requestOrigin, tokenHash } from "@/lib/auth";
import { exchangeCode } from "@/lib/google-auth";
import { applyLinkDecision, readExistingState } from "@/lib/oauth-link-db";
import { decideLink, type ProviderIdentity } from "@/lib/oauth-link";
import { recordEvent } from "@/lib/analytics";

export const runtime = "nodejs";

// The window the iOS app has to trade its one-time code for a session. It
// makes that request the instant the browser closes, so this is short.
const HANDOFF_SECONDS = 120;

const scheme = () => process.env.IOS_CALLBACK_SCHEME || "spellpool";

/* Built by hand rather than with NextResponse.redirect, which parses the
   location as a URL — a custom scheme is not worth finding out about in
   production. */
function appRedirect(query: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${scheme()}://auth/callback?${query}` },
  });
}

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const params = new URL(req.url).searchParams;
  const state = params.get("state") ?? "";

  // Load and delete together: the state is single use, so a replayed callback
  // finds nothing. This is also the CSRF check — a callback we didn't start
  // has no matching row.
  const pending = state
    ? await prisma.oAuthState
        .delete({ where: { id: tokenHash(state) } })
        .catch(() => null)
    : null;

  // With no row we can't know where this came from, so answer as the web.
  if (!pending || pending.expiresAt < new Date()) {
    return NextResponse.redirect(`${origin}/login?oauth=expired`, 303);
  }
  const isApp = pending.mode === "app";
  const fail = (slug: string) =>
    isApp
      ? appRedirect(`error=${encodeURIComponent(slug)}`)
      : NextResponse.redirect(`${origin}/login?oauth=${slug}`, 303);

  if (params.get("error")) return fail("cancelled");
  const code = params.get("code");
  if (!code) return fail("cancelled");

  const google = await exchangeCode({
    code,
    redirectUri: `${origin}/api/auth/oauth/google/callback`,
    verifier: pending.verifier,
    nonce: pending.nonce,
  });
  if (!google || !google.sub) return fail("failed");

  const identity: ProviderIdentity = {
    provider: "google",
    providerAccountId: google.sub,
    email: google.email,
    emailVerified: google.emailVerified,
    isPrivateRelay: false,
    displayName: google.displayName,
  };

  const decision = decideLink(identity, await readExistingState(identity));
  const user = await applyLinkDecision(identity, decision);
  if (user === null) return fail(decision.action === "reject" ? decision.reason : "failed");

  if (decision.action === "create") await recordEvent("signup");
  await recordEvent("login");

  if (isApp) {
    // The browser holding this response belongs to ASWebAuthenticationSession,
    // not to the app, so a cookie set here would land in the wrong jar. Hand
    // over a one-time code instead and let the app trade it on its own
    // URLSession request, where the cookie will actually stick.
    const handoff = newToken();
    await prisma.authCode.create({
      data: {
        id: tokenHash(handoff),
        userId: user.id,
        expiresAt: new Date(Date.now() + HANDOFF_SECONDS * 1000),
      },
    });
    return appRedirect(`code=${encodeURIComponent(handoff)}`);
  }

  await createSession(user.id);
  return NextResponse.redirect(`${origin}${pending.next ?? "/"}`, 303);
}
