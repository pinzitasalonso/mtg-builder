import { describe, expect, it } from "vitest";
import { decideLink, rejectionMessage, type ExistingState, type ProviderIdentity } from "./oauth-link";

const identity = (over: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  provider: "google",
  providerAccountId: "sub-123",
  email: "kike@example.com",
  emailVerified: true,
  isPrivateRelay: false,
  displayName: null,
  ...over,
});

const state = (over: Partial<ExistingState> = {}): ExistingState => ({
  linkedUserId: null,
  emailUserId: null,
  emailUserVerified: false,
  ...over,
});

describe("decideLink", () => {
  it("signs in a subject we already know", () => {
    expect(decideLink(identity(), state({ linkedUserId: 7 }))).toEqual({
      action: "signin",
      userId: 7,
    });
  });

  // The subject is the join key, never the address. Someone who changes their
  // Google email keeps their Spellpool account — and Apple stops sending an
  // address at all after the first authorization.
  it("signs in a known subject even when the address changed or vanished", () => {
    expect(
      decideLink(identity({ email: "new-address@example.com" }), state({ linkedUserId: 7, emailUserId: 99 }))
    ).toEqual({ action: "signin", userId: 7 });
    expect(decideLink(identity({ email: null }), state({ linkedUserId: 7 }))).toEqual({
      action: "signin",
      userId: 7,
    });
  });

  it("creates an account for a new subject with a verified address", () => {
    expect(decideLink(identity(), state())).toEqual({
      action: "create",
      email: "kike@example.com",
    });
  });

  it("links a verified address to the account that already uses it", () => {
    expect(decideLink(identity(), state({ emailUserId: 5, emailUserVerified: true }))).toEqual({
      action: "link",
      userId: 5,
      markVerified: false,
    });
  });

  // The provider just proved control of the inbox, which is what our own
  // verification email asks for — so this also finishes a stalled signup.
  it("verifies an account stuck at 'check your email' while linking it", () => {
    expect(decideLink(identity(), state({ emailUserId: 5, emailUserVerified: false }))).toEqual({
      action: "link",
      userId: 5,
      markVerified: true,
    });
  });

  // Otherwise anyone who can get an unverified address into a provider
  // profile could walk into the matching Spellpool account.
  it("refuses to reach an existing account on an UNVERIFIED address", () => {
    expect(
      decideLink(identity({ emailVerified: false }), state({ emailUserId: 5, emailUserVerified: true }))
    ).toEqual({ action: "reject", reason: "email-unverified-conflict" });
  });

  it("still creates an account when an unverified address collides with nobody", () => {
    expect(decideLink(identity({ emailVerified: false }), state())).toEqual({
      action: "create",
      email: "kike@example.com",
    });
  });

  it("rejects a first-time subject with no address to go on", () => {
    expect(decideLink(identity({ email: null }), state())).toEqual({
      action: "reject",
      reason: "email-required",
    });
  });

  // Documented consequence, asserted so it stays a decision and not an
  // accident: Hide My Email gives a stable, verified relay address that
  // matches no real account, so it makes a SECOND account. We cannot prove
  // the relay and a real address belong to the same person.
  it("creates a separate account for an Apple relay address", () => {
    const relay = identity({
      provider: "apple",
      providerAccountId: "001234.abc.0000",
      email: "xyz@privaterelay.appleid.com",
      isPrivateRelay: true,
    });
    expect(decideLink(relay, state())).toEqual({
      action: "create",
      email: "xyz@privaterelay.appleid.com",
    });
    // And every later sign-in finds it by subject, not by address.
    expect(decideLink(relay, state({ linkedUserId: 12 }))).toEqual({
      action: "signin",
      userId: 12,
    });
  });

  // A linked subject wins before the email is even looked at, so a relay
  // address can never be talked into another account.
  it("never lets a relay address link to a real one", () => {
    const relay = identity({
      provider: "apple",
      email: "xyz@privaterelay.appleid.com",
      isPrivateRelay: true,
    });
    expect(decideLink(relay, state({ emailUserId: null }))).toMatchObject({ action: "create" });
  });
});

describe("rejectionMessage", () => {
  // Both rejections land in front of someone whose sign-in button just
  // failed, so both have to say what to do next.
  it("tells an Apple user how to get their email back", () => {
    const msg = rejectionMessage("email-required");
    expect(msg).toContain("Settings");
    expect(msg).toContain("Stop Using Apple ID");
  });

  it("tells a conflicting user to sign in with a password first", () => {
    expect(rejectionMessage("email-unverified-conflict")).toContain("password");
  });
});
