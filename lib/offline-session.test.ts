import { beforeEach, describe, expect, it } from "vitest";
import { forgetSession, offlineSession, rememberSession } from "./offline-session";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("offline session", () => {
  it("keeps the last signed-in user for a day", () => {
    rememberSession({ email: "kike@example.com" });
    expect(offlineSession<{ email: string }>()?.email).toBe("kike@example.com");
    expect(offlineSession(Date.now() + 23 * 3600 * 1000)).not.toBeNull();
  });
  it("lets it go after a day", () => {
    rememberSession({ email: "kike@example.com" });
    expect(offlineSession(Date.now() + 25 * 3600 * 1000)).toBeNull();
  });
  it("forgets on sign-out", () => {
    rememberSession({ email: "kike@example.com" });
    forgetSession();
    expect(offlineSession()).toBeNull();
  });
});
