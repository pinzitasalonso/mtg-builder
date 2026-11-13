import { prisma, makeUser } from "@/test/db";
import crypto from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/paddle/webhook/route";
import { customerIdsFor, grantsAccess, hasPaidAccess } from "@/lib/paddle-billing";

const SECRET = "pdl_ntfset_test_secret";
// Paddle's sandbox webhook addresses, as <api>/ips answers.
const PADDLE_IP = "44.241.183.62";
let ipsUp = true;
vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  if (ipsUp && String(url) === "https://sandbox-api.paddle.com/ips") {
    return Response.json({ data: { ipv4_cidrs: ["3.208.120.145/32", `${PADDLE_IP}/32`, "100.20.172.113/32"] } });
  }
  throw new Error("no network in tests");
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_PADDLE_ENV = "sandbox";
  process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test";
  process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET = SECRET;
});

// Signed the way Paddle signs: h1 = HMAC-SHA256(secret, "<ts>:<raw body>").
function delivery(event: object, secret = SECRET, ts = Math.floor(Date.now() / 1000), from = PADDLE_IP) {
  const body = JSON.stringify(event);
  const h1 = crypto.createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  return new Request("http://test.local/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": `ts=${ts};h1=${h1}`, "content-type": "application/json", "x-forwarded-for": `${from}, 100.64.0.1` },
    body,
  });
}

let n = 0;
// Shaped on real sandbox payloads (a trial checkout's events).
function subscriptionEvent(o: {
  type?: string; id?: string; customer?: string; status?: string; updatedAt?: string;
  scheduled?: { action: string; effective_at: string } | null; userId?: string;
}) {
  n += 1;
  return {
    event_id: `evt_${n}`,
    event_type: o.type ?? "subscription.trialing",
    occurred_at: o.updatedAt ?? "2026-11-13T23:03:32.753Z",
    notification_id: `ntf_${n}`,
    data: {
      id: o.id ?? "sub_1",
      status: o.status ?? "trialing",
      customer_id: o.customer ?? "ctm_1",
      address_id: "add_1",
      business_id: null,
      currency_code: "GBP",
      created_at: "2026-11-13T23:03:32.595Z",
      updated_at: o.updatedAt ?? "2026-11-13T23:03:32.595Z",
      started_at: "2026-11-13T23:03:32.59Z",
      first_billed_at: null,
      next_billed_at: "2026-11-20T23:03:32.59Z",
      paused_at: null,
      canceled_at: null,
      discount: null,
      collection_mode: "automatic",
      billing_details: null,
      current_billing_period: { ends_at: "2026-11-20T23:03:32.59Z", starts_at: "2026-11-13T23:03:32.59Z" },
      billing_cycle: { interval: "month", frequency: 1 },
      scheduled_change: o.scheduled ?? null,
      items: [{
        price: {
          id: "pri_01m7bj4tpvyfx517wpnghebkx5", product_id: "pro_01m7bj4tk7xxmpfzz6srv1prmy", name: "Monthly",
          description: "Starter monthly USD", type: "standard", status: "active", tax_mode: "location",
          unit_price: { amount: "1000", currency_code: "USD" }, unit_price_overrides: [],
          billing_cycle: { interval: "month", frequency: 1 },
          trial_period: { interval: "day", frequency: 7, requires_payment_method: true },
          quantity: { maximum: 100, minimum: 1 }, custom_data: null, import_meta: null,
          created_at: "2026-11-13T22:58:39.451Z", updated_at: "2026-11-13T22:58:39.451Z",
        },
        status: "trialing", quantity: 1, recurring: true,
        created_at: "2026-11-13T23:03:32.595Z", updated_at: "2026-11-13T23:03:32.595Z",
        next_billed_at: "2026-11-20T23:03:32.59Z", previously_billed_at: null,
        trial_dates: { ends_at: "2026-11-20T23:03:32.59Z", starts_at: "2026-11-13T23:03:32.59Z" },
      }],
      custom_data: o.userId ? { userId: o.userId } : null,
      consent_requirements: [],
      import_meta: null,
    },
  };
}

function customerEvent(o: { id?: string; email: string; updatedAt?: string; type?: string }) {
  n += 1;
  return {
    event_id: `evt_${n}`,
    event_type: o.type ?? "customer.created",
    occurred_at: o.updatedAt ?? "2026-11-13T23:03:27.484Z",
    notification_id: `ntf_${n}`,
    data: {
      id: o.id ?? "ctm_1", name: null, email: o.email, marketing_consent: false, status: "active",
      custom_data: null, locale: "en", created_at: "2026-11-13T23:03:27.478Z",
      updated_at: o.updatedAt ?? "2026-11-13T23:03:27.478Z", import_meta: null,
    },
  };
}

describe("/api/paddle/webhook", () => {
  it("rejects a bad signature with a non-2xx and writes nothing", async () => {
    const res = await POST(delivery(customerEvent({ id: "ctm_forged", email: "x@example.com" }), "wrong_secret"));
    expect(res.status).toBe(500);
    expect(await prisma.paddleCustomer.findUnique({ where: { customerId: "ctm_forged" } })).toBeNull();
  });

  it("rejects an old signature timestamp (a replay)", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const res = await POST(delivery(customerEvent({ id: "ctm_replay", email: "x@example.com" }), SECRET, old));
    expect(res.status).toBe(500);
  });

  it("rejects a body that was changed after signing", async () => {
    const req = delivery(customerEvent({ id: "ctm_tamper", email: "a@example.com" }));
    const sig = req.headers.get("paddle-signature")!;
    const body = (await req.text()).replace("a@example.com", "b@example.com");
    const res = await POST(new Request(req.url, { method: "POST", headers: { "paddle-signature": sig, "x-forwarded-for": PADDLE_IP }, body }));
    expect(res.status).toBe(500);
  });

  it("is a 400 without a signature", async () => {
    const res = await POST(new Request("http://test.local/api/paddle/webhook", { method: "POST", body: "{}", headers: { "x-forwarded-for": PADDLE_IP } }));
    expect(res.status).toBe(400);
  });

  it("refuses a correctly signed delivery from an address that isn't Paddle's", async () => {
    const res = await POST(delivery(customerEvent({ id: "ctm_elsewhere", email: "x@example.com" }), SECRET, undefined, "203.0.113.9"));
    expect(res.status).toBe(403);
    expect(await prisma.paddleCustomer.findUnique({ where: { customerId: "ctm_elsewhere" } })).toBeNull();
  });

  it("mirrors a subscription that arrives before its customer, and a repeat changes nothing", async () => {
    const sub = subscriptionEvent({ id: "sub_order", customer: "ctm_order" });
    expect((await POST(delivery(sub))).status).toBe(200);
    expect((await POST(delivery(sub))).status).toBe(200);
    expect((await POST(delivery(customerEvent({ id: "ctm_order", email: "Order@Example.com" })))).status).toBe(200);

    const row = await prisma.paddleSubscription.findUniqueOrThrow({ where: { subscriptionId: "sub_order" } });
    expect(row).toMatchObject({
      status: "trialing", customerId: "ctm_order",
      priceId: "pri_01m7bj4tpvyfx517wpnghebkx5", productId: "pro_01m7bj4tk7xxmpfzz6srv1prmy",
    });
    expect(await prisma.paddleSubscription.count({ where: { subscriptionId: "sub_order" } })).toBe(1);
    expect((await prisma.paddleCustomer.findUniqueOrThrow({ where: { customerId: "ctm_order" } })).email).toBe("order@example.com");
  });

  it("skips an older event that arrives after a newer one", async () => {
    const id = "sub_late";
    await POST(delivery(subscriptionEvent({ id, type: "subscription.canceled", status: "canceled", updatedAt: "2026-12-01T00:00:00Z" })));
    await POST(delivery(subscriptionEvent({ id, type: "subscription.activated", status: "active", updatedAt: "2026-11-20T00:00:00Z" })));
    expect((await prisma.paddleSubscription.findUniqueOrThrow({ where: { subscriptionId: id } })).status).toBe("canceled");
  });

  it("keeps access through a scheduled cancel, and ends it when the cancel happens", async () => {
    const user = await makeUser();
    const id = "sub_sched";
    await POST(delivery(subscriptionEvent({ id, customer: "ctm_sched", status: "active", type: "subscription.activated", userId: String(user.id), updatedAt: "2026-11-21T00:00:00Z" })));
    await POST(delivery(subscriptionEvent({
      id, customer: "ctm_sched", status: "active", type: "subscription.updated", updatedAt: "2026-11-22T00:00:00Z",
      scheduled: { action: "cancel", effective_at: "2026-12-21T00:00:00Z" },
    })));
    const row = await prisma.paddleSubscription.findUniqueOrThrow({ where: { subscriptionId: id } });
    expect(row.scheduledChangeAction).toBe("cancel");
    expect(row.userId).toBe(user.id);
    expect(await hasPaidAccess(user)).toBe(true);

    await POST(delivery(subscriptionEvent({ id, customer: "ctm_sched", status: "canceled", type: "subscription.canceled", updatedAt: "2026-12-21T00:00:01Z" })));
    expect(await hasPaidAccess(user)).toBe(false);
  });

  it("acknowledges event types it doesn't handle", async () => {
    const res = await POST(delivery({ event_id: "evt_x", event_type: "address.created", occurred_at: "2026-11-13T23:03:27Z", notification_id: "ntf_x", data: {
      id: "add_1", customer_id: "ctm_1", description: null, first_line: null, second_line: null, city: null,
      postal_code: "SW1A 1AA", region: null, country_code: "GB", custom_data: null, status: "active",
      created_at: "2026-11-13T23:03:27Z", updated_at: "2026-11-13T23:03:27Z", import_meta: null,
    } }));
    expect(res.status).toBe(200);
  });

  it("links a checkout's customer to the account named in customData, and never moves it", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await POST(delivery(customerEvent({ id: "ctm_link", email: a.email })));
    const txn = (userId: number) => ({
      event_id: `evt_t${userId}`, event_type: "transaction.completed", occurred_at: "2026-11-13T23:03:33Z", notification_id: `ntf_t${userId}`,
      data: {
        id: `txn_${userId}`, status: "completed", customer_id: "ctm_link", address_id: null, business_id: null,
        custom_data: { userId: String(userId) }, currency_code: "GBP", origin: "web", subscription_id: null,
        invoice_id: null, invoice_number: null, collection_mode: "automatic", discount_id: null, billing_details: null,
        billing_period: null, items: [], details: null, payments: [], checkout: null,
        created_at: "2026-11-13T23:03:26Z", updated_at: "2026-11-13T23:03:33Z", billed_at: null, revised_at: null,
      },
    });
    expect((await POST(delivery(txn(a.id)))).status).toBe(200);
    expect((await POST(delivery(txn(b.id)))).status).toBe(200);
    expect((await prisma.paddleCustomer.findUniqueOrThrow({ where: { customerId: "ctm_link" } })).userId).toBe(a.id);
  });

  it("won't link a customer whose email isn't the account's, whatever customData says", async () => {
    const intruder = await makeUser();
    await POST(delivery(customerEvent({ id: "ctm_victim", email: "victim@example.com" })));
    await POST(delivery(subscriptionEvent({ id: "sub_intruder", customer: "ctm_victim", userId: String(intruder.id) })));
    expect((await prisma.paddleCustomer.findUniqueOrThrow({ where: { customerId: "ctm_victim" } })).userId).toBeNull();
    expect(await customerIdsFor(intruder)).toEqual([]);
  });
});

describe("access", () => {
  it("is granted by active, trialing and past_due only", () => {
    expect(["active", "trialing", "past_due", "paused", "canceled"].map((status) => grantsAccess({ status })))
      .toEqual([true, true, true, false, false]);
    expect(grantsAccess(null)).toBe(false);
  });

  it("matches a customer by email only when the account's email is verified", async () => {
    await POST(delivery(customerEvent({ id: "ctm_mail", email: "mail@example.com" })));
    const user = await makeUser({ email: "mail@example.com" });
    expect(await customerIdsFor(user)).toEqual([]);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect(await customerIdsFor(user)).toEqual(["ctm_mail"]);
  });
});
