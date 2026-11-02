// Lint config for packages/* and apps/rooms.
// apps/web has its own eslint.config.mjs (Next.js rules) and is linted from its
// own folder by `npm -w @sh/web run lint`, so it is ignored here.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/coverage/**",
    "**/.wrangler/**",
    "apps/web/**",
    "apps/rooms/worker-configuration.d.ts",
  ]),
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    // The rules engine must stay pure and deterministic: no clock, no global
    // randomness, no I/O. Randomness comes from the seeded RNG in the state.
    name: "engine/pure",
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The engine does no I/O." },
        { name: "crypto", message: "Use the seeded RNG in src/rng.ts." },
        { name: "setTimeout", message: "The engine has no clock." },
        { name: "setInterval", message: "The engine has no clock." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded RNG in src/rng.ts." },
        { object: "Date", property: "now", message: "The engine has no clock." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "The engine has no clock." },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
]);
