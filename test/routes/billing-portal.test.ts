import { prisma, makeUser, signIn, signOut } from "@/test/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn(async (customerId: string, subscriptionIds?: string[]) => ({
  id: "cpls_1",
  customerId,
  urls: { general: { overview: `https://sandbox-customer-portal.paddle.com/cpl_x?token=${customerId}` }, subscriptions: subscriptionIds ?? [] },
}));
vi.mock("@/lib/paddle-server", () => ({ paddle: () => ({ customerPortalSessions: { create } }) }));

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

  it("sends a signed-out visitor to sign in, without asking Paddle", async () => {
    signOut();
    expect(await target()).toBe("/login");
    expect(create).not.toHaveBeenCalled();
  });

  it("says so when the account has no Paddle customer", async () => {
    await signIn(await makeUser());
    expect(await target()).toBe("/account?billing=none");
    expect(create).not.toHaveBeenCalled();
  });

  it("opens the portal for the account's own customer and subscriptions only", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    const at = new Date();
    await prisma.paddleCustomer.createMany({ data: [
      { customerId: "ctm_mine", email: me.email, userId: me.id, paddleUpdatedAt: at },
      { customerId: "ctm_theirs", email: other.email, userId: other.id, paddleUpdatedAt: at },
    ] });
    await prisma.paddleSubscription.createMany({ data: [
      { subscriptionId: "sub_mine", customerId: "ctm_mine", status: "active", priceId: "p", productId: "p", paddleUpdatedAt: at },
      { subscriptionId: "sub_theirs", customerId: "ctm_theirs", status: "active", priceId: "p", productId: "p", paddleUpdatedAt: at },
    ] });
    await signIn(me);
    expect(await target()).toBe("https://sandbox-customer-portal.paddle.com/cpl_x?token=ctm_mine");
    expect(create).toHaveBeenCalledWith("ctm_mine", ["sub_mine"]);
  });
});
