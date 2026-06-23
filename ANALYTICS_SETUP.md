# Analytics — finish setup

The privacy-respecting analytics system is built (see PR on branch
`claude/analytics`). Two things remain to turn it on for you.

## 1. Merge the PR
Merge `claude/analytics` into `main` (if it isn't already) and let Railway
redeploy. On deploy, `prisma db push` creates the new `AnalyticsDaily` table
automatically — no migration step needed.

## 2. Set the admin email
In Railway → your service → **Variables**, add:

```
ANALYTICS_ADMIN_EMAIL = pinzitasalonso@gmail.com
```

(Use whichever account email you sign in with.) Redeploy so it takes effect.

Until this is set, the dashboard returns 403 for everyone — that's the safe
default, so analytics is locked unless you explicitly name the admin.

## 3. View the dashboard
Sign in with that email and open **`/admin`**. You'll see:
- Total users and total decks (live counts)
- Visits, signups, logins, decks created, deck views, AI messages, card searches
- A 30-day chart with a metric switcher
- All-time totals per event

## What it tracks (and what it doesn't)
- **No** cookies, IP addresses, user agents, per-user rows, or third-party scripts.
- Only **per-day counts** of events in the `AnalyticsDaily` table (`day`, `type`, `count`).
- `signup` / `login` / `deck_created` are recorded server-side (can't be spoofed).
- `visit` / `deck_viewed` / `ai_message` / `card_search` come from a tiny
  `navigator.sendBeacon` that sends only the event name.

## Reading the raw user count on Railway (optional)
If you want the number before the dashboard is up, open the Railway shell /
SQLite console for the deployed DB and run:

```sql
SELECT COUNT(*) FROM User;
```

(or `SELECT COUNT(*) FROM Deck;` for decks).
