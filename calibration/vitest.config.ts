import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["calibration/**/*.test.ts"],
    testTimeout: 600_000,
  },
});
