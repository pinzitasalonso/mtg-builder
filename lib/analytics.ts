import prisma from "@/lib/prisma";

// The events we count. Server-trusted events (signup/login/deck_created) are
// recorded in their API routes; the rest can be reported by the client.
export const EVENT_TYPES = [
  "visit",
  "signup",
  "login",
  "deck_created",
  "deck_viewed",
  "ai_message",
  "card_search",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Events the public POST endpoint will accept from the browser. The trusted
// ones are only ever recorded server-side so they can't be spoofed.
export const CLIENT_EVENTS = new Set<EventType>(["visit", "deck_viewed", "ai_message", "card_search"]);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Bump today's counter for an event. Best-effort — analytics must never break a
// real request, so failures are swallowed.
export async function recordEvent(type: EventType): Promise<void> {
  const day = todayUTC();
  try {
    await prisma.analyticsDaily.upsert({
      where: { day_type: { day, type } },
      update: { count: { increment: 1 } },
      create: { day, type, count: 1 },
    });
  } catch {
    /* ignore */
  }
}

// The analytics dashboard is gated to a single configured email.
export function isAnalyticsAdmin(email: string | null | undefined): boolean {
  const admin = process.env.ANALYTICS_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(admin && email && email.trim().toLowerCase() === admin);
}
