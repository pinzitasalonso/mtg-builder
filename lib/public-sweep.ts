import prisma from "@/lib/prisma";

/* Public decks (userId null) are made by visitors who aren't signed in, and
   many are started and abandoned with nothing in them — they then sit in
   everyone's public gallery as empty tiles. This deletes those: ownerless,
   no cards on either board, and more than a day old (so a guest who has just
   made one and is still choosing cards doesn't lose it).

   Runs at most once an hour, from the public gallery's own request, the same
   way expired sessions are swept. Best-effort: a failure is ignored. */

const EVERY_MS = 60 * 60_000;
const GRACE_MS = 24 * 60 * 60_000;
let lastRun = 0;

export function emptyPublicDeckWhere(now = Date.now()) {
  return { userId: null, cards: { none: {} }, createdAt: { lt: new Date(now - GRACE_MS) } };
}

export function sweepEmptyPublicDecks(now = Date.now()): void {
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  void prisma.deck
    .deleteMany({ where: emptyPublicDeckWhere(now) })
    .then((r) => {
      if (r.count) console.log(`[sweep] deleted ${r.count} empty public deck${r.count === 1 ? "" : "s"}`);
    })
    .catch(() => {});
}
