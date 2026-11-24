"use client";

import { useEffect, useSyncExternalStore } from "react";

/* What the signed-in account has left today, for the screens that show the
   way to Spellpool Pro. One read of /api/auth/me shared by everything on the
   page; a screen that has just spent something asks for a fresh read. */

export interface Plan {
  signedIn: boolean;
  pro: boolean;
  /** Coach questions left today. null is "no limit" (Pro). */
  ai: number | null;
  /** Deck scans left today. null is "no limit" (Pro). */
  scans: number | null;
}

let plan: Plan | null = null;
let loading = false;
const listeners = new Set<() => void>();

function set(next: Plan | null) {
  plan = next;
  listeners.forEach((l) => l());
}

/** Read the account's plan again: after a question, a scan, or a refusal. */
export function refreshPlan(): void {
  if (loading || typeof window === "undefined") return;
  loading = true;
  fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      if (!b) return;
      const u = b.user;
      set(u ? { signedIn: true, pro: u.tier === "pro", ai: u.aiRemaining ?? null, scans: u.scansRemaining ?? null } : { signedIn: false, pro: false, ai: null, scans: null });
    })
    .catch(() => {})
    .finally(() => {
      loading = false;
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The plan, or null until it has loaded (and while offline). */
export function usePlan(): Plan | null {
  const value = useSyncExternalStore(subscribe, () => plan, () => null);
  useEffect(() => {
    if (!plan) refreshPlan();
  }, []);
  return value;
}

/* Where the player was when they went to look at the plans, so the welcome
   page after checkout can lead back there. Kept for the tab only. */
const FROM_KEY = "sp-upgrade-from";
export function rememberUpgradeFrom(): void {
  try {
    const here = window.location.pathname;
    if (here.startsWith("/deck/")) sessionStorage.setItem(FROM_KEY, here);
    else sessionStorage.removeItem(FROM_KEY);
  } catch {}
}
export function upgradeFrom(): string | null {
  try {
    const v = sessionStorage.getItem(FROM_KEY);
    return v && /^\/deck\/[A-Za-z0-9_-]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
