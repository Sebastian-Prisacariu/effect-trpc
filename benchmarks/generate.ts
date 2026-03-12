/**
 * Benchmark generator for TypeScript type performance
 * 
 * Generates router definitions with varying:
 * - Number of procedures (50, 100, 500, 1000, 2000)
 * - Nesting depth (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
 * 
 * Run: npx tsx benchmarks/generate.ts
 */

import * as fs from "fs"
import * as path from "path"

const PROCEDURE_COUNTS = [50, 100, 500, 1000, 2000]
const NESTING_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const OUTPUT_DIR = path.join(__dirname, "generated")

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

function generateProcedure(name: string, tag: string): string {
  return `Rpc.make("${tag}", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ id: Schema.String, name: Schema.String, value: Schema.Number }),
    error: Schema.Never,
  })`
}

function generateNestedStructure(
  procedureCount: number,
  depth: number,
  currentDepth: number = 0,
  pathPrefix: string = ""
): string {
  if (currentDepth >= depth) {
    // At max depth, generate procedures
    const proceduresPerLevel = Math.ceil(procedureCount / Math.pow(2, depth))
    const procedures: string[] = []
    
    for (let i = 0; i < proceduresPerLevel; i++) {
      const name = `proc${i}`
      const tag = `${pathPrefix}${name}`
      procedures.push(`    ${name}: ${generateProcedure(name, tag)}`)
    }
    
    return `{\n${procedures.join(",\n")}\n  }`
  }
  
  // Create nested routers
  const branches = Math.min(4, Math.ceil(Math.pow(procedureCount, 1 / depth)))
  const children: string[] = []
  
  for (let i = 0; i < branches; i++) {
    const branchName = `branch${i}`
    const branchTag = `${pathPrefix}${branchName}/`
    const childStructure = generateNestedStructure(
      Math.ceil(procedureCount / branches),
      depth,
      currentDepth + 1,
      branchTag
    )
    children.push(`    ${branchName}: Router.make("${branchTag}", ${childStructure})`)
  }
  
  return `{\n${children.join(",\n")}\n  }`
}

function generateTestFile(procedureCount: number, depth: number): string {
  const structure = generateNestedStructure(procedureCount, depth, 0, "@api/")
  
  return `/**
 * Auto-generated benchmark file
 * Procedures: ${procedureCount}, Depth: ${depth}
 */

import { Schema } from "effect"
import * as Rpc from "@effect/rpc/Rpc"

// Simulated Router.make (we're testing type inference cost)
declare const Router: {
  make<T extends Record<string, any>>(tag: string, def: T): { tag: string; definition: T }
}

// Simulated Client type (recursive mapped type)
type Client<D> = {
  readonly [K in keyof D]: D[K] extends { definition: infer Nested }
    ? Client<Nested>
    : D[K] extends Rpc.Rpc<infer _Tag, infer P, infer S, infer E, infer _M>
      ? {
          useQuery: (payload: P["Type"]) => { data: S["Type"] | undefined; error: E["Type"] | undefined }
          useMutation: () => { mutate: (payload: P["Type"]) => void }
        }
      : never
}

declare function makeClient<D>(router: { definition: D }): Client<D>

// Generate the router
const router = Router.make("@api/root", ${structure})

// Create client (this is where type inference happens)
const api = makeClient(router)

// Test autocomplete - uncomment and check IDE performance
// api.branch0.branch0.
`
}

function generateSimpleFlatFile(procedureCount: number): string {
  const procedures: string[] = []
  
  for (let i = 0; i < procedureCount; i++) {
    procedures.push(`  proc${i}: Rpc.make("proc${i}", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ id: Schema.String, name: Schema.String }),
    error: Schema.Never,
  })`)
  }
  
  return `/**
 * Auto-generated benchmark file (FLAT)
 * Procedures: ${procedureCount}, Depth: 1
 */

import { Schema } from "effect"
import * as Rpc from "@effect/rpc/Rpc"

declare const Router: {
  make<T extends Record<string, any>>(tag: string, def: T): { tag: string; definition: T }
}

type Client<D> = {
  readonly [K in keyof D]: D[K] extends Rpc.Rpc<infer _Tag, infer P, infer S, infer E, infer _M>
    ? {
        useQuery: (payload: P["Type"]) => { data: S["Type"] | undefined }
      }
    : never
}

declare function makeClient<D>(router: { definition: D }): Client<D>

const router = Router.make("@api/root", {
${procedures.join(",\n")}
})

const api = makeClient(router)

// Test: api.proc
`
}

// Generate all combinations
console.log("Generating benchmark files...")

for (const count of PROCEDURE_COUNTS) {
  for (const depth of NESTING_DEPTHS) {
    const filename = `bench_p${count}_d${depth}.ts`
    const content = generateTestFile(count, depth)
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), content)
    console.log(`  Generated: ${filename}`)
  }
  
  // Also generate flat version for comparison
  const flatFilename = `bench_p${count}_flat.ts`
  fs.writeFileSync(path.join(OUTPUT_DIR, flatFilename), generateSimpleFlatFile(count))
  console.log(`  Generated: ${flatFilename}`)
}

// Generate a runner script
const runnerScript = `#!/bin/bash
# TypeScript performance benchmark runner
# Run: ./benchmarks/run.sh

echo "TypeScript Type Performance Benchmark"
echo "======================================"
echo ""

# Check if typescript is installed
if ! command -v tsc &> /dev/null; then
    echo "tsc not found. Install with: npm install -g typescript"
    exit 1
fi

echo "Procedure Count, Depth, Time (ms), Memory (MB)"
echo "-----------------------------------------------"

for file in benchmarks/generated/bench_*.ts; do
    # Extract info from filename
    filename=$(basename "$file")
    
    # Time the type check
    start=$(date +%s%N)
    tsc --noEmit --skipLibCheck "$file" 2>/dev/null
    end=$(date +%s%N)
    
    # Calculate duration in ms
    duration=$(( (end - start) / 1000000 ))
    
    echo "$filename, $duration ms"
done
`

fs.writeFileSync(path.join(__dirname, "run.sh"), runnerScript)
fs.chmodSync(path.join(__dirname, "run.sh"), "755")

// Generate a TypeScript runner that measures more precisely
const tsRunner = `/**
 * TypeScript performance measurement
 * Run: npx tsx benchmarks/measure.ts
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const GENERATED_DIR = path.join(__dirname, "generated")

interface Result {
  file: string
  procedures: number
  depth: number
  timeMs: number
}

const results: Result[] = []

const files = fs.readdirSync(GENERATED_DIR).filter(f => f.endsWith(".ts"))

console.log("Running TypeScript type-check benchmarks...")
console.log("This may take a while for large files.\\n")

for (const file of files) {
  const match = file.match(/bench_p(\\d+)_(?:d(\\d+)|flat)\\.ts/)
  if (!match) continue
  
  const procedures = parseInt(match[1])
  const depth = match[2] ? parseInt(match[2]) : 1
  
  const filePath = path.join(GENERATED_DIR, file)
  
  try {
    const start = performance.now()
    execSync(\`npx tsc --noEmit --skipLibCheck "\${filePath}"\`, { 
      stdio: "pipe",
      timeout: 60000 // 60 second timeout
    })
    const end = performance.now()
    
    const timeMs = Math.round(end - start)
    results.push({ file, procedures, depth, timeMs })
    
    console.log(\`\${file}: \${timeMs}ms\`)
  } catch (e: any) {
    console.log(\`\${file}: ERROR or TIMEOUT\`)
    results.push({ file, procedures, depth, timeMs: -1 })
  }
}

// Output CSV
console.log("\\n\\nCSV Output:")
console.log("procedures,depth,time_ms")
for (const r of results) {
  console.log(\`\${r.procedures},\${r.depth},\${r.timeMs}\`)
}
`

fs.writeFileSync(path.join(__dirname, "measure.ts"), tsRunner)

console.log("\nDone! Generated files in benchmarks/generated/")
console.log("\nTo run the benchmark:")
console.log("  npx tsx benchmarks/measure.ts")
console.log("\nOr run individual files manually with your IDE to test autocomplete.")
