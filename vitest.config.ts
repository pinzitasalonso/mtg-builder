import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname);

// The calibration run reaches Scryfall and Commander Spellbook, so it is not
// part of `npm test` — `npm run calibrate` runs it on its own config.
export default defineConfig({
  resolve: {
    alias: [
      // Next's request cookies, which only exist inside a request: the tests
      // get a jar they can sign in through (test/next-headers.ts).
      { find: /^next\/headers$/, replacement: path.join(root, "test/next-headers.ts") },
      // The app's "@/…" imports, so a test can load a route.
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "calibration/**"],
    // Builds the empty database the route tests copy (test/db.ts).
    globalSetup: ["./test/global-setup.ts"],
  },
});
