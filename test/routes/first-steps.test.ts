import { describe, expect, it } from "vitest";
import { makeUser, prisma, signIn, signOut } from "@/test/db";
import { POST as putAway } from "@/app/api/first-steps/route";
import { firstStepsOf, stepsToShow } from "@/lib/first-steps-server";

// Home tells a free account what its plan gives a day, and ticks what the
// account has tried: read from what each of the three leaves behind.
describe("what an account has tried", () => {
  it("is nothing for a new account, and each thing once it's done", async () => {
    const user = await makeUser();
    const other = await makeUser();
    expect(await firstStepsOf(user.id)).toEqual({ coach: false, match: false, score: false });

    // A question to the coach (its reply alone isn't one).
    const thread = await prisma.assistantThread.create({ data: { userId: user.id } });
    await prisma.assistantMessage.create({ data: { threadId: thread.id, role: "assistant", content: "Hello." } });
    expect((await firstStepsOf(user.id)).coach).toBe(false);
    await prisma.assistantMessage.create({ data: { threadId: thread.id, role: "user", content: "Build me a goblin deck." } });
    expect(await firstStepsOf(user.id)).toEqual({ coach: true, match: false, score: false });

    // A practice match, against either opponent.
    await prisma.practiceGame.create({ data: { id: `g-${user.id}`, userId: user.id, label: "Mirror match", setup: "{}", bot: true } });
    expect(await firstStepsOf(user.id)).toEqual({ coach: true, match: true, score: false });

    // A scan of one of its decks: a deck alone isn't one.
    const deck = await prisma.deck.create({ data: { name: "Goblins", userId: user.id, publicId: `fs-${user.id}`, format: "commander" } });
    expect((await firstStepsOf(user.id)).score).toBe(false);
    await prisma.deck.update({ where: { id: deck.id }, data: { analyzedAt: new Date(), analysis: "{}" } });
    expect(await firstStepsOf(user.id)).toEqual({ coach: true, match: true, score: true });

    // Somebody else's account is its own.
    expect(await firstStepsOf(other.id)).toEqual({ coach: false, match: false, score: false });
  });

  it("shows on home until all three are tried, the account goes Pro, or it's put away", async () => {
    const user = await makeUser();
    const none = { coach: false, match: false, score: false };
    expect(await stepsToShow({ id: user.id, tier: "free" })).toEqual(none);
    // Pro has no daily limit to tell anyone about.
    expect(await stepsToShow({ id: user.id, tier: "pro" })).toBeNull();

    // Put away: signed in only, and for that account only.
    signOut();
    expect((await putAway()).status).toBe(401);
    expect(await stepsToShow({ id: user.id, tier: "free" })).toEqual(none);
    const other = await makeUser();
    await signIn(user);
    expect((await putAway()).status).toBe(200);
    expect(await stepsToShow({ id: user.id, tier: "free" })).toBeNull();
    expect(await stepsToShow({ id: other.id, tier: "free" })).toEqual(none);

    // All three tried: nothing left to point at.
    const thread = await prisma.assistantThread.create({ data: { userId: other.id } });
    await prisma.assistantMessage.create({ data: { threadId: thread.id, role: "user", content: "What should I cut?" } });
    await prisma.practiceGame.create({ data: { id: `g2-${other.id}`, userId: other.id, label: "Mirror match", setup: "{}" } });
    expect(await stepsToShow({ id: other.id, tier: "free" })).toEqual({ coach: true, match: true, score: false });
    await prisma.deck.create({ data: { name: "Scanned", userId: other.id, publicId: `fs2-${other.id}`, format: "commander", analyzedAt: new Date(), analysis: "{}" } });
    expect(await stepsToShow({ id: other.id, tier: "free" })).toBeNull();
  });
});
