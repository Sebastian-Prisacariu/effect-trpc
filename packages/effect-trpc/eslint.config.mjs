import * as effectEslint from "@effect/eslint-plugin"
import { fixupPluginRules } from "@eslint/compat"
import { FlatCompat } from "@eslint/eslintrc"
import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import importPlugin from "eslint-plugin-import"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  {
    ignores: ["dist", "node_modules", "*.cjs", "*.config.ts"],
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
  ),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: {
      "@effect": effectEslint,
      import: fixupPluginRules(importPlugin),
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      // Effect-oriented runtime safety
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",

      // Keep TypeScript strictness for runtime code paths
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-namespace": "off",

      // Effect repo style alignment (non-invasive subset)
      "import/no-duplicates": "error",
      "sort-imports": "off",
      "simple-import-sort/imports": "off",
    },
  },
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  // Dynamic proxy/RPC code where `any` is intentionally used for runtime flexibility.
  // These files build proxies, traverse routers, or extract schemas dynamically
  // in ways that TypeScript cannot statically verify.
  {
    files: [
      "src/react/create-client.ts",
      "src/core/internal/router.ts",
      "src/core/rpc-bridge.ts",
      "src/core/client.ts",
      "src/shared/rpc-handler.ts",
      "src/ws/shared/index.ts",
      "src/ws/server/SubscriptionManager.ts",
      "src/react/atoms.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
]
