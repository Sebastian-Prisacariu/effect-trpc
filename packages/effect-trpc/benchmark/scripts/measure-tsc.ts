/**
 * TSC Performance Measurement
 *
 * Measures TypeScript compilation performance using:
 * 1. tsc --noEmit timing
 * 2. tsc --generateTrace for detailed analysis
 * 3. Memory usage tracking
 */

import { execSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

interface TscResult {
  framework: string
  timeMs: number
  peakMemoryMb: number
  success: boolean
  errors: number
}

interface TraceAnalysis {
  checkTimeMs: number
  bindTimeMs: number
  programTimeMs: number
  ioReadTimeMs: number
  ioWriteTimeMs: number
  parseTimeMs: number
  symbolCount: number
  typeCount: number
  instantiationCount: number
  relationCacheSizes: Record<string, number>
}

/**
 * Run tsc --noEmit and measure time
 */
function measureTscTime(projectDir: string): TscResult {
  const startTime = performance.now()
  const startMemory = process.memoryUsage()

  let success = true
  let errors = 0

  try {
    // Run tsc with --noEmit, capturing stderr for errors
    const result = execSync("npx tsc --noEmit 2>&1", {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    })

    // Count errors in output
    const errorMatches = result.match(/error TS\d+/g)
    errors = errorMatches?.length ?? 0
  } catch (error: any) {
    // tsc returns non-zero on errors, but we still want timing
    success = false
    const output = error.stdout || error.stderr || ""
    const errorMatches = output.match(/error TS\d+/g)
    errors = errorMatches?.length ?? 0
  }

  const endTime = performance.now()
  const endMemory = process.memoryUsage()

  return {
    framework: path.basename(projectDir),
    timeMs: Math.round(endTime - startTime),
    peakMemoryMb: Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024),
    success,
    errors,
  }
}

/**
 * Run tsc --generateTrace for detailed analysis
 */
async function measureTscTrace(projectDir: string): Promise<TraceAnalysis | null> {
  const traceDir = path.join(projectDir, ".trace")

  // Clean up previous trace
  if (fs.existsSync(traceDir)) {
    fs.rmSync(traceDir, { recursive: true })
  }

  try {
    // Generate trace
    execSync(`npx tsc --noEmit --generateTrace "${traceDir}" 2>&1`, {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    })
  } catch {
    // Errors are expected, we still get the trace
  }

  // Read trace file
  const traceFile = path.join(traceDir, "trace.json")
  if (!fs.existsSync(traceFile)) {
    console.warn(`No trace file found at ${traceFile}`)
    return null
  }

  // Parse trace and extract metrics (handle potentially malformed JSON)
  let trace: any
  try {
    trace = JSON.parse(fs.readFileSync(traceFile, "utf8"))
  } catch (e) {
    console.warn(`Failed to parse trace file, skipping trace analysis`)
    fs.rmSync(traceDir, { recursive: true, force: true })
    return null
  }

  // Trace events are in Chrome DevTools format
  let checkTimeMs = 0
  let bindTimeMs = 0
  let programTimeMs = 0
  let parseTimeMs = 0
  let ioReadTimeMs = 0
  let ioWriteTimeMs = 0

  for (const event of trace.traceEvents || trace) {
    if (event.ph === "X") {
      // Duration event
      const dur = (event.dur || 0) / 1000 // Convert from microseconds to ms

      if (event.name === "checkSourceFile") checkTimeMs += dur
      else if (event.name === "bindSourceFile") bindTimeMs += dur
      else if (event.name === "createProgram") programTimeMs += dur
      else if (event.name === "parseSourceFile") parseTimeMs += dur
      else if (event.name?.includes("readFile")) ioReadTimeMs += dur
      else if (event.name?.includes("writeFile")) ioWriteTimeMs += dur
    }
  }

  // Read types file for type statistics
  const typesFile = path.join(traceDir, "types.json")
  let symbolCount = 0
  let typeCount = 0
  let instantiationCount = 0

  if (fs.existsSync(typesFile)) {
    try {
      const types = JSON.parse(fs.readFileSync(typesFile, "utf8"))
      symbolCount = types.length || 0
      typeCount = types.filter((t: any) => t.kind === "type").length
      instantiationCount = types.filter((t: any) => t.kind === "instantiation").length
    } catch {
      // Ignore malformed types file
    }
  }

  // Clean up
  fs.rmSync(traceDir, { recursive: true, force: true })

  return {
    checkTimeMs: Math.round(checkTimeMs),
    bindTimeMs: Math.round(bindTimeMs),
    programTimeMs: Math.round(programTimeMs),
    parseTimeMs: Math.round(parseTimeMs),
    ioReadTimeMs: Math.round(ioReadTimeMs),
    ioWriteTimeMs: Math.round(ioWriteTimeMs),
    symbolCount,
    typeCount,
    instantiationCount,
    relationCacheSizes: {},
  }
}

/**
 * Run multiple iterations for more accurate timing
 */
async function measureWithIterations(
  projectDir: string,
  iterations: number = 3,
): Promise<{ basic: TscResult; trace: TraceAnalysis | null }> {
  console.log(`\nMeasuring ${path.basename(projectDir)} (${iterations} iterations)...`)

  const results: TscResult[] = []

  for (let i = 0; i < iterations; i++) {
    process.stdout.write(`  Iteration ${i + 1}/${iterations}...`)
    const result = measureTscTime(projectDir)
    results.push(result)
    console.log(` ${result.timeMs}ms`)
  }

  // Use median time
  results.sort((a, b) => a.timeMs - b.timeMs)
  const median = results[Math.floor(results.length / 2)]

  // Get trace analysis (just once, it's expensive)
  console.log("  Generating trace analysis...")
  const trace = await measureTscTrace(projectDir)

  return { basic: median, trace }
}

// Main execution
async function main() {
  const vanillaDir = path.join(ROOT, "vanilla-trpc")
  const effectDir = path.join(ROOT, "effect-trpc")

  // Check if generated files exist
  if (!fs.existsSync(path.join(vanillaDir, "generated", "routes.ts"))) {
    console.error("Generated routes not found. Run `npm run generate` first.")
    process.exit(1)
  }

  const iterations = parseInt(process.env.ITERATIONS || "3", 10)

  console.log("=".repeat(60))
  console.log("TSC Performance Benchmark")
  console.log("=".repeat(60))

  const vanillaResult = await measureWithIterations(vanillaDir, iterations)
  const effectResult = await measureWithIterations(effectDir, iterations)

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("Results Summary")
  console.log("=".repeat(60))

  console.log("\nBasic Timing (median of iterations):")
  console.log(`  vanilla-trpc: ${vanillaResult.basic.timeMs}ms`)
  console.log(`  effect-trpc:  ${effectResult.basic.timeMs}ms`)
  console.log(
    `  Difference:   ${effectResult.basic.timeMs - vanillaResult.basic.timeMs}ms (${((effectResult.basic.timeMs / vanillaResult.basic.timeMs - 1) * 100).toFixed(1)}%)`,
  )

  if (vanillaResult.trace && effectResult.trace) {
    console.log("\nTrace Analysis:")
    console.log(
      `  Check time:   vanilla=${vanillaResult.trace.checkTimeMs}ms, effect=${effectResult.trace.checkTimeMs}ms`,
    )
    console.log(
      `  Bind time:    vanilla=${vanillaResult.trace.bindTimeMs}ms, effect=${effectResult.trace.bindTimeMs}ms`,
    )
    console.log(
      `  Parse time:   vanilla=${vanillaResult.trace.parseTimeMs}ms, effect=${effectResult.trace.parseTimeMs}ms`,
    )
  }

  // Save results
  const resultsFile = path.join(ROOT, "results", `tsc-${Date.now()}.json`)
  const resultsDir = path.dirname(resultsFile)
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true })
  }

  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        iterations,
        vanilla: vanillaResult,
        effect: effectResult,
      },
      null,
      2,
    ),
  )

  console.log(`\nResults saved to: ${resultsFile}`)
}

main().catch(console.error)
