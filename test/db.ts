// A real database for a route test: each test file that imports this gets
// its own empty SQLite file (the app's schema, nothing in it), and the
// app's own Prisma client on it. Import it BEFORE the route under test.
//
//   import { prisma, signIn, makeUser } from "@/test/db";
//   import { POST } from "@/app/api/wishlist/route";
//
// Nothing here reaches the network: fetch is stubbed to fail, which the app
// treats as Scryfall being down.

import "./db-env";
import fs from "node:fs";
import { afterAll, vi } from "vitest";
import { createSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { dbDir } from "./db-env";
import { cookieJar } from "./next-headers";

export { prisma };

vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    throw new Error("no network in tests");
  })
);

afterAll(async () => {
  await prisma.$disconnect();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

let n = 0;

/** A new account. */
export function makeUser(data: { email?: string; tier?: string } = {}) {
  n += 1;
  return prisma.user.create({ data: { email: data.email ?? `player${n}@example.com`, tier: data.tier ?? "free" } });
}

/** Sign this account in: the routes' currentUser() now answers with it. */
export async function signIn(user: { id: number }) {
  cookieJar.clear();
  await createSession(user.id);
}

export function signOut() {
  cookieJar.clear();
}

/** A JSON request, as a client would send it. */
export function jsonRequest(url: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`http://test.local${url}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A route's `{ params }` argument. */
export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
