import { prisma, makeUser } from "@/test/db";
import Stripe from "stripe";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { customerIdFor, grantsAccess, hasPaidAccess, subscriptionsFor } from "@/lib/stripe-billing";

const SECRET = "whsec_test_secret";
// Only used to sign test deliveries; nothing here reaches Stripe.
const signer = new Stripe("sk_test_signer");

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

// Signed the way Stripe signs: v1 = HMAC-SHA256(secret, "<t>.<raw body>").
function delivery(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("http://test.local/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body,
  });
}

let n = 0;
const T0 = 1_795_000_000; // seconds, as Stripe sends them

function event(type: string, object: object, created = T0) {
  n += 1;
  return { id: `evt_${n}`, object: "event", api_version: "2026-11-18.endive", created, livemode: false, type, data: { object } };
}

// Shaped on a sandbox trial checkout's subscription.
function subscription(o: {
  id?: string; customer?: string; status?: string; userId?: string; cancelAtPeriodEnd?: boolean; interval?: "month" | "year";
} = {}) {
  return {
    id: o.id ?? "sub_1",
    object: "subscription",
    customer: o.customer ?? "cus_1",
    status: o.status ?? "trialing",
    cancel_at: null,
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
    trial_end: T0 + 7 * 86400,
    metadata: o.userId ? { userId: o.userId } : {},
    items: {
      object: "list",
      data: [{
        id: "si_1",
        object: "subscription_item",
        current_period_start: T0,
        current_period_end: T0 + 7 * 86400,
        price: { id: "price_month", object: "price", product: "prod_pro", recurring: { interval: o.interval ?? "month", interval_count: 1 } },
      }],
    },
  };
}

function customer(o: { id?: string; email?: string; userId?: string } = {}) {
  return { id: o.id ?? "cus_1", object: "customer", email: o.email ?? "player@example.com", metadata: o.userId ? { userId: o.userId } : {} };
}

describe("Stripe webhook", () => {
  it("rejects a delivery without a signature, or signed with another secret", async () => {
    const body = JSON.stringify(event("customer.created", customer({ id: "cus_nosig" })));
    const unsigned = await POST(new Request("http://test.local/api/stripe/webhook", { method: "POST", body }));
    expect(unsigned.status).toBe(400);
    const forged = await POST(delivery(event("customer.created", customer({ id: "cus_forged" })), "whsec_wrong"));
    expect(forged.status).toBe(400);
    expect(await prisma.stripeCustomer.count({ where: { customerId: { in: ["cus_nosig", "cus_forged"] } } })).toBe(0);
  });

  it("answers 500 (so Stripe retries) when the secret isn't configured", async () => {
    const before = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const res = await POST(delivery(event("customer.created", customer({ id: "cus_nosecret" }))));
      expect(res.status).toBe(500);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = before;
    }
  });

  it("acknowledges an event it doesn't use", async () => {
    const res = await POST(delivery(event("invoice.paid", { id: "in_1", object: "invoice" })));
    expect(res.status).toBe(200);
  });

  it("mirrors a trial subscription and links it to the account in its metadata", async () => {
    const user = await makeUser();
    const res = await POST(delivery(event("customer.subscription.created", subscription({ id: "sub_trial", customer: "cus_trial", userId: String(user.id) }))));
    expect(res.status).toBe(200);
    const row = await prisma.stripeSubscription.findUniqueOrThrow({ where: { subscriptionId: "sub_trial" } });
    expect(row).toMatchObject({
      customerId: "cus_trial", status: "trialing", priceId: "price_month", productId: "prod_pro", interval: "month",
      userId: user.id, cancelAtPeriodEnd: false,
    });
    expect(row.trialEnd?.getTime()).toBe((T0 + 7 * 86400) * 1000);
    expect(await hasPaidAccess(user)).toBe(true);
    // Before customer.created arrives, the portal finds the customer through the subscription.
    expect(await customerIdFor(user)).toBe("cus_trial");
  });

  it("applies newer events and skips a late, older one", async () => {
    const user = await makeUser();
    const id = "sub_order";
    const base = { id, customer: "cus_order", userId: String(user.id) };
    await POST(delivery(event("customer.subscription.created", subscription({ ...base, status: "trialing" }), T0)));
    await POST(delivery(event("customer.subscription.updated", subscription({ ...base, status: "active", cancelAtPeriodEnd: true }), T0 + 100)));
    // The created event, delivered again late, must not undo the update.
    await POST(delivery(event("customer.subscription.created", subscription({ ...base, status: "trialing" }), T0)));
    const row = await prisma.stripeSubscription.findUniqueOrThrow({ where: { subscriptionId: id } });
    expect(row.status).toBe("active");
    expect(row.cancelAtPeriodEnd).toBe(true);

    await POST(delivery(event("customer.subscription.deleted", subscription({ ...base, status: "canceled" }), T0 + 200)));
    expect((await prisma.stripeSubscription.findUniqueOrThrow({ where: { subscriptionId: id } })).status).toBe("canceled");
    expect(await hasPaidAccess(user)).toBe(false);
  });

  it("links a customer from its metadata, and never moves it to another account", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await POST(delivery(event("customer.created", customer({ id: "cus_mine", email: "Me@Example.com", userId: String(me.id) }))));
    let row = await prisma.stripeCustomer.findUniqueOrThrow({ where: { customerId: "cus_mine" } });
    expect(row).toMatchObject({ email: "me@example.com", userId: me.id });

    await POST(delivery(event("customer.updated", customer({ id: "cus_mine", email: "new@example.com", userId: String(other.id) }), T0 + 10)));
    row = await prisma.stripeCustomer.findUniqueOrThrow({ where: { customerId: "cus_mine" } });
    expect(row).toMatchObject({ email: "new@example.com", userId: me.id });
    expect(await customerIdFor(other)).toBeNull();
  });

  it("ignores a userId that isn't an account", async () => {
    await POST(delivery(event("customer.subscription.created", subscription({ id: "sub_ghost", customer: "cus_ghost", userId: "99999999" }))));
    await POST(delivery(event("customer.created", customer({ id: "cus_ghost2", userId: "1; drop" }))));
    expect((await prisma.stripeSubscription.findUniqueOrThrow({ where: { subscriptionId: "sub_ghost" } })).userId).toBeNull();
    expect((await prisma.stripeCustomer.findUniqueOrThrow({ where: { customerId: "cus_ghost2" } })).userId).toBeNull();
  });

  it("links an unlinked customer and subscription from a completed checkout", async () => {
    const user = await makeUser();
    await POST(delivery(event("customer.created", customer({ id: "cus_co" }))));
    await POST(delivery(event("customer.subscription.created", subscription({ id: "sub_co", customer: "cus_co" }))));
    const res = await POST(delivery(event("checkout.session.completed", {
      id: "cs_test_1", object: "checkout.session", mode: "subscription", status: "complete",
      customer: "cus_co", subscription: "sub_co", client_reference_id: String(user.id), metadata: { userId: String(user.id) },
    })));
    expect(res.status).toBe(200);
    expect(await customerIdFor(user)).toBe("cus_co");
    expect((await subscriptionsFor(user)).map((s) => s.subscriptionId)).toEqual(["sub_co"]);
  });

  it("forgets a customer Stripe deleted", async () => {
    const user = await makeUser();
    await POST(delivery(event("customer.created", customer({ id: "cus_gone", userId: String(user.id) }))));
    await POST(delivery(event("customer.deleted", { ...customer({ id: "cus_gone" }), deleted: true }, T0 + 5)));
    expect(await prisma.stripeCustomer.count({ where: { customerId: "cus_gone" } })).toBe(0);
  });
});

describe("grantsAccess", () => {
  it("is on while trialing, active or retrying a payment", () => {
    for (const status of ["trialing", "active", "past_due"]) expect(grantsAccess({ status })).toBe(true);
    for (const status of ["unpaid", "paused", "canceled", "incomplete", "incomplete_expired"]) expect(grantsAccess({ status })).toBe(false);
    expect(grantsAccess(null)).toBe(false);
  });
});

describe("Pro from a web subscription", () => {
  const tierOf = async (id: number) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { tier: true } })).tier;

  it("makes the account Pro as soon as its subscription grants access", async () => {
    const user = await makeUser();
    expect(await tierOf(user.id)).toBe("free");
    await POST(delivery(event("customer.subscription.created", subscription({ id: "sub_pro", customer: "cus_pro", userId: String(user.id) }))));
    expect(await tierOf(user.id)).toBe("pro");
  });

  it("asks RevenueCat when the subscription ends, and goes free only on its clear no", async () => {
    const user = await makeUser();
    const base = { id: "sub_end", customer: "cus_end", userId: String(user.id) };
    await POST(delivery(event("customer.subscription.created", subscription(base), T0)));
    expect(await tierOf(user.id)).toBe("pro");

    process.env.REVENUECAT_API_KEY = "rc_test";
    let rcAnswer: "down" | "none" = "down";
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (rcAnswer === "down") throw new Error("RevenueCat is down");
      return Response.json({ subscriber: { entitlements: {} } });
    }));
    try {
      // RevenueCat can't answer: nothing changes.
      await POST(delivery(event("customer.subscription.deleted", subscription({ ...base, status: "canceled" }), T0 + 10)));
      expect(await tierOf(user.id)).toBe("pro");
      // RevenueCat says no entitlement: free.
      rcAnswer = "none";
      await POST(delivery(event("customer.subscription.updated", subscription({ ...base, status: "canceled" }), T0 + 20)));
      expect(await tierOf(user.id)).toBe("free");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.REVENUECAT_API_KEY;
    }
  });

  it("hands a finished checkout to RevenueCat with its Stripe app's public key", async () => {
    const user = await makeUser();
    process.env.REVENUECAT_STRIPE_PUBLIC_KEY = "strp_test";
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({});
    }));
    try {
      await POST(delivery(event("checkout.session.completed", {
        id: "cs_test_rc", object: "checkout.session", mode: "subscription", status: "complete",
        customer: "cus_rc", subscription: "sub_rc", metadata: { userId: String(user.id) },
      })));
    } finally {
      vi.unstubAllGlobals();
      delete process.env.REVENUECAT_STRIPE_PUBLIC_KEY;
    }
    const receipt = calls.find((c) => c.url === "https://api.revenuecat.com/v1/receipts");
    expect(receipt).toBeDefined();
    const headers = receipt!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer strp_test");
    expect(headers["X-Platform"]).toBe("stripe");
    expect(JSON.parse(String(receipt!.init.body))).toEqual({ app_user_id: String(user.id), fetch_token: "sub_rc" });
  });
});
