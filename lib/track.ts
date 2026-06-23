// Tiny client-side event beacon. Sends ONLY an event name — no cookies, no ids,
// no personal data — to the first-party analytics endpoint. Fire-and-forget.
export function track(type: "visit" | "deck_viewed" | "ai_message" | "card_search"): void {
  if (typeof navigator === "undefined") return;
  try {
    const body = JSON.stringify({ type });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    }
  } catch {
    /* never let analytics throw */
  }
}
