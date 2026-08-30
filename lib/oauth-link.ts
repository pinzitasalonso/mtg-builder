// Deciding what a third-party sign-in means: is this someone we know, someone
// to link to an existing account, or someone new?
//
// Kept pure and free of Prisma so the policy is testable on its own — the same
// split as lib/limits.ts and lib/limits-db.ts. Getting this wrong is an
// account takeover, so it should be readable in one sitting.
//
// No `@/` imports — see lib/jwt.ts.

export type ProviderId = "google" | "apple";

export interface ProviderIdentity {
  provider: ProviderId;
  providerAccountId: string; // the provider's stable subject
  email: string | null; // already normalized
  emailVerified: boolean; // did the provider actually vouch for it?
  isPrivateRelay: boolean;
  displayName: string | null;
}

/* Everything in the database that bears on the decision, read before deciding
   so the decision itself needs no queries. */
export interface ExistingState {
  /** Account(provider, providerAccountId).userId — we've seen this subject. */
  linkedUserId: number | null;
  /** User.email == identity.email */
  emailUserId: number | null;
  /** Whether that user has verified their address by our own flow. */
  emailUserVerified: boolean;
}

export type LinkDecision =
  | { action: "signin"; userId: number }
  | { action: "link"; userId: number; markVerified: boolean }
  | { action: "create"; email: string }
  | { action: "reject"; reason: "email-required" | "email-unverified-conflict" };

/* The policy, in order. Each rule exists because of the one above it. */
export function decideLink(identity: ProviderIdentity, existing: ExistingState): LinkDecision {
  // 1. We already know this subject. The email is irrelevant here on purpose:
  //    someone who changes their Google address keeps their Spellpool account,
  //    and Apple stops sending an address after the first authorization.
  if (existing.linkedUserId !== null) {
    return { action: "signin", userId: existing.linkedUserId };
  }

  // 2. A first-time subject with no address. Reachable when someone authorized
  //    before and then revoked: Apple treats it as a repeat and withholds the
  //    email, but we have no record to match it to. User.email is the identity
  //    and is NOT NULL, and inventing one would be worse than saying so.
  if (!identity.email) {
    return { action: "reject", reason: "email-required" };
  }

  // 3. The provider did not vouch for the address. It must never be enough to
  //    reach an account: otherwise anyone who can get an unverified address
  //    into a provider profile can walk into the matching Spellpool account.
  if (!identity.emailVerified) {
    return existing.emailUserId !== null
      ? { action: "reject", reason: "email-unverified-conflict" }
      : { action: "create", email: identity.email };
  }

  // 4. Verified, and nobody here uses it.
  if (existing.emailUserId === null) {
    return { action: "create", email: identity.email };
  }

  // 5. Verified, and it matches an account. Link them. The provider just
  //    proved control of the inbox, which is exactly what our own verification
  //    email asks for — so an account stuck at "check your email" comes out of
  //    this verified.
  return {
    action: "link",
    userId: existing.emailUserId,
    markVerified: !existing.emailUserVerified,
  };
}

/* Copy for the two rejections. Both have to tell someone standing at a broken
   sign-in button what to actually do. */
export function rejectionMessage(reason: "email-required" | "email-unverified-conflict"): string {
  return reason === "email-required"
    ? "Apple didn't share an email address this time. On your device open Settings → your name → " +
        "Sign in with Apple → Spellpool, tap Stop Using Apple ID, then try again."
    : "An account already uses that email address. Sign in with your password first, then link " +
        "this provider from your account.";
}
