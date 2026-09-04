// Ingest the Scryfall oracle bulk file and run every commander-legal card
// through our own classifier, one card at a time, into calibration.db.
//
// Usage: npx tsx calibration/db/build-cards.ts <oracle.jsonl> <out.db>

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import Database from "better-sqlite3";
import {
  classify, nameKey, tutorReading, drawReading, interactionReadingCard,
  threatReading, recursionReading, manaProduced, type ScoredCard,
} from "../../lib/deck-score-classify";
import { toSimCard } from "../../lib/goldfish";
import * as CARDS from "../../lib/deck-score-cards";

const [, , jsonlPath, dbPath] = process.argv;
if (!jsonlPath || !dbPath) { console.error("usage: build-cards.ts <oracle.jsonl> <out.db>"); process.exit(1); }

// Rebuild from scratch: re-running schema.sql over a live file trips the
// foreign keys between cards/card_reads and decks/deck_cards.
for (const suffix of ["", "-wal", "-shm"]) { const f = dbPath + suffix; if (existsSync(f)) unlinkSync(f); }
const db = new Database(dbPath);
db.exec(readFileSync(new URL("./schema.sql", "file://" + __filename).pathname, "utf8"));

const insCard = db.prepare(`INSERT OR REPLACE INTO cards
 (name_key,name,front_name,oracle_id,layout,is_dfc,type_line,oracle_text,mana_cost,mv,power,toughness,colors,color_identity,produced_mana,keywords,rarity,legal_commander)
 VALUES (@name_key,@name,@front_name,@oracle_id,@layout,@is_dfc,@type_line,@oracle_text,@mana_cost,@mv,@power,@toughness,@colors,@color_identity,@produced_mana,@keywords,@rarity,@legal_commander)`);

const insRead = db.prepare(`INSERT OR REPLACE INTO card_reads VALUES
 (@name_key,@tutor_points,@tutor_premium,@tutor_engine,@tutor_graveyard,@tutor_battlefield,
  @draw_points,@draw_kind,
  @ix_piece,@ix_counter,@ix_free,@ix_removal,@ix_wipe,@ix_hard_wipe,@ix_symmetric_wipe,@ix_stax,@ix_instant,@ix_turn_protection,
  @threat_weight,@threat_self_protecting,@threat_anthem,@threat_token_engine,
  @recursion_points,@recursion_kind,@recursion_engine,
  @mana_produced,
  @sim_is_land,@sim_land_mana,@sim_rock,@sim_dork,@sim_ritual_amount,@sim_ritual_net,@sim_land_ramp,@sim_enters_tapped,
  @reads_as_nothing)`);

// ---- curated lists as data -------------------------------------------------
const insList = db.prepare("INSERT OR IGNORE INTO list_membership VALUES (?,?)");
const insMana = db.prepare("INSERT OR REPLACE INTO mana_output VALUES (?,?,?)");
db.transaction(() => {
  for (const [k, v] of Object.entries(CARDS as Record<string, unknown>)) {
    if (v instanceof Set) for (const n of v as Set<string>) insList.run(n, k);
  }
  for (const [k, v] of Object.entries(CARDS.MANA_OUTPUT)) insMana.run(k, v.amount, v.kind);
})();
console.log("lists:", db.prepare("SELECT COUNT(DISTINCT list_name) n FROM list_membership").get());

// ---- stream the bulk file --------------------------------------------------
const front = (n: string) => n.split(" // ")[0]!.trim();

interface Raw { name: string; oracle_id?: string; layout?: string; type_line?: string; oracle_text?: string;
  mana_cost?: string; cmc?: number; power?: string; toughness?: string; colors?: string[]; color_identity?: string[];
  produced_mana?: string[]; keywords?: string[]; rarity?: string; legalities?: Record<string,string>;
  card_faces?: Array<{ oracle_text?: string; mana_cost?: string; type_line?: string; power?: string; toughness?: string }>; }

const batch: { raw: Raw; sc: ScoredCard }[] = [];
let seen = 0, kept = 0;

function flush() {
  if (!batch.length) return;
  const reads = (classify(batch.map((b) => b.sc), []) as unknown as { reads: any[] }).reads;
  const byKey = new Map<string, any>();
  for (const r of reads) byKey.set(r.key, r);
  const tx = db.transaction(() => {
    for (const { raw, sc } of batch) {
      const key = nameKey(sc.name);
      const r = byKey.get(key);
      insCard.run({
        name_key: key, name: raw.name, front_name: front(raw.name), oracle_id: raw.oracle_id ?? null,
        layout: raw.layout ?? null, is_dfc: raw.name.includes(" // ") ? 1 : 0,
        type_line: sc.typeLine, oracle_text: sc.oracleText, mana_cost: sc.manaCost, mv: sc.manaValue,
        power: raw.power ?? null, toughness: raw.toughness ?? null,
        colors: (raw.colors ?? []).join(""), color_identity: (raw.color_identity ?? []).join(""),
        produced_mana: (raw.produced_mana ?? []).join(""), keywords: (raw.keywords ?? []).join("|"),
        rarity: raw.rarity ?? null, legal_commander: raw.legalities?.commander === "legal" ? 1 : 0,
      });
      if (!r) continue;
      const t = tutorReading(r), d = drawReading(r), ix = interactionReadingCard(r, 30),
            th = threatReading(r), rec = recursionReading(r), sim = toSimCard(r);
      const nothing = !t && !d && !ix.piece && !th.weight && !rec && !manaProduced(r) ? 1 : 0;
      insRead.run({
        name_key: key,
        tutor_points: t?.points ?? 0, tutor_premium: t?.premium ? 1 : 0, tutor_engine: t?.engine ? 1 : 0,
        tutor_graveyard: t?.graveyardDestination ? 1 : 0, tutor_battlefield: t?.battlefield ? 1 : 0,
        draw_points: d?.points ?? 0, draw_kind: d?.kind ?? null,
        ix_piece: ix.piece ? 1 : 0, ix_counter: ix.counterspell ? 1 : 0, ix_free: ix.free ? 1 : 0,
        ix_removal: ix.removal ? 1 : 0, ix_wipe: ix.wipe ? 1 : 0, ix_hard_wipe: ix.hardWipe ? 1 : 0,
        ix_symmetric_wipe: ix.symmetricWipe ? 1 : 0, ix_stax: (ix as any).stax ? 1 : 0,
        ix_instant: ix.instantSpeed ? 1 : 0, ix_turn_protection: ix.turnProtection ? 1 : 0,
        threat_weight: th.weight, threat_self_protecting: th.selfProtecting ? 1 : 0,
        threat_anthem: th.anthem ? 1 : 0, threat_token_engine: th.tokenEngine ? 1 : 0,
        recursion_points: rec?.points ?? 0, recursion_kind: rec?.kind ?? null, recursion_engine: rec?.engine ? 1 : 0,
        mana_produced: manaProduced(r),
        sim_is_land: sim.isLand ? 1 : 0, sim_land_mana: sim.landMana, sim_rock: sim.rock, sim_dork: sim.dork,
        sim_ritual_amount: sim.ritualAmount, sim_ritual_net: sim.ritualNet, sim_land_ramp: sim.landRamp,
        sim_enters_tapped: sim.entersTapped ? 1 : 0,
        reads_as_nothing: nothing,
      });
    }
  });
  tx();
  batch.length = 0;
}

async function main() {
const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  seen++;
  let raw: Raw;
  try { raw = JSON.parse(line); } catch { continue; }
  if (!raw.name) continue;
  const tl = raw.type_line ?? raw.card_faces?.[0]?.type_line ?? "";
  if (/^(Card|Token|Emblem|Dungeon|Plane|Scheme|Vanguard|Phenomenon)\b/.test(tl)) continue;
  if (raw.layout && ["token","double_faced_token","emblem","art_series","vanguard","scheme","planar","augment","host"].includes(raw.layout)) continue;
  const oracle = raw.oracle_text ?? raw.card_faces?.[0]?.oracle_text ?? "";
  const cost = raw.mana_cost ?? raw.card_faces?.[0]?.mana_cost ?? null;
  const sc: ScoredCard = {
    name: front(raw.name), typeLine: tl, oracleText: oracle, manaCost: cost, manaValue: raw.cmc ?? 0,
    quantity: 1, power: raw.power != null ? Number(raw.power) || 0 : (raw.card_faces?.[0]?.power != null ? Number(raw.card_faces[0]!.power) || 0 : null),
    toughness: raw.toughness != null ? Number(raw.toughness) || 0 : null,
    keywords: raw.keywords ?? [], producedMana: raw.produced_mana ?? [], isCommander: false,
  };
  batch.push({ raw, sc });
  kept++;
  if (batch.length >= 250) flush();
  if (kept % 5000 === 0) console.log("  ..", kept);
}
flush();
console.log("scanned", seen, "ingested", kept);
console.log(db.prepare("SELECT COUNT(*) cards, SUM(legal_commander) legal FROM cards").get());
db.close();
}
main();
