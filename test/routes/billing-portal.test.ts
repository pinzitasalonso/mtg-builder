import { prisma, makeUser, signIn, signOut } from "@/test/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn(async (p: { customer: string; return_url: string }) => ({
  id: "bps_1",
  url: `https://billing.stripe.com/p/session/test_${p?.customer}`,
}));
vi.mock("@/lib/stripe", () => ({ stripe: () => ({ billingPortal: { sessions: { create } } }) }));

const { openBillingPortal } = await import("@/app/account/actions");

// redirect() throws; its target is in the digest.
async function target(): Promise<string> {
  try {
    await openBillingPortal();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("no redirect");
}

describe("openBillingPortal", () => {
  beforeEach(() => create.mockClear());

  it("sends a signed-out visitor to sign in, without asking Stripe", async () => {
    signOut();
    expect(await target()).toBe("/login");
    expect(create).not.toHaveBeenCalled();
  });

  it("says so when the account has no Stripe customer", async () => {
    await signIn(await makeUser());
    expect(await target()).toBe("/account?billing=none");
    expect(create).not.toHaveBeenCalled();
  });

  it("opens the portal for the account's own customer only, returning to /account", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    const at = new Date();
    await prisma.stripeCustomer.createMany({ data: [
      { customerId: "cus_mine", email: me.email, userId: me.id, stripeEventAt: at },
      { customerId: "cus_theirs", email: other.email, userId: other.id, stripeEventAt: at },
    ] });
    await signIn(me);
    expect(await target()).toBe("https://billing.stripe.com/p/session/test_cus_mine");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].customer).toBe("cus_mine");
    expect(create.mock.calls[0][0].return_url).toMatch(/\/account$/);
  });

  it("says billing failed when Stripe does", async () => {
    const me = await makeUser();
    await prisma.stripeCustomer.create({ data: { customerId: "cus_err", userId: me.id, stripeEventAt: new Date() } });
    await signIn(me);
    create.mockRejectedValueOnce(new Error("Stripe is down"));
    expect(await target()).toBe("/account?billing=error");
  });
});
