import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function makePrisma() {
  const dbPath = path.resolve(process.cwd(), "dev.db");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

const prisma = global.prisma ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
