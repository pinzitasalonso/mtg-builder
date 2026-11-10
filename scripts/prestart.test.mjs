import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { backup, backupDue, dbPath, listBackups } from "./prestart.mjs";

describe("the database backup before start", () => {
  it("finds the database file as the app does", () => {
    expect(dbPath("file:/data/db.sqlite", "/app")).toBe("/data/db.sqlite");
    expect(dbPath("file:./dev.db", "/app")).toBe("/app/dev.db");
    expect(dbPath(undefined, "/app")).toBe("/app/dev.db");
  });

  it("is due when there's no copy, none from today, or the schema changed", () => {
    const b = (day, hash) => ({ name: `db-${day}-000000-${hash}.sqlite`, day, hash });
    expect(backupDue([], "20261110", "aaaaaaaa")).toBe(true);
    expect(backupDue([b("20261109", "aaaaaaaa")], "20261110", "aaaaaaaa")).toBe(true);
    expect(backupDue([b("20261110", "aaaaaaaa")], "20261110", "bbbbbbbb")).toBe(true);
    // A restart on the same day and schema: the copy that's there is kept.
    expect(backupDue([b("20261110", "aaaaaaaa")], "20261110", "aaaaaaaa")).toBe(false);
  });

  it("copies the database once per schema and day, and keeps the newest three", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prestart-"));
    const file = path.join(dir, "db.sqlite");
    const schema = path.join(dir, "schema.prisma");
    const db = new Database(file);
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7);");
    db.close();
    const made = [];
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(schema, `// schema ${i}`);
      made.push(await backup(file, schema, new Date(Date.UTC(2026, 10, 10, 12, 0, i))));
    }
    expect(made.every(Boolean)).toBe(true);
    // The same schema again: nothing new.
    expect(await backup(file, schema, new Date(Date.UTC(2026, 10, 10, 12, 1, 0)))).toBeNull();
    const kept = listBackups(path.join(dir, "backups"));
    expect(kept).toHaveLength(3);
    expect(path.join(dir, "backups", kept[0].name)).toBe(made[4]);
    // A copy is a working database with the data in it.
    const copy = new Database(made[4], { readonly: true });
    expect(copy.prepare("SELECT n FROM t").get()).toEqual({ n: 7 });
    copy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
