/**
 * Route Generator
 *
 * Generates N routes for both vanilla-trpc and effect-trpc
 * with realistic schema complexity for accurate benchmarking.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

// Default route count, can be overridden via CLI argument
const routeCount = parseInt(process.argv[2] || "400", 10)

console.log(`Generating ${routeCount} routes for both frameworks...`)

// -----------------------------------------------------------------------------
// Schema Complexity Variations
// -----------------------------------------------------------------------------

// We create varying complexity to simulate real-world scenarios
const schemaComplexities = [
  // Simple - just an ID
  {
    name: "simple",
    zodInput: `z.object({ id: z.string() })`,
    zodOutput: `z.object({ id: z.string(), name: z.string() })`,
    effectInput: `Schema.Struct({ id: Schema.String })`,
    effectOutput: `Schema.Struct({ id: Schema.String, name: Schema.String })`,
  },
  // Medium - a few fields with optional
  {
    name: "medium",
    zodInput: `z.object({
      id: z.string(),
      limit: z.number().optional(),
      cursor: z.string().optional(),
    })`,
    zodOutput: `z.object({
      items: z.array(z.object({ id: z.string(), title: z.string() })),
      nextCursor: z.string().optional(),
    })`,
    effectInput: `Schema.Struct({
      id: Schema.String,
      limit: Schema.optional(Schema.Number),
      cursor: Schema.optional(Schema.String),
    })`,
    effectOutput: `Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
      nextCursor: Schema.optional(Schema.String),
    })`,
  },
  // Complex - nested objects, arrays, unions
  {
    name: "complex",
    zodInput: `z.object({
      id: z.string(),
      filters: z.object({
        status: z.enum(['active', 'inactive', 'pending']),
        tags: z.array(z.string()).optional(),
        dateRange: z.object({
          from: z.string(),
          to: z.string(),
        }).optional(),
      }).optional(),
      pagination: z.object({
        page: z.number(),
        limit: z.number(),
      }),
    })`,
    zodOutput: `z.object({
      data: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(['active', 'inactive', 'pending']),
        metadata: z.record(z.unknown()),
        createdAt: z.string(),
        updatedAt: z.string(),
      })),
      pagination: z.object({
        total: z.number(),
        page: z.number(),
        pages: z.number(),
      }),
    })`,
    effectInput: `Schema.Struct({
      id: Schema.String,
      filters: Schema.optional(Schema.Struct({
        status: Schema.Literal('active', 'inactive', 'pending'),
        tags: Schema.optional(Schema.Array(Schema.String)),
        dateRange: Schema.optional(Schema.Struct({
          from: Schema.String,
          to: Schema.String,
        })),
      })),
      pagination: Schema.Struct({
        page: Schema.Number,
        limit: Schema.Number,
      }),
    })`,
    effectOutput: `Schema.Struct({
      data: Schema.Array(Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        status: Schema.Literal('active', 'inactive', 'pending'),
        metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
        createdAt: Schema.String,
        updatedAt: Schema.String,
      })),
      pagination: Schema.Struct({
        total: Schema.Number,
        page: Schema.Number,
        pages: Schema.Number,
      }),
    })`,
  },
]

// Procedure types distribution
const procedureTypes = ["query", "mutation"] as const

function getComplexity(index: number) {
  // Distribute: 50% simple, 35% medium, 15% complex
  const mod = index % 100
  if (mod < 50) return schemaComplexities[0]
  if (mod < 85) return schemaComplexities[1]
  return schemaComplexities[2]
}

function getProcedureType(index: number): "query" | "mutation" {
  // 70% queries, 30% mutations
  return index % 10 < 7 ? "query" : "mutation"
}

// -----------------------------------------------------------------------------
// Vanilla tRPC Generator
// -----------------------------------------------------------------------------

function generateVanillaTrpc(count: number): string {
  const imports = `import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

`

  let procedures = ""
  for (let i = 0; i < count; i++) {
    const complexity = getComplexity(i)
    const type = getProcedureType(i)
    const paddedIndex = String(i).padStart(4, "0")

    procedures += `export const route_${paddedIndex} = t.procedure
  .input(${complexity.zodInput})
  .output(${complexity.zodOutput})
  .${type}(async ({ input }) => {
    return ${type === "query" ? '{ id: input.id, name: "test" }' : '{ id: input.id, name: "created" }'} as any
  })

`
  }

  // Create the router combining all procedures
  const routerEntries = Array.from({ length: count }, (_, i) => {
    const paddedIndex = String(i).padStart(4, "0")
    return `  route_${paddedIndex}`
  }).join(",\n")

  const router = `
export const appRouter = t.router({
${routerEntries}
})

export type AppRouter = typeof appRouter
`

  return imports + procedures + router
}

// -----------------------------------------------------------------------------
// Effect-trpc Generator
// -----------------------------------------------------------------------------

function generateEffectTrpc(count: number): string {
  const imports = `import { Schema } from 'effect'
import { Rpc } from '@effect/rpc'

// Simulating effect-trpc API
interface ProcedureConfig<I, O> {
  input: Schema.Schema<I>
  output: Schema.Schema<O>
}

const query = <I, O>(config: ProcedureConfig<I, O>) => ({
  type: 'query' as const,
  ...config,
})

const mutation = <I, O>(config: ProcedureConfig<I, O>) => ({
  type: 'mutation' as const,
  ...config,
})

`

  let procedures = ""
  for (let i = 0; i < count; i++) {
    const complexity = getComplexity(i)
    const type = getProcedureType(i)
    const paddedIndex = String(i).padStart(4, "0")
    const fn = type === "query" ? "query" : "mutation"

    procedures += `export const route_${paddedIndex} = ${fn}({
  input: ${complexity.effectInput},
  output: ${complexity.effectOutput},
})

`
  }

  // Create the router type combining all procedures
  const routerEntries = Array.from({ length: count }, (_, i) => {
    const paddedIndex = String(i).padStart(4, "0")
    return `  route_${paddedIndex}: typeof route_${paddedIndex}`
  }).join("\n")

  const router = `
export const routes = {
${Array.from({ length: count }, (_, i) => {
  const paddedIndex = String(i).padStart(4, "0")
  return `  route_${paddedIndex}`
}).join(",\n")}
}

export type AppRouter = typeof routes
`

  return imports + procedures + router
}

// -----------------------------------------------------------------------------
// Client File Generators (for testing autocomplete/hover)
// -----------------------------------------------------------------------------

function generateVanillaClient(count: number): string {
  // Sample a subset of routes for the client tests (deduplicated and sorted)
  const sampleIndices = [...new Set([0, 1, 10, 50, 100, Math.floor(count / 2), count - 1])]
    .filter((i) => i < count)
    .sort((a, b) => a - b)

  return `import type { AppRouter } from './generated/routes'
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'

// Create the client
const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: 'http://localhost:3000/trpc' })],
})

// Test autocomplete and type inference
async function testQueries() {
${sampleIndices
  .map((i) => {
    const paddedIndex = String(i).padStart(4, "0")
    return `  // Route ${i}
  const result_${paddedIndex} = await trpc.route_${paddedIndex}.query({ id: 'test' })
  console.log(result_${paddedIndex})`
  })
  .join("\n\n")}
}

// Test accessing nested properties (hover test)
async function testTypeInference() {
  const result = await trpc.route_0000.query({ id: '123' })
  
  // These should all have proper types
  const id: string = result.id
  const name: string = result.name
  
  console.log(id, name)
}

// Test error detection (wrong input type)
async function testErrorDetection() {
  // @ts-expect-error - id should be string, not number
  await trpc.route_0000.query({ id: 123 })
}

export { testQueries, testTypeInference }
`
}

function generateEffectClient(count: number): string {
  // Sample a subset of routes for the client tests (deduplicated and sorted)
  const sampleIndices = [...new Set([0, 1, 10, 50, 100, Math.floor(count / 2), count - 1])]
    .filter((i) => i < count)
    .sort((a, b) => a - b)

  return `import type { AppRouter } from './generated/routes'

// Simulating effect-trpc client API
type InferInput<T> = T extends { input: infer I } ? I extends { Type: infer IT } ? IT : never : never
type InferOutput<T> = T extends { output: infer O } ? O extends { Type: infer OT } ? OT : never : never

interface Client<TRouter> {
  [K in keyof TRouter]: {
    query: (input: InferInput<TRouter[K]>) => Promise<InferOutput<TRouter[K]>>
    mutate: (input: InferInput<TRouter[K]>) => Promise<InferOutput<TRouter[K]>>
  }
}

declare const trpc: Client<AppRouter>

// Test autocomplete and type inference
async function testQueries() {
${sampleIndices
  .map((i) => {
    const paddedIndex = String(i).padStart(4, "0")
    return `  // Route ${i}
  const result_${paddedIndex} = await trpc.route_${paddedIndex}.query({ id: 'test' })
  console.log(result_${paddedIndex})`
  })
  .join("\n\n")}
}

// Test accessing nested properties (hover test)
async function testTypeInference() {
  const result = await trpc.route_0000.query({ id: '123' })
  
  // These should all have proper types
  const id: string = result.id
  const name: string = result.name
  
  console.log(id, name)
}

// Test error detection (wrong input type)
async function testErrorDetection() {
  // @ts-expect-error - id should be string, not number
  await trpc.route_0000.query({ id: 123 })
}

export { testQueries, testTypeInference }
`
}

// -----------------------------------------------------------------------------
// Write Files
// -----------------------------------------------------------------------------

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Generate vanilla-trpc files
const vanillaDir = path.join(ROOT, "vanilla-trpc", "generated")
ensureDir(vanillaDir)
fs.writeFileSync(path.join(vanillaDir, "routes.ts"), generateVanillaTrpc(routeCount))
fs.writeFileSync(path.join(ROOT, "vanilla-trpc", "client.ts"), generateVanillaClient(routeCount))
fs.writeFileSync(
  path.join(ROOT, "vanilla-trpc", "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../tsconfig.base.json",
      compilerOptions: {
        rootDir: ".",
        outDir: "./dist",
        noEmit: true,
      },
      include: ["*.ts", "generated/**/*.ts"],
    },
    null,
    2,
  ),
)

// Generate effect-trpc files
const effectDir = path.join(ROOT, "effect-trpc", "generated")
ensureDir(effectDir)
fs.writeFileSync(path.join(effectDir, "routes.ts"), generateEffectTrpc(routeCount))
fs.writeFileSync(path.join(ROOT, "effect-trpc", "client.ts"), generateEffectClient(routeCount))
fs.writeFileSync(
  path.join(ROOT, "effect-trpc", "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../tsconfig.base.json",
      compilerOptions: {
        rootDir: ".",
        outDir: "./dist",
        noEmit: true,
      },
      include: ["*.ts", "generated/**/*.ts"],
    },
    null,
    2,
  ),
)

console.log(`Generated ${routeCount} routes for vanilla-trpc in: ${vanillaDir}`)
console.log(`Generated ${routeCount} routes for effect-trpc in: ${effectDir}`)
console.log("")
console.log("Files created:")
console.log("  vanilla-trpc/generated/routes.ts")
console.log("  vanilla-trpc/client.ts")
console.log("  vanilla-trpc/tsconfig.json")
console.log("  effect-trpc/generated/routes.ts")
console.log("  effect-trpc/client.ts")
console.log("  effect-trpc/tsconfig.json")
