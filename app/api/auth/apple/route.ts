import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { appleAudience, verifyAppleIdentityToken } from "@/lib/apple-auth";
import { applyLinkDecision, readExistingState } from "@/lib/oauth-link-db";
import { decideLink, rejectionMessage, type ProviderIdentity } from "@/lib/oauth-link";
import { recordEvent } from "@/lib/analytics";
import { AUTH_LIMIT_MSG, authRateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Native Sign in with Apple. The app runs the whole dance with Apple and
// sends us the identity token; we check it against Apple's published keys.
// That is why this needs no Services ID and no .p8 key — a native token's
// audience is the bundle id.
export async function POST(req: Request) {
  let body: { identityToken?: unknown; rawNonce?: unknown; fullName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!authRateLimit("apple", clientIp(req))) {
    return NextResponse.json({ error: AUTH_LIMIT_MSG }, { status: 429 });
  }

  const identityToken = typeof body.identityToken === "string" ? body.identityToken : "";
  const rawNonce = typeof body.rawNonce === "string" ? body.rawNonce : "";
  const fullName = typeof body.fullName === "string" && body.fullName.trim() ? body.fullName.trim() : null;
  const rejected = { error: "Apple couldn't verify that sign-in. Try again." };
  if (!identityToken) return NextResponse.json(rejected, { status: 401 });

  // The app puts sha256(rawNonce) in the request to Apple and Apple echoes it
  // back in the token, so the raw value never reaches Apple's logs. Comparing
  // the digest here is what ties this token to the sign-in the app started.
  const expectedNonce = rawNonce
    ? createHash("sha256").update(rawNonce).digest("hex")
    : undefined;

  let apple;
  try {
    apple = await verifyAppleIdentityToken(identityToken, {
      audience: appleAudience(),
      nonce: expectedNonce,
    });
  } catch {
    // Apple's keys were unreachable and we had none cached. That is our
    // problem, not a bad token, so don't tell the user their sign-in failed.
    return NextResponse.json(
      { error: "Couldn't reach Apple to check that sign-in. Try again in a moment." },
      { status: 503 }
    );
  }
  // One message for every rejection: a client that can tell "wrong audience"
  // from "bad signature" has been handed a probe.
  if (!apple) return NextResponse.json(rejected, { status: 401 });

  const identity: ProviderIdentity = {
    provider: "apple",
    providerAccountId: apple.sub,
    email: apple.email,
    emailVerified: apple.emailVerified,
    isPrivateRelay: apple.isPrivateRelay,
    displayName: fullName,
  };

  const decision = decideLink(identity, await readExistingState(identity));
  const user = await applyLinkDecision(identity, decision);
  if (user === null) {
    if (decision.action !== "reject") return NextResponse.json(rejected, { status: 401 });
    return NextResponse.json(
      { error: rejectionMessage(decision.reason) },
      { status: decision.reason === "email-required" ? 400 : 409 }
    );
  }

  if (decision.action === "create") await recordEvent("signup");
  await recordEvent("login");

  await createSession(user.id);
  // Same shape as /api/auth/login so the iOS client reuses its decoder.
  return NextResponse.json({ id: user.id, email: user.email });
}
