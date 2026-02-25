import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    "react-server": "src/react/server.ts",
    next: "src/next/index.ts",
    node: "src/node/index.ts",
    "node-http": "src/node/http.ts",
    "node-ws": "src/node/ws.ts",
    bun: "src/bun/index.ts",
    "bun-http": "src/bun/http.ts",
    "bun-ws": "src/bun/ws.ts",
    ws: "src/ws/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  external: [
    // Effect ecosystem
    "effect",
    "@effect/rpc",
    "@effect/rpc-http",
    "@effect/platform",
    "@effect/platform-node",
    "@effect/platform-bun",

    // State management
    "@effect-atom/atom",
    "@effect-atom/atom-react",

    // React
    "react",
    "react-dom",

    // Next.js
    "next",

    // Node.js / runtime
    "ws",
    "bun",
  ],
  esbuildOptions(options) {
    // Mark common Effect functions as pure for better tree-shaking
    // These functions have no side effects when called
    options.pure = [
      "Effect.gen",
      "Effect.sync",
      "Effect.succeed",
      "Effect.fail",
      "Effect.map",
      "Effect.flatMap",
      "Effect.tap",
      "Effect.catchAll",
      "Effect.catchTag",
      "Effect.provide",
      "Effect.provideService",
      "pipe",
      "flow",
      "Layer.effect",
      "Layer.succeed",
      "Layer.scoped",
      "Schema.Struct",
      "Schema.String",
      "Schema.Number",
      "Schema.Boolean",
      "Schema.optional",
      "Context.Tag",
      "Data.TaggedClass",
      "Data.TaggedError",
    ]
  },
})
