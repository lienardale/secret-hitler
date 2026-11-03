import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The schema property test plays random games and checks every view: a few seconds on an
    // idle machine, but a loaded laptop timed it out (like the engine's). The limit guards hangs.
    testTimeout: 60_000,
  },
});
