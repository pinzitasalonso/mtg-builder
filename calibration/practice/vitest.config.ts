import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, "../..");

// The practice benchmark: `npm run practice:bench`. Not part of `npm test`
// (it's a measurement, not a check) nor of `npm run calibrate`.
export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: {
    include: ["calibration/practice/**/*.bench.ts"],
    testTimeout: 600_000,
    // The benchmark's table is its output.
    disableConsoleIntercept: true,
  },
});
