// Before the server starts (npm start): back the database up, then bring its
// schema up to date.
//
// There are no migrations here: `prisma db push` makes the SQLite file match
// prisma/schema.prisma at every boot. It used to run with --accept-data-loss,
// which lets it drop a column or a table that still holds data without a
// word: a rename in the schema is a drop plus an add. Now:
//
//   1. The database file is copied to <its folder>/backups first, when the
//      schema has changed since the last copy or there's none from today. A
//      restart loop on one schema makes one copy, so it can't push the good
//      ones out. The newest DB_BACKUPS_KEEP (3) are kept.
//   2. The push runs without the flag. A change that would drop data stops
//      the boot, and says what it would have dropped. To apply it anyway
//      (you've checked, or moved the data in an earlier deploy) set
//      ALLOW_DATA_LOSS=1 for that deploy; the backup from step 1 is there.
//
// To restore: stop the service, copy a backup over the database file, start.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const KEEP = Math.max(1, Number(process.env.DB_BACKUPS_KEEP) || 3);

/** The SQLite file DATABASE_URL names: the same rule as lib/prisma.ts. */
export function dbPath(url = process.env.DATABASE_URL, cwd = process.cwd()) {
  if (url && url.startsWith("file:")) {
    const raw = url.slice("file:".length);
    return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  }
  return path.resolve(cwd, "dev.db");
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** Backups in a folder, newest first: db-<YYYYMMDD-HHMMSS>-<schema hash>.sqlite */
export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, m: /^db-(\d{8})-(\d{6})-([0-9a-f]{8})\.sqlite$/.exec(name) }))
    .filter((b) => b.m)
    .map((b) => ({ name: b.name, day: b.m[1], hash: b.m[3] }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Whether to copy the database now: no copy yet, none from today, or the
    schema isn't the one the newest copy was made under. */
export function backupDue(backups, today, schemaHash) {
  const latest = backups[0];
  return !latest || latest.day !== today || latest.hash !== schemaHash;
}

/** Copy the database (SQLite's online backup, so a half-written page can't
    be copied), then drop the oldest copies past KEEP. Returns the new file,
    or null when no copy was due or it couldn't be made. Never throws: a
    failed backup is reported, and the boot goes on as it used to. */
export async function backup(file, schemaFile, now = new Date()) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;
    const dir = path.join(path.dirname(file), "backups");
    const hash = createHash("sha256").update(fs.readFileSync(schemaFile)).digest("hex").slice(0, 8);
    const backups = listBackups(dir);
    if (!backupDue(backups, stamp(now).slice(0, 8), hash)) return null;
    fs.mkdirSync(dir, { recursive: true });
    // Room for the copy, with some to spare for the database to grow.
    const need = fs.statSync(file).size * 1.5;
    // (statfs is newer than some Node versions: without it, just try.)
    const free = typeof fs.statfsSync === "function" ? fs.statfsSync(dir) : null;
    if (free && free.bavail * free.bsize < need) {
      console.warn(`[prestart] not enough disk for a database backup (${Math.round(need / 1e6)} MB needed). Skipped.`);
      return null;
    }
    const dest = path.join(dir, `db-${stamp(now)}-${hash}.sqlite`);
    const db = new Database(file, { readonly: true });
    try {
      await db.backup(dest);
    } finally {
      db.close();
    }
    for (const old of listBackups(dir).slice(KEEP)) fs.rmSync(path.join(dir, old.name), { force: true });
    console.log(`[prestart] database backed up to ${dest}`);
    return dest;
  } catch (e) {
    console.warn("[prestart] database backup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function push(acceptDataLoss) {
  const bin = path.resolve("node_modules/.bin/prisma");
  const res = spawnSync(bin, ["db", "push", ...(acceptDataLoss ? ["--accept-data-loss"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(out);
  return { ok: res.status === 0, dataLoss: /--accept-data-loss/.test(out) };
}

async function main() {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const saved = await backup(file, path.resolve("prisma/schema.prisma"));
  const first = push(false);
  if (first.ok) return 0;
  if (!first.dataLoss) return 1;
  if (process.env.ALLOW_DATA_LOSS === "1") {
    console.warn("[prestart] ALLOW_DATA_LOSS=1: applying a schema change that drops data.");
    return push(true).ok ? 0 : 1;
  }
  console.error(
    [
      "",
      "[prestart] Refusing to start: this schema change would DROP DATA (see above).",
      "  A renamed column or table is dropped and added again, empty.",
      "  Fix the schema (add the new column, move the data, drop the old one in a later deploy),",
      "  or set ALLOW_DATA_LOSS=1 for this deploy if losing that data is intended.",
      saved ? `  The database was backed up first: ${saved}` : "  The latest backup is in the database folder's backups/ directory.",
      "",
    ].join("\n")
  );
  return 1;
}

// Run only as the start script, not when a test imports the helpers. Real
// paths on both sides: a symlinked app folder must not make this a no-op,
// which would start the server on a database that was never brought up to date.
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exit(await main());
}
