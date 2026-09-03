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
- Deck Score: `lib/deck-score.ts` is the rubric maths (DeckCheck's published CRISPI ladders), `lib/deck-score-classify.ts` reads a decklist into its counts (curated staples in `lib/deck-score-cards.ts`, oracle text for the rest), `lib/goldfish.ts` simulates hands for the Speed axis, `lib/deck-score-report.ts` assembles the payload, and `lib/deck-analysis.ts` is the AI's written analysis plus its two bounded judgement calls. `app/api/decks/[id]/scan` runs both on demand (metered: one free scan a day, unlimited on Pro) and stores the result on `Deck.analysis` for both clients. A card scored wrongly is fixed by a line in the cards file, not by a special case in the classifier. `npm run calibrate` scores the reference decks in `calibration/decks/` (DeckCheck scans with per-card points, plus rubric anchors) and diffs axes and cards — run it after any scoring change; it is not part of `npm test` because it hits Scryfall and Spellbook.

## Gotchas

- Tailwind v4 (lightningcss) **mangles `color-mix()`** in globals.css — compute mixes in JS and set CSS vars (that's why `--panel` exists).
- Railway env-var edits stage until Deploy is clicked.
- JSX collapses the space after an inline closing tag (`</b> text`) — use `{" "}`.
- RevenueCat v1 subscriber reads work with the **public `appl_` key**; V2 `sk_` keys fail those endpoints and must never be committed or handled.

## Conventions

- tsc + vitest green before committing. Commit + push verified work.
- **Keep chat replies short.** Say what changed and what's unverified. Skip the rationale unless Kike asks for it, or it's a decision he has to make. The commit message and the PR body are where the reasoning goes.
- **Use plain language, short sentences, and avoid dense or overly compressed phrasing.** One idea per sentence. Don't stack clauses to save a line.
- No `Co-Authored-By: Claude …` trailer — not in commits, not in chat replies.
- Deeper context for a Claude Project (chat): `docs/claude-project-instructions.md` in the iOS repo.
