import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Resolve the SQLite file from DATABASE_URL (e.g. "file:/data/prod.db") so the
 * running app and `prisma db push` use the SAME file. Falls back to a local
 * dev.db when unset. Without this the app always wrote to ./dev.db inside the
 * deploy directory, which Railway wipes on every deploy — losing all decks.
 */
function resolveDbPath() {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:")) {
    const raw = url.slice("file:".length);
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(process.cwd(), "dev.db");
}

function makePrisma() {
  const adapter = new PrismaBetterSqlite3({ url: resolveDbPath() });
  return new PrismaClient({ adapter });
}

const prisma = global.prisma ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
