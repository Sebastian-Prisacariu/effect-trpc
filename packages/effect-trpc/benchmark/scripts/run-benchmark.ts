/**
 * Main Benchmark Runner
 *
 * Orchestrates the complete benchmark suite:
 * 1. Generate routes for multiple sizes
 * 2. Run TSC benchmarks
 * 3. Run TSServer benchmarks
 * 4. Compile and display results
 */

import { execSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

interface BenchmarkConfig {
  routeCounts: number[]
  iterations: number
  runTsc: boolean
  runTsServer: boolean
}

interface RouteResult {
  routeCount: number
  tsc?: {
    vanilla: { timeMs: number; checkTimeMs?: number }
    effect: { timeMs: number; checkTimeMs?: number }
  }
  tsserver?: {
    vanilla: {
      projectLoadMs: number
      hover: number
      autocomplete: number
      goToDefinition: number
      diagnostics: number
    }
    effect: {
      projectLoadMs: number
      hover: number
      autocomplete: number
      goToDefinition: number
      diagnostics: number
    }
  }
}

function runCommand(cmd: string, description: string) {
  console.log(`\n[${description}]`)
  console.log(`$ ${cmd}`)

  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    })
    console.log(result)
    return result
  } catch (error: any) {
    console.error(error.stdout || error.stderr || error.message)
    throw error
  }
}

function runScript(script: string): string | null {
  try {
    const result = execSync(`npx tsx ${script}`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    })
    return result
  } catch (error: any) {
    console.error(error.stdout || error.stderr || error.message)
    return null
  }
}

function getLatestResult(pattern: string): any {
  const resultsDir = path.join(ROOT, "results")
  if (!fs.existsSync(resultsDir)) return null

  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.startsWith(pattern) && f.endsWith(".json"))
    .sort()
    .reverse()

  if (files.length === 0) return null

  return JSON.parse(fs.readFileSync(path.join(resultsDir, files[0]), "utf8"))
}

async function runBenchmarkSuite(config: BenchmarkConfig) {
  const results: RouteResult[] = []

  console.log("=".repeat(70))
  console.log("Effect-trpc TypeScript Performance Benchmark")
  console.log("=".repeat(70))
  console.log(`\nConfiguration:`)
  console.log(`  Route counts: ${config.routeCounts.join(", ")}`)
  console.log(`  Iterations: ${config.iterations}`)
  console.log(`  Run TSC: ${config.runTsc}`)
  console.log(`  Run TSServer: ${config.runTsServer}`)

  for (const count of config.routeCounts) {
    console.log("\n" + "=".repeat(70))
    console.log(`BENCHMARKING ${count} ROUTES`)
    console.log("=".repeat(70))

    // 1. Generate routes
    console.log(`\nGenerating ${count} routes...`)
    runScript(`scripts/generate-routes.ts ${count}`)

    const result: RouteResult = { routeCount: count }

    // 2. Run TSC benchmark
    if (config.runTsc) {
      console.log("\nRunning TSC benchmark...")
      process.env.ITERATIONS = String(config.iterations)
      runScript("scripts/measure-tsc.ts")

      const tscResult = getLatestResult("tsc-")
      if (tscResult) {
        result.tsc = {
          vanilla: {
            timeMs: tscResult.vanilla.basic.timeMs,
            checkTimeMs: tscResult.vanilla.trace?.checkTimeMs,
          },
          effect: {
            timeMs: tscResult.effect.basic.timeMs,
            checkTimeMs: tscResult.effect.trace?.checkTimeMs,
          },
        }
      }
    }

    // 3. Run TSServer benchmark
    if (config.runTsServer) {
      console.log("\nRunning TSServer benchmark...")
      runScript("scripts/measure-tsserver.ts")

      const tsserverResult = getLatestResult("tsserver-")
      if (tsserverResult) {
        const extractMeasurement = (measurements: any[], op: string) =>
          measurements.find((m: any) => m.operation === op)?.timeMs ?? 0

        result.tsserver = {
          vanilla: {
            projectLoadMs: tsserverResult.vanilla.projectLoadMs,
            hover: extractMeasurement(tsserverResult.vanilla.measurements, "hover"),
            autocomplete: extractMeasurement(tsserverResult.vanilla.measurements, "autocomplete"),
            goToDefinition: extractMeasurement(
              tsserverResult.vanilla.measurements,
              "goToDefinition",
            ),
            diagnostics: extractMeasurement(tsserverResult.vanilla.measurements, "diagnostics"),
          },
          effect: {
            projectLoadMs: tsserverResult.effect.projectLoadMs,
            hover: extractMeasurement(tsserverResult.effect.measurements, "hover"),
            autocomplete: extractMeasurement(tsserverResult.effect.measurements, "autocomplete"),
            goToDefinition: extractMeasurement(
              tsserverResult.effect.measurements,
              "goToDefinition",
            ),
            diagnostics: extractMeasurement(tsserverResult.effect.measurements, "diagnostics"),
          },
        }
      }
    }

    results.push(result)
  }

  return results
}

function printResultsTable(results: RouteResult[]) {
  console.log("\n" + "=".repeat(70))
  console.log("FINAL RESULTS")
  console.log("=".repeat(70))

  // TSC Results Table
  if (results[0]?.tsc) {
    console.log("\n## TSC --noEmit Time (ms)\n")
    console.log("| Routes | vanilla-trpc | effect-trpc | Difference | % Change |")
    console.log("|--------|--------------|-------------|------------|----------|")

    for (const r of results) {
      if (r.tsc) {
        const diff = r.tsc.effect.timeMs - r.tsc.vanilla.timeMs
        const pct = ((r.tsc.effect.timeMs / r.tsc.vanilla.timeMs - 1) * 100).toFixed(1)
        console.log(
          `| ${r.routeCount} | ${r.tsc.vanilla.timeMs} | ${r.tsc.effect.timeMs} | ${diff >= 0 ? "+" : ""}${diff} | ${pct}% |`,
        )
      }
    }
  }

  // TSServer Results Tables
  if (results[0]?.tsserver) {
    const operations = [
      "projectLoadMs",
      "hover",
      "autocomplete",
      "goToDefinition",
      "diagnostics",
    ] as const

    for (const op of operations) {
      const opName =
        op === "projectLoadMs"
          ? "Project Load"
          : op === "goToDefinition"
            ? "Go to Definition"
            : op.charAt(0).toUpperCase() + op.slice(1)

      console.log(`\n## TSServer ${opName} Time (ms)\n`)
      console.log("| Routes | vanilla-trpc | effect-trpc | Difference | % Change |")
      console.log("|--------|--------------|-------------|------------|----------|")

      for (const r of results) {
        if (r.tsserver) {
          const vanilla = r.tsserver.vanilla[op]
          const effect = r.tsserver.effect[op]
          const diff = effect - vanilla
          const pct = vanilla > 0 ? ((effect / vanilla - 1) * 100).toFixed(1) : "N/A"
          console.log(
            `| ${r.routeCount} | ${vanilla} | ${effect} | ${diff >= 0 ? "+" : ""}${diff} | ${pct}% |`,
          )
        }
      }
    }
  }
}

// Main
async function main() {
  const args = process.argv.slice(2)
  const quick = args.includes("--quick")
  const tscOnly = args.includes("--tsc-only")
  const tsserverOnly = args.includes("--tsserver-only")

  const config: BenchmarkConfig = quick
    ? {
        routeCounts: [100, 400],
        iterations: 2,
        runTsc: !tsserverOnly,
        runTsServer: !tscOnly,
      }
    : {
        routeCounts: [100, 400, 800, 1600],
        iterations: 3,
        runTsc: !tsserverOnly,
        runTsServer: !tscOnly,
      }

  const results = await runBenchmarkSuite(config)

  // Print results
  printResultsTable(results)

  // Save final results
  const finalResultsFile = path.join(ROOT, "results", `benchmark-${Date.now()}.json`)
  const resultsDir = path.dirname(finalResultsFile)
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true })
  }

  fs.writeFileSync(
    finalResultsFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        config,
        results,
      },
      null,
      2,
    ),
  )

  console.log(`\nFull results saved to: ${finalResultsFile}`)
}

main().catch(console.error)
