import { afterEach, describe, expect, it, vi } from "vitest";
import { ipInCidrs, paddleWebhookCidrs } from "@/lib/paddle-ips";

describe("ipInCidrs", () => {
  const cidrs = ["34.237.3.244/32", "10.1.0.0/16"];
  it("matches /32s and wider ranges", () => {
    expect(ipInCidrs("34.237.3.244", cidrs)).toBe(true);
    expect(ipInCidrs("34.237.3.245", cidrs)).toBe(false);
    expect(ipInCidrs("10.1.200.7", cidrs)).toBe(true);
    expect(ipInCidrs("10.2.0.1", cidrs)).toBe(false);
  });
  it("reads an IPv6-mapped IPv4, and refuses anything unparseable", () => {
    expect(ipInCidrs("::ffff:34.237.3.244", cidrs)).toBe(true);
    expect(ipInCidrs("unknown", cidrs)).toBe(false);
    expect(ipInCidrs("34.237.3.244.1", cidrs)).toBe(false);
    expect(ipInCidrs("999.237.3.244", cidrs)).toBe(false);
  });
});

describe("paddleWebhookCidrs", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fails without a list, then keeps the last good one when a refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await expect(paddleWebhookCidrs("production")).rejects.toThrow(/webhook IPs/);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { ipv4_cidrs: ["34.237.3.244/32"] } })));
    expect(await paddleWebhookCidrs("production")).toEqual(["34.237.3.244/32"]);
  });
  it("refuses a malformed answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { ipv4_cidrs: ["nope"] } })));
    await expect(paddleWebhookCidrs("sandbox")).rejects.toThrow();
  });
});
