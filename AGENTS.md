<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Spellpool web + backend (mtg-builder)

Next.js 16 (App Router, Turbopack) + Prisma 7 on better-sqlite3. **Railway auto-deploys every push to `main` to https://www.spellpool.com in ~3–5 min — a push is a production deploy; verify first.** This app is also the backend for the iOS app (`kukukaka/spellpool`).

## Commands

- Typecheck: `npx tsc --noEmit` · Tests: `npx vitest run` · Dev: `npm run dev`
- Styling changes: verify on a production build (`npm run build && npx next start -p 4310`) — Turbopack dev HMR can half-apply (server module updates while the client bundle stays stale).

## Architecture

- API routes under `app/api/*` serve both clients: auth (session cookie), decks/cards/roles, collection, AI chat (streaming), play codes, subscription.
- Tiers: `User.tier` is written by the RevenueCat webhook (`app/api/revenuecat/webhook`) and `app/api/subscription/sync`, both via `lib/revenuecat.ts` `isProOnRevenueCat` — **tri-state**: a null (indeterminate) result must never change a stored tier; the webhook returns 500 on null so RevenueCat retries. Clients read tier from `/api/auth/me`. Free limits in `lib/limits.ts`; upgrade copy points at Spellpool Pro in the iOS app.
- Theming: `lib/identity-theme.ts` — a deck page's ground is its identity field sinking into a darkened cut of itself (mono + ten guilds hand-tuned, charcoal B, 3+ colors blend the monos); empty identity → the indigo felt. `LIGHT_VARS` is, despite the name, the dark panel set. Floating panels ride the JS-computed `--panel` var.
- Play codes are single-use with per-IP throttles; security headers are set app-wide.

## Gotchas

- Tailwind v4 (lightningcss) **mangles `color-mix()`** in globals.css — compute mixes in JS and set CSS vars (that's why `--panel` exists).
- Railway env-var edits stage until Deploy is clicked.
- JSX collapses the space after an inline closing tag (`</b> text`) — use `{" "}`.
- RevenueCat v1 subscriber reads work with the **public `appl_` key**; V2 `sk_` keys fail those endpoints and must never be committed or handled.

## Conventions

- tsc + vitest green before committing. Commit + push verified work; end messages with a `Co-Authored-By: Claude …` line.
- Deeper context for a Claude Project (chat): `docs/claude-project-instructions.md` in the iOS repo.
