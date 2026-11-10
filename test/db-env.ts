// Imported for its effect, and first: points DATABASE_URL at this test
// file's own copy of the empty database before lib/prisma.ts reads it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inject } from "vitest";

export const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "spellpool-test-"));
const file = path.join(dbDir, "test.db");
fs.copyFileSync(inject("testDbTemplate"), file);
process.env.DATABASE_URL = `file:${file}`;
