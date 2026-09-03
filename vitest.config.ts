import { defineConfig } from "vitest/config";

// The calibration run reaches Scryfall and Commander Spellbook, so it is not
// part of `npm test` — `npm run calibrate` runs it on its own config.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "calibration/**"],
  },
});
