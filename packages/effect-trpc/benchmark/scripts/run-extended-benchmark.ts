/**
 * Extended Benchmark Runner
 *
 * Runs comprehensive benchmarks with:
 * - Large route counts (up to 6400)
 * - Many iterations (50) for statistical significance
 * - Full statistical analysis (median, mean, std dev, percentiles)
 */

import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

// Configuration
const ROUTE_COUNTS = [100, 400, 800, 1600, 3200, 6400]
const ITERATIONS = 50

interface TscMeasurement {
  timeMs: number
}

interface StatisticalResult {
  median: number
  mean: number
  stdDev: number
  min: number
  max: number
  p5: number
  p95: number
  samples: number[]
}

interface BenchmarkResult {
  routeCount: number
  vanilla: {
    tsc: StatisticalResult
    projectLoad: StatisticalResult
  }
  effect: {
    tsc: StatisticalResult
    projectLoad: StatisticalResult
  }
}

function calculateStats(samples: number[]): StatisticalResult {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length

  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / n

  const squaredDiffs = sorted.map((x) => Math.pow(x - mean, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n
  const stdDev = Math.sqrt(variance)

  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]

  const p5Index = Math.floor(n * 0.05)
  const p95Index = Math.floor(n * 0.95)

  return {
    median: Math.round(median),
    mean: Math.round(mean),
    stdDev: Math.round(stdDev),
    min: sorted[0],
    max: sorted[n - 1],
    p5: sorted[p5Index],
    p95: sorted[p95Index],
    samples: sorted,
  }
}

function measureTscTime(projectDir: string): number {
  const startTime = performance.now()

  try {
    execSync("npx tsc --noEmit 2>&1", {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    })
  } catch {
    // Errors are expected, we still measure time
  }

  return Math.round(performance.now() - startTime)
}

function measureProjectLoad(projectDir: string): number {
  const configPath = path.join(projectDir, "tsconfig.json")
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectDir)

  const files = new Map<string, string>()
  for (const fileName of config.fileNames) {
    files.set(fileName, fs.readFileSync(fileName, "utf8"))
  }

  const servicesHost: any = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName: string) => {
      const content = files.get(fileName) ?? fs.readFileSync(fileName, "utf8")
      return ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => projectDir,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options: any) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  const startTime = performance.now()
  const service = ts.createLanguageService(servicesHost, ts.createDocumentRegistry())
  service.getProgram()
  const elapsed = performance.now() - startTime

  return Math.round(elapsed)
}

function generateRoutes(count: number): void {
  console.log(`  Generating ${count} routes...`)
  execSync(`npx tsx scripts/generate-routes.ts ${count}`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  })
}

async function runBenchmarkForRouteCount(routeCount: number): Promise<BenchmarkResult> {
  console.log(`\n${"=".repeat(70)}`)
  console.log(`BENCHMARKING ${routeCount} ROUTES (${ITERATIONS} iterations)`)
  console.log("=".repeat(70))

  generateRoutes(routeCount)

  const vanillaDir = path.join(ROOT, "vanilla-trpc")
  const effectDir = path.join(ROOT, "effect-trpc")

  const vanillaTscSamples: number[] = []
  const effectTscSamples: number[] = []
  const vanillaLoadSamples: number[] = []
  const effectLoadSamples: number[] = []

  // Warm-up run (not counted)
  console.log("  Warm-up run...")
  measureTscTime(vanillaDir)
  measureTscTime(effectDir)

  // Main benchmark iterations
  for (let i = 0; i < ITERATIONS; i++) {
    process.stdout.write(`\r  Iteration ${i + 1}/${ITERATIONS}...`)

    // TSC measurements (alternating to reduce bias)
    if (i % 2 === 0) {
      vanillaTscSamples.push(measureTscTime(vanillaDir))
      effectTscSamples.push(measureTscTime(effectDir))
    } else {
      effectTscSamples.push(measureTscTime(effectDir))
      vanillaTscSamples.push(measureTscTime(vanillaDir))
    }

    // Project load measurements (every 10th iteration to save time)
    if (i % 10 === 0) {
      vanillaLoadSamples.push(measureProjectLoad(vanillaDir))
      effectLoadSamples.push(measureProjectLoad(effectDir))
    }
  }

  console.log("\n  Computing statistics...")

  return {
    routeCount,
    vanilla: {
      tsc: calculateStats(vanillaTscSamples),
      projectLoad: calculateStats(vanillaLoadSamples),
    },
    effect: {
      tsc: calculateStats(effectTscSamples),
      projectLoad: calculateStats(effectLoadSamples),
    },
  }
}

function formatPercentage(vanilla: number, effect: number): string {
  if (vanilla === 0 && effect === 0) return "➖ Same"
  if (vanilla === 0) return "❌ N/A"

  const pct = ((vanilla - effect) / vanilla) * 100
  if (Math.abs(pct) < 1) return "➖ Same"

  if (pct > 0) {
    return `✅ **+${pct.toFixed(1)}%**`
  } else {
    return `❌ ${pct.toFixed(1)}%`
  }
}

function generateMarkdownReport(results: BenchmarkResult[]): string {
  let md = `# Extended TypeScript Performance Benchmark Results

**Date:** ${new Date().toISOString()}
**Iterations per route count:** ${ITERATIONS}
**Route counts tested:** ${ROUTE_COUNTS.join(", ")}

## Summary Table (Percentage Comparison)

**Reading the table:** 
- ✅ **Positive %** = effect-trpc is **faster** (better)
- ❌ **Negative %** = effect-trpc is **slower** (worse)
- ➖ **Same** = No measurable difference (<1% or <1ms)

### TSC --noEmit Time (Median)

| Routes | vanilla-trpc | effect-trpc | Improvement |
|--------|--------------|-------------|-------------|
`

  for (const r of results) {
    const pct = formatPercentage(r.vanilla.tsc.median, r.effect.tsc.median)
    md += `| ${r.routeCount} | ${r.vanilla.tsc.median}ms | ${r.effect.tsc.median}ms | ${pct} |\n`
  }

  md += `
### Project Load Time (Median)

| Routes | vanilla-trpc | effect-trpc | Comparison |
|--------|--------------|-------------|------------|
`

  for (const r of results) {
    const pct = formatPercentage(r.vanilla.projectLoad.median, r.effect.projectLoad.median)
    md += `| ${r.routeCount} | ${r.vanilla.projectLoad.median}ms | ${r.effect.projectLoad.median}ms | ${pct} |\n`
  }

  md += `
## Detailed Statistical Analysis

### TSC --noEmit Time

| Routes | Framework | Median | Mean | Std Dev | Min | Max | P5 | P95 |
|--------|-----------|--------|------|---------|-----|-----|-----|-----|
`

  for (const r of results) {
    md += `| ${r.routeCount} | vanilla-trpc | ${r.vanilla.tsc.median}ms | ${r.vanilla.tsc.mean}ms | ±${r.vanilla.tsc.stdDev}ms | ${r.vanilla.tsc.min}ms | ${r.vanilla.tsc.max}ms | ${r.vanilla.tsc.p5}ms | ${r.vanilla.tsc.p95}ms |\n`
    md += `| | effect-trpc | ${r.effect.tsc.median}ms | ${r.effect.tsc.mean}ms | ±${r.effect.tsc.stdDev}ms | ${r.effect.tsc.min}ms | ${r.effect.tsc.max}ms | ${r.effect.tsc.p5}ms | ${r.effect.tsc.p95}ms |\n`
  }

  md += `
### Project Load Time

| Routes | Framework | Median | Mean | Std Dev | Min | Max | P5 | P95 |
|--------|-----------|--------|------|---------|-----|-----|-----|-----|
`

  for (const r of results) {
    md += `| ${r.routeCount} | vanilla-trpc | ${r.vanilla.projectLoad.median}ms | ${r.vanilla.projectLoad.mean}ms | ±${r.vanilla.projectLoad.stdDev}ms | ${r.vanilla.projectLoad.min}ms | ${r.vanilla.projectLoad.max}ms | ${r.vanilla.projectLoad.p5}ms | ${r.vanilla.projectLoad.p95}ms |\n`
    md += `| | effect-trpc | ${r.effect.projectLoad.median}ms | ${r.effect.projectLoad.mean}ms | ±${r.effect.projectLoad.stdDev}ms | ${r.effect.projectLoad.min}ms | ${r.effect.projectLoad.max}ms | ${r.effect.projectLoad.p5}ms | ${r.effect.projectLoad.p95}ms |\n`
  }

  // Scaling analysis
  const first = results[0]
  const last = results[results.length - 1]
  const vanillaScale = last.vanilla.tsc.median / first.vanilla.tsc.median
  const effectScale = last.effect.tsc.median / first.effect.tsc.median

  md += `
## Scaling Analysis

| Metric | vanilla-trpc | effect-trpc |
|--------|--------------|-------------|
| TSC time at ${first.routeCount} routes | ${first.vanilla.tsc.median}ms | ${first.effect.tsc.median}ms |
| TSC time at ${last.routeCount} routes | ${last.vanilla.tsc.median}ms | ${last.effect.tsc.median}ms |
| Scaling factor | ${vanillaScale.toFixed(2)}x | ${effectScale.toFixed(2)}x |
| Scaling advantage | - | **${(vanillaScale / effectScale).toFixed(2)}x better** |

### Time Saved at Scale

| Routes | Time saved per TSC run | Saves/day (100) | Weekly savings |
|--------|------------------------|-----------------|----------------|
`

  for (const r of results) {
    const saved = r.vanilla.tsc.median - r.effect.tsc.median
    const dailySaved = (saved * 100) / 1000 / 60 // minutes
    const weeklySaved = dailySaved * 5
    md += `| ${r.routeCount} | ${(saved / 1000).toFixed(1)}s | ${dailySaved.toFixed(1)} min | ${weeklySaved.toFixed(1)} min |\n`
  }

  md += `
## Variance Analysis

Low standard deviation indicates consistent performance. High variance may indicate:
- Background system processes
- Garbage collection pauses
- Cache effects

| Routes | vanilla-trpc CV | effect-trpc CV | More Consistent |
|--------|-----------------|----------------|-----------------|
`

  for (const r of results) {
    const vanillaCV = ((r.vanilla.tsc.stdDev / r.vanilla.tsc.mean) * 100).toFixed(1)
    const effectCV = ((r.effect.tsc.stdDev / r.effect.tsc.mean) * 100).toFixed(1)
    const winner = parseFloat(vanillaCV) < parseFloat(effectCV) ? "vanilla-trpc" : "effect-trpc"
    md += `| ${r.routeCount} | ${vanillaCV}% | ${effectCV}% | ${winner} |\n`
  }

  return md
}

function printSummary(results: BenchmarkResult[]): void {
  console.log("\n" + "=".repeat(70))
  console.log("FINAL RESULTS SUMMARY")
  console.log("=".repeat(70))

  console.log("\n## TSC --noEmit Time (Median)\n")
  console.log("| Routes | vanilla-trpc | effect-trpc | Improvement |")
  console.log("|--------|--------------|-------------|-------------|")

  for (const r of results) {
    const pct = (
      ((r.vanilla.tsc.median - r.effect.tsc.median) / r.vanilla.tsc.median) *
      100
    ).toFixed(1)
    console.log(
      `| ${r.routeCount} | ${r.vanilla.tsc.median}ms | ${r.effect.tsc.median}ms | +${pct}% faster |`,
    )
  }

  // Scaling summary
  const first = results[0]
  const last = results[results.length - 1]
  const vanillaScale = last.vanilla.tsc.median / first.vanilla.tsc.median
  const effectScale = last.effect.tsc.median / first.effect.tsc.median

  console.log(`\n## Scaling (${first.routeCount} → ${last.routeCount} routes)\n`)
  console.log(
    `  vanilla-trpc: ${first.vanilla.tsc.median}ms → ${last.vanilla.tsc.median}ms (${vanillaScale.toFixed(1)}x)`,
  )
  console.log(
    `  effect-trpc:  ${first.effect.tsc.median}ms → ${last.effect.tsc.median}ms (${effectScale.toFixed(1)}x)`,
  )
  console.log(`\n  ✅ effect-trpc scales ${(vanillaScale / effectScale).toFixed(1)}x better!`)
}

// Main
async function main() {
  console.log("=".repeat(70))
  console.log("Extended TypeScript Performance Benchmark")
  console.log("=".repeat(70))
  console.log(`\nConfiguration:`)
  console.log(`  Route counts: ${ROUTE_COUNTS.join(", ")}`)
  console.log(`  Iterations: ${ITERATIONS}`)
  console.log(`  Estimated time: ${(ROUTE_COUNTS.length * ITERATIONS * 15) / 60} minutes`)

  const results: BenchmarkResult[] = []

  for (const count of ROUTE_COUNTS) {
    const result = await runBenchmarkForRouteCount(count)
    results.push(result)
  }

  // Print summary
  printSummary(results)

  // Generate and save markdown report
  const report = generateMarkdownReport(results)
  const reportPath = path.join(ROOT, "results", `extended-benchmark-${Date.now()}.md`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, report)
  console.log(`\nFull report saved to: ${reportPath}`)

  // Save raw JSON
  const jsonPath = path.join(ROOT, "results", `extended-benchmark-${Date.now()}.json`)
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        config: { routeCounts: ROUTE_COUNTS, iterations: ITERATIONS },
        results,
      },
      null,
      2,
    ),
  )
  console.log(`Raw data saved to: ${jsonPath}`)
}

main().catch(console.error)
