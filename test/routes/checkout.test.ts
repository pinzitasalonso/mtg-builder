import { prisma, makeUser, signIn, signOut } from "@/test/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prices = {
  data: [
    { id: "price_m", lookup_key: "spellpool_pro_monthly", unit_amount: 499, currency: "eur" },
    { id: "price_y", lookup_key: "spellpool_pro_yearly", unit_amount: 3999, currency: "eur" },
  ],
};
const listPrices = vi.fn(async () => prices);
const createCustomer = vi.fn(async (p: { email: string }) => ({ id: `cus_${p.email.split("@")[0]}`, email: p.email }));
const createSession = vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
vi.mock("@/lib/stripe", () => ({
  stripe: () => ({ prices: { list: listPrices }, customers: { create: createCustomer }, checkout: { sessions: { create: createSession } } }),
}));

const { startCheckout } = await import("@/app/pricing/actions");

function form(interval: string) {
  const f = new FormData();
  f.set("interval", interval);
  return f;
}

async function target(interval = "month"): Promise<string> {
  try {
    await startCheckout(form(interval));
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("no redirect");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionParams = (): any => (createSession.mock.calls.at(-1) as unknown as [unknown])[0];

describe("startCheckout", () => {
  beforeEach(() => {
    createSession.mockClear();
    createCustomer.mockClear();
  });

  it("sends a signed-out visitor to sign in, without asking Stripe", async () => {
    signOut();
    expect(await target()).toBe("/login");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("opens a Managed Payments checkout credited to the account, with the yearly trial", async () => {
    const user = await makeUser();
    await signIn(user);
    expect(await target("year")).toBe("https://checkout.stripe.com/c/pay/cs_test_1");

    // The customer is made with the account in its metadata, and kept.
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(createCustomer.mock.calls[0][0]).toMatchObject({ email: user.email, metadata: { userId: String(user.id) } });
    const customer = await prisma.stripeCustomer.findFirstOrThrow({ where: { userId: user.id } });

    const p = sessionParams();
    expect(p).toMatchObject({
      mode: "subscription",
      managed_payments: { enabled: true },
      customer: customer.customerId,
      line_items: [{ price: "price_y", quantity: 1 }],
      client_reference_id: String(user.id),
      metadata: { userId: String(user.id) },
      subscription_data: { metadata: { userId: String(user.id) }, trial_period_days: 7 },
    });
    expect(p.success_url).toMatch(/\/welcome$/);
    expect(p.cancel_url).toMatch(/\/pricing$/);
    // Managed Payments handles tax itself; these parameters aren't allowed with it.
    expect(p).not.toHaveProperty("automatic_tax");
    expect(p).not.toHaveProperty("payment_method_types");

    // A second checkout reuses the customer.
    await target("month");
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(sessionParams().customer).toBe(customer.customerId);
  });

  it("gives no trial on the monthly plan", async () => {
    await signIn(await makeUser());
    await target("month");
    const p = sessionParams();
    expect(p.line_items).toEqual([{ price: "price_m", quantity: 1 }]);
    expect(p.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("gives no second trial after an earlier web subscription", async () => {
    const user = await makeUser();
    await prisma.stripeSubscription.create({ data: {
      subscriptionId: "sub_old", customerId: "cus_old", status: "canceled", priceId: "price_m", productId: "prod", interval: "month",
      userId: user.id, stripeEventAt: new Date(),
    } });
    await signIn(user);
    await target("year");
    expect(sessionParams().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("sends a Pro player, or one already subscribed, to their account instead", async () => {
    await signIn(await makeUser({ tier: "pro" }));
    expect(await target()).toBe("/account");

    const user = await makeUser();
    await prisma.stripeSubscription.create({ data: {
      subscriptionId: "sub_live", customerId: "cus_live", status: "active", priceId: "price_m", productId: "prod", interval: "month",
      userId: user.id, stripeEventAt: new Date(),
    } });
    await signIn(user);
    expect(await target()).toBe("/account");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("comes back to the pricing page when Stripe fails", async () => {
    await signIn(await makeUser());
    createSession.mockRejectedValueOnce(new Error("Stripe is down"));
    expect(await target()).toBe("/pricing?checkout=error");
  });
});
