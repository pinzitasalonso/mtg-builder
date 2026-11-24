import { prisma, makeUser, signIn } from "@/test/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as rcWebhook } from "@/app/api/revenuecat/webhook/route";
import { POST as sync } from "@/app/api/subscription/sync/route";

async function subscribed(userId: number, status = "trialing") {
  await prisma.stripeSubscription.create({ data: {
    subscriptionId: `sub_${userId}`, customerId: `cus_${userId}`, status, priceId: "price_m", productId: "prod", interval: "month",
    userId, stripeEventAt: new Date(),
  } });
}
const tierOf = async (id: number) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { tier: true } })).tier;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REVENUECAT_API_KEY;
  delete process.env.REVENUECAT_WEBHOOK_TOKEN;
});

// RevenueCat answers that the account has no entitlement.
function revenueCatSaysNo() {
  process.env.REVENUECAT_API_KEY = "rc_test";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ subscriber: { entitlements: {} } })));
}

describe("an account with a web subscription", () => {
  it("shows as Pro on /api/auth/me even before its tier was stored", async () => {
    const user = await makeUser();
    await subscribed(user.id);
    await signIn(user);
    const body = await (await me()).json();
    expect(body.user.tier).toBe("pro");
    expect(body.user.aiRemaining).toBeNull();
    expect(await tierOf(user.id)).toBe("pro");
  });

  it("stays Pro when RevenueCat's webhook says it has no entitlement", async () => {
    const user = await makeUser({ tier: "pro" });
    await subscribed(user.id, "active");
    revenueCatSaysNo();
    process.env.REVENUECAT_WEBHOOK_TOKEN = "tok";
    const res = await rcWebhook(new Request("http://test.local/api/revenuecat/webhook", {
      method: "POST", headers: { authorization: "tok", "content-type": "application/json" },
      body: JSON.stringify({ event: { app_user_id: String(user.id) } }),
    }));
    expect((await res.json()).tier).toBe("pro");
    expect(await tierOf(user.id)).toBe("pro");
  });

  it("stays Pro when the app's sync asks RevenueCat", async () => {
    const user = await makeUser({ tier: "pro" });
    await subscribed(user.id, "active");
    revenueCatSaysNo();
    await signIn(user);
    expect((await (await sync()).json()).tier).toBe("pro");
  });

  it("goes free on RevenueCat's no once the web subscription has ended", async () => {
    const user = await makeUser({ tier: "pro" });
    await subscribed(user.id, "canceled");
    revenueCatSaysNo();
    await signIn(user);
    expect((await (await sync()).json()).tier).toBe("free");
  });
});
