import { afterEach, describe, expect, it } from "vitest";
import { jsonRequest, makeUser, prisma, signIn, signOut } from "@/test/db";
import { POST as cardTraderOrder } from "@/app/api/cardtrader/order/route";
import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "@/lib/limits";
import { claimPractice, consumeAi, consumeScan, refundScan } from "@/lib/limits-db";

const together = <T>(n: number, run: () => Promise<T>) => Promise.all(Array.from({ length: n }, run));

describe("the free plan's daily meters, with the requests arriving together", () => {
  it("spends no more AI asks than the day's allowance", async () => {
    const user = await makeUser();
    const got = await together(FREE_AI_PER_DAY + 6, () => consumeAi(user));
    expect(got.filter(Boolean)).toHaveLength(FREE_AI_PER_DAY);
    expect(await consumeAi(user)).toBe(false);
  });

  it("starts no more practice games than the day's allowance", async () => {
    const user = await makeUser();
    const got = await together(FREE_PRACTICE_PER_DAY + 4, () => claimPractice(user));
    expect(got.filter(Boolean)).toHaveLength(FREE_PRACTICE_PER_DAY);
    // A game that failed to start is deleted, which gives the claim back.
    await prisma.practiceGame.deleteMany({ where: { userId: user.id } });
    expect(await claimPractice(user)).toBeTruthy();
  });

  it("gives a failed scan back", async () => {
    const user = await makeUser();
    const got = await together(FREE_SCANS_PER_DAY + 3, () => consumeScan(user));
    expect(got.filter(Boolean)).toHaveLength(FREE_SCANS_PER_DAY);
    await refundScan(user);
    expect(await consumeScan(user)).toBe(true);
    expect(await consumeScan(user)).toBe(false);
  });

  it("never runs out on Pro", async () => {
    const user = await makeUser({ tier: "pro" });
    expect((await together(20, () => consumeAi(user))).every(Boolean)).toBe(true);
    expect((await together(5, () => claimPractice(user))).every(Boolean)).toBe(true);
  });
});

describe("POST /api/cardtrader/order", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  // The token is one person's, so the cart it fills is theirs.
  it("is only for the site's admin, even with the token set", async () => {
    process.env.CARDTRADER_API_TOKEN = "token";
    process.env.ANALYTICS_ADMIN_EMAIL = "admin@example.com";
    const order = () => cardTraderOrder(jsonRequest("/api/cardtrader/order", { cards: [{ name: "Sol Ring", quantity: 1 }] }) as never);

    signOut();
    expect((await order()).status).toBe(401);

    await signIn(await makeUser({ email: "someone@example.com" }));
    const res = await order();
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ configured: false });
    // Nothing went out to CardTrader (or anywhere).
    expect(fetch).not.toHaveBeenCalled();
  });
});
