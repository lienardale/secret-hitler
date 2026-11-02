import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "text"],
      // The rules engine is the heart of the game: every line must be exercised.
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 95 },
    },
  },
});
