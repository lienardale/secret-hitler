import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Two projects:
 *   unit  node   tests/unit/**, lib/**   pure logic (room client store, env, cookies…)
 *   ui    jsdom  components/**, tests/ui/**   React Testing Library + jest-dom
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx", "components/**/*.test.tsx"],
          setupFiles: ["tests/setup.dom.ts"],
        },
      },
    ],
  },
});
