import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    },
  },
})
