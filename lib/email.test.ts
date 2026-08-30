import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailConfigured,
  sendAccountExistsEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";

type Init = { method: string; headers: Record<string, string>; body: string };

function mockFetch(status = 200, body = "") {
  const fn = vi.fn(async (_url: string, _init: Init) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sentBody = (fn: ReturnType<typeof mockFetch>) => JSON.parse(fn.mock.calls[0]![1].body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("without an API key", () => {
  it("logs the link instead of sending, and does not throw", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchFn = mockFetch();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(emailConfigured()).toBe(false);
    await sendVerificationEmail("a@b.co", "https://x/verify?token=t");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(log.mock.calls[0]![0]).toContain("https://x/verify?token=t");
    log.mockRestore();
  });
});

describe("with an API key", () => {
  it("posts to Resend with the key and both bodies", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Spellpool <hi@spellpool.com>");
    const fetchFn = mockFetch();
    await sendVerificationEmail("a@b.co", "https://x/verify?token=t");

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");

    const body = sentBody(fetchFn);
    expect(body.from).toBe("Spellpool <hi@spellpool.com>");
    expect(body.to).toEqual(["a@b.co"]);
    expect(body.subject).toContain("Verify");
    // Both parts carry the link — a text-only client still has a way through.
    expect(body.text).toContain("https://x/verify?token=t");
    expect(body.html).toContain("https://x/verify?token=t");
  });

  it("throws with the status when Resend rejects it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mockFetch(422, "domain not verified");
    await expect(sendVerificationEmail("a@b.co", "https://x/v")).rejects.toThrow(/422/);
  });

  it("says an hour and single use in the reset email", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchFn = mockFetch();
    await sendPasswordResetEmail("a@b.co", "https://x/reset?token=t");
    const body = sentBody(fetchFn);
    expect(body.subject).toContain("Reset");
    expect(body.text).toContain("expires in an hour");
    expect(body.text).toContain("works once");
    expect(body.html).toContain("https://x/reset?token=t");
  });

  // This is the email that makes the signup enumeration fix honest: the
  // response says "check your inbox" for an address that already exists, so
  // something useful has to actually arrive.
  it("points an existing account at sign-in, not at signup", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchFn = mockFetch();
    await sendAccountExistsEmail("a@b.co", "https://x/login");
    const body = sentBody(fetchFn);
    expect(body.text).toContain("already have one");
    expect(body.text).toContain("https://x/login");
    expect(body.text).toContain("Forgot your password?");
  });

  it("tells a password-change notice recipient what to do if it wasn't them", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchFn = mockFetch();
    await sendPasswordChangedEmail("a@b.co", "https://x/login");
    const body = sentBody(fetchFn);
    expect(body.text).toContain("signed out");
    expect(body.html).toContain("https://x/login");
  });
});
