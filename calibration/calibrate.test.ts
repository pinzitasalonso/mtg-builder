// The calibration run: every deck in decks/ scored and diffed against its
// reference. See README.md. Run with `npm run calibrate`; kept out of
// `npm test` because it reaches Scryfall and Commander Spellbook.

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardFactsByIds, collectionByName, type CardFacts } from "../lib/scryfall";
import { findCombos, type ComboLine } from "../lib/combos";
import { nameKey, type CardReading, type ScoredCard } from "../lib/deck-score-classify";
import { scoreDeck, type DeckScoreReport } from "../lib/deck-score-report";

interface DeckFile {
  name: string;
  source: { kind: "deckcheck" | "anchor"; [k: string]: unknown };
  commanders: string[];
  list: string[];
  expected: Record<string, number | [number, number]> & { tolerance?: number };
  cards?: Record<string, CardReading>;
  notes?: string;
}

const HERE = join(process.cwd(), "calibration");
const CACHE = join(HERE, ".cache.json");

/** Scryfall facts and Spellbook combos, cached on disk between runs. */
function loadCache(): { facts: Record<string, CardFacts>; ids: Record<string, string>; combos: Record<string, ComboLine[]> } {
  if (!existsSync(CACHE)) return { facts: {}, ids: {}, combos: {} };
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return { facts: {}, ids: {}, combos: {} };
  }
}

function parseLine(line: string): { name: string; quantity: number } {
  const m = line.trim().match(/^(\d+)x?\s+(.+)$/);
  return m ? { name: m[2]!.trim(), quantity: Number(m[1]) } : { name: line.trim(), quantity: 1 };
}

async function build(deck: DeckFile, cache: ReturnType<typeof loadCache>) {
  const commanders = new Set(deck.commanders.map(nameKey));
  const counts = new Map<string, number>();
  for (const line of deck.list) {
    const { name, quantity } = parseLine(line);
    counts.set(name, (counts.get(name) ?? 0) + quantity);
  }
  const missingNames = [...counts.keys()].filter((n) => !cache.ids[n.toLowerCase()]);
  if (missingNames.length) {
    const byName = await collectionByName(missingNames);
    for (const [k, c] of byName) cache.ids[k] = c.id;
  }
  const ids = [...counts.keys()].map((n) => cache.ids[n.toLowerCase()]).filter((id): id is string => Boolean(id));
  const missingIds = ids.filter((id) => !cache.facts[id]);
  if (missingIds.length) {
    const facts = await cardFactsByIds(missingIds);
    for (const [id, f] of facts) cache.facts[id] = f;
  }
  const cards: ScoredCard[] = [];
  const unresolved: string[] = [];
  for (const [name, quantity] of counts) {
    const id = cache.ids[name.toLowerCase()];
    const f = id ? cache.facts[id] : undefined;
    if (!f) {
      unresolved.push(name);
      continue;
    }
    cards.push({
      name: f.name,
      typeLine: f.typeLine ?? "",
      oracleText: f.oracleText ?? "",
      manaCost: f.manaCost,
      manaValue: f.manaValue,
      quantity,
      power: f.power,
      toughness: f.toughness,
      keywords: f.keywords,
      producedMana: f.producedMana,
      isCommander: commanders.has(nameKey(f.name)),
    });
  }
  const comboKey = cards.map((c) => `${nameKey(c.name)}x${c.quantity}${c.isCommander ? "*" : ""}`).sort().join("|");
  let combos = cache.combos[comboKey];
  if (!combos) {
    combos = (await findCombos(cards.map((c) => ({ name: c.name, quantity: c.quantity, isCommander: c.isCommander })))).combos;
    cache.combos[comboKey] = combos;
  }
  return { cards, combos, unresolved };
}

const fmt = (n: number) => String(Number(n.toFixed(2)));

function checkAxis(name: string, actual: number, expected: number | [number, number] | undefined, tolerance: number): string | null {
  if (expected === undefined) return null;
  if (Array.isArray(expected)) {
    const [lo, hi] = expected;
    return actual >= lo && actual <= hi ? null : `${name} ${fmt(actual)} outside ${lo}–${hi}`;
  }
  return Math.abs(actual - expected) <= tolerance ? null : `${name} ${fmt(actual)} vs ${expected} (Δ ${fmt(actual - expected)})`;
}

describe("calibration", () => {
  const files = readdirSync(join(HERE, "decks")).filter((f) => f.endsWith(".json")).sort();
  const cache = loadCache();
  const report: string[] = [];
  const failures: string[] = [];

  it(
    "scores every deck against its reference",
    async () => {
      for (const file of files) {
        const deck: DeckFile = JSON.parse(readFileSync(join(HERE, "decks", file), "utf8"));
        const { cards, combos, unresolved } = await build(deck, cache);
        const tolerance = deck.expected.tolerance ?? 0.75;
        const r: DeckScoreReport = scoreDeck(cards, combos, 2);

        report.push(`\n## ${deck.name} (${file})`);
        report.push(`Score ${r.label} · C ${fmt(r.consistency)} R ${fmt(r.resilience)} I ${fmt(r.interaction)} S ${fmt(r.speed)} · floor ${r.bracketFloor} · turn ${fmt(r.fundamentalTurn)} · ${combos.length} combos`);
        if (unresolved.length) report.push(`Unresolved on Scryfall: ${unresolved.join(", ")}`);

        const axisIssues = [
          checkAxis("index", r.index, deck.expected.index, tolerance),
          checkAxis("consistency", r.consistency, deck.expected.consistency, tolerance),
          checkAxis("resilience", r.resilience, deck.expected.resilience, tolerance),
          checkAxis("interaction", r.interaction, deck.expected.interaction, tolerance),
          checkAxis("speed", r.speed, deck.expected.speed, tolerance),
          checkAxis("bracket", r.bracketFloor, deck.expected.bracket, 0),
        ].filter((x): x is string => x !== null);
        for (const a of r.axes) {
          const e = deck.expected[a.key];
          const tag = e === undefined ? "" : Array.isArray(e) ? ` (want ${e[0]}–${e[1]})` : ` (want ${e}, Δ ${fmt(a.score - e)})`;
          report.push(`- ${a.label} ${fmt(a.score)}${tag} — ${a.summary}`);
        }

        const cardIssues: string[] = [];
        for (const [name, want] of Object.entries(deck.cards ?? {})) {
          const got = r.cardReadings[name] ?? {};
          const diffs: string[] = [];
          for (const key of ["tutor", "draw", "stack", "recursion", "threat"] as const) {
            if (want[key] === undefined) continue;
            const g = got[key] ?? (key === "stack" && got.piece ? 0 : 0);
            if (g !== want[key]) diffs.push(`${key} ${g} vs ${want[key]}`);
          }
          if (want.piece !== undefined && Boolean(got.piece) !== want.piece) diffs.push(`piece ${Boolean(got.piece)} vs ${want.piece}`);
          if (diffs.length) cardIssues.push(`${name}: ${diffs.join(", ")}`);
        }
        if (deck.cards) report.push(`Cards checked: ${Object.keys(deck.cards).length}, differing: ${cardIssues.length}`);
        for (const c of cardIssues) report.push(`  ✗ ${c}`);
        for (const a of axisIssues) report.push(`  ✗ ${a}`);
        if (!axisIssues.length && !cardIssues.length) report.push("  ✓ within tolerance");
        for (const a of axisIssues) failures.push(`${deck.name}: ${a}`);
      }

      mkdirSync(HERE, { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache));
      const text = `# Calibration run ${new Date().toISOString()}\n${report.join("\n")}\n`;
      writeFileSync(join(HERE, "last-run.md"), text);
      console.log(text);
      // Card diffs are findings, not failures: the reference is DeckCheck's
      // reading of a card and ours can legitimately differ. Axes out of
      // tolerance fail the run.
      expect(failures, failures.join("\n")).toEqual([]);
    },
    600_000
  );
});
