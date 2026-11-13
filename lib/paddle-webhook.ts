// What a verified Paddle event does to the mirror (lib/paddle-billing.ts).
//
// Paddle delivers at least once and in any order, so every handler is an
// upsert keyed on Paddle's id, applied only when the event's state is at
// least as new as the row's (Paddle's updated_at). A repeat changes nothing;
// a late, older event is skipped. Nothing here deletes a row.

import {
  type CustomerCreatedEvent,
  type CustomerUpdatedEvent,
  type EventEntity,
  EventName,
  type SubscriptionActivatedEvent,
  type SubscriptionCanceledEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionPastDueEvent,
  type SubscriptionPausedEvent,
  type SubscriptionResumedEvent,
  type SubscriptionTrialingEvent,
  type SubscriptionUpdatedEvent,
  type TransactionCompletedEvent,
} from "@paddle/paddle-node-sdk";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// Every event that carries a whole subscription. Paddle doesn't always send
// subscription.created: a trial checkout sent subscription.trialing alone, so
// all of them write the same row.
type SubscriptionEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCanceledEvent
  | SubscriptionTrialingEvent
  | SubscriptionActivatedEvent
  | SubscriptionPastDueEvent
  | SubscriptionPausedEvent
  | SubscriptionResumedEvent;

export async function processPaddleEvent(event: EventEntity): Promise<void> {
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionTrialing:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
      return upsertSubscription(event);
    case EventName.CustomerCreated:
    case EventName.CustomerUpdated:
      return upsertCustomer(event);
    case EventName.TransactionCompleted:
      return linkTransaction(event);
    default:
      // Not one of ours: acknowledged and ignored.
      return;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// The Spellpool account a signed-in checkout named in customData. It's
// client-supplied, so it only ever fills an empty link (never moves one),
// and only to an account that exists.
async function accountFrom(customData: unknown): Promise<number | null> {
  const raw = (customData as { userId?: unknown } | null)?.userId;
  const id = typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return user?.id ?? null;
}

async function upsertSubscription(event: SubscriptionEvent): Promise<void> {
  const sub = event.data;
  const item = sub.items[0];
  const at = new Date(sub.updatedAt);
  const data = {
    customerId: sub.customerId,
    status: sub.status,
    priceId: item?.price?.id ?? "",
    productId: item?.price?.productId ?? "",
    scheduledChangeAction: sub.scheduledChange?.action ?? null,
    scheduledChangeAt: sub.scheduledChange?.effectiveAt ? new Date(sub.scheduledChange.effectiveAt) : null,
    paddleUpdatedAt: at,
  };
  const updated = await prisma.paddleSubscription.updateMany({
    where: { subscriptionId: sub.id, paddleUpdatedAt: { lte: at } },
    data,
  });
  if (updated.count === 0) {
    try {
      await prisma.paddleSubscription.create({ data: { subscriptionId: sub.id, ...data } });
    } catch (e) {
      // The row exists and is newer than this event: nothing to do.
      if (!isUniqueViolation(e)) throw e;
    }
  }
  const userId = await accountFrom(sub.customData);
  if (userId) await linkAccount(userId, sub.customerId, sub.id);
}

async function upsertCustomer(event: CustomerCreatedEvent | CustomerUpdatedEvent): Promise<void> {
  const c = event.data;
  const at = new Date(c.updatedAt);
  const data = { email: c.email.toLowerCase(), paddleUpdatedAt: at };
  const updated = await prisma.paddleCustomer.updateMany({
    where: { customerId: c.id, paddleUpdatedAt: { lte: at } },
    data,
  });
  if (updated.count === 0) {
    try {
      await prisma.paddleCustomer.create({ data: { customerId: c.id, ...data } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  const userId = await accountFrom(c.customData);
  if (userId) await linkAccount(userId, c.id, null);
}

// A completed payment carries the checkout's customData: link its customer
// and subscription to the account, if they aren't linked yet. The rows
// themselves come from the customer and subscription events.
async function linkTransaction(event: TransactionCompletedEvent): Promise<void> {
  const t = event.data;
  const userId = await accountFrom(t.customData);
  if (userId && t.customerId) await linkAccount(userId, t.customerId, t.subscriptionId);
}

// customData is client-supplied, and a Paddle checkout reuses the existing
// customer for an email. So a customer is linked only when its email is the
// account's own (the checkout fills in and locks that email): a checkout typed
// with someone else's email can't attach their customer, and its portal, to
// another account. If the customer row hasn't arrived yet, a later event links
// it, or the verified-email match in customerIdsFor covers it.
async function linkAccount(userId: number, customerId: string, subscriptionId: string | null): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user) {
    await prisma.paddleCustomer.updateMany({
      where: { customerId, userId: null, email: user.email.toLowerCase() },
      data: { userId },
    });
  }
  if (subscriptionId) {
    await prisma.paddleSubscription.updateMany({ where: { subscriptionId, userId: null }, data: { userId } });
  }
}
