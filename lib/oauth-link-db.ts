// The database half of third-party sign-in: read what bears on the decision,
// then apply it. The decision itself is in lib/oauth-link.ts and is pure.

import prisma from "@/lib/prisma";
import type { ExistingState, LinkDecision, ProviderIdentity } from "@/lib/oauth-link";

/* Everything decideLink needs, in two lookups. */
export async function readExistingState(identity: ProviderIdentity): Promise<ExistingState> {
  const [account, byEmail] = await Promise.all([
    prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
        },
      },
      select: { userId: true },
    }),
    identity.email
      ? prisma.user.findUnique({
          where: { email: identity.email },
          select: { id: true, emailVerifiedAt: true },
        })
      : null,
  ]);

  return {
    linkedUserId: account?.userId ?? null,
    emailUserId: byEmail?.id ?? null,
    emailUserVerified: byEmail?.emailVerifiedAt != null,
  };
}

export interface LinkedUser {
  id: number;
  email: string;
}

/* Carry out a decision. Returns the account to open a session for, or null
   when the decision was a rejection.

   The email comes back from the row rather than from the identity: Apple
   sends an address only on the first authorization, so on every later
   sign-in the identity has none and only the database knows it. */
export async function applyLinkDecision(
  identity: ProviderIdentity,
  decision: LinkDecision
): Promise<LinkedUser | null> {
  if (decision.action === "reject") return null;

  const userId =
    decision.action === "create"
      ? (
          await prisma.user.create({
            data: {
              email: decision.email,
              // No password: the account can only be reached through this
              // provider until its owner sets one via the reset flow.
              passwordHash: null,
              // The provider vouched for the address, so asking for our own
              // verification email on top would be theatre.
              emailVerifiedAt: new Date(),
              displayName: identity.displayName,
            },
            select: { id: true },
          })
        ).id
      : decision.userId;

  if (decision.action === "link" && decision.markVerified) {
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  // Apple sends the name exactly once, at first authorization, and never
  // again — so record it if we have one and nothing better.
  if (identity.displayName && decision.action !== "create") {
    await prisma.user.updateMany({
      where: { id: userId, displayName: null },
      data: { displayName: identity.displayName },
    });
  }

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    create: {
      userId,
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      email: identity.email,
    },
    // The address on the Account row is support metadata, so keep it current;
    // User.email is the identity and is deliberately left alone.
    update: { lastUsedAt: new Date(), email: identity.email },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  return user;
}
