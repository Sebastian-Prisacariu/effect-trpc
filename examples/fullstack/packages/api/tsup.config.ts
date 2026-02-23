import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // DTS disabled: internal example package with linked effect-trpc has type
  // resolution issues with tsup's chunked output files
  dts: false,
  clean: true,
  sourcemap: true,
})
