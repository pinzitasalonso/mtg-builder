// Before any test runs: an empty SQLite database with the app's schema, for
// the route tests to copy (test/db.ts). `prisma db push` builds it once per
// schema: the file is kept in node_modules/.cache under the schema's hash,
// so only the first run after a schema change pays for it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDbTemplate: string;
  }
}

export default function setup(project: TestProject) {
  const root = path.resolve(__dirname, "..");
  const hash = createHash("sha256").update(fs.readFileSync(path.join(root, "prisma/schema.prisma"))).digest("hex").slice(0, 12);
  const dir = path.join(root, "node_modules/.cache/spellpool-test");
  const template = path.join(dir, `schema-${hash}.db`);
  if (!fs.existsSync(template)) {
    fs.mkdirSync(dir, { recursive: true });
    // Built under another name and renamed, so a run that starts meanwhile
    // never copies a half-made file.
    const making = path.join(dir, `making-${process.pid}.db`);
    fs.rmSync(making, { force: true });
    const res = spawnSync(path.join(root, "node_modules/.bin/prisma"), ["db", "push"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: `file:${making}` },
      encoding: "utf8",
    });
    if (res.status !== 0) throw new Error(`prisma db push failed for the test database:\n${res.stdout}\n${res.stderr}`);
    fs.renameSync(making, template);
    // Templates of older schemas.
    for (const name of fs.readdirSync(dir)) if (name !== path.basename(template)) fs.rmSync(path.join(dir, name), { force: true });
  }
  project.provide("testDbTemplate", template);
}
