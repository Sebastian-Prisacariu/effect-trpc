/**
 * Results Analyzer
 *
 * Analyzes and formats benchmark results with:
 * - Pretty tables
 * - Comparison charts (ASCII)
 * - Summary statistics
 * - Markdown export
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

interface BenchmarkResults {
  timestamp: string
  config: {
    routeCounts: number[]
    iterations: number
  }
  results: Array<{
    routeCount: number
    tsc?: {
      vanilla: { timeMs: number }
      effect: { timeMs: number }
    }
    tsserver?: {
      vanilla: Record<string, number>
      effect: Record<string, number>
    }
  }>
}

function loadLatestResults(): BenchmarkResults | null {
  const resultsDir = path.join(ROOT, "results")
  if (!fs.existsSync(resultsDir)) return null

  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.startsWith("benchmark-") && f.endsWith(".json"))
    .sort()
    .reverse()

  if (files.length === 0) return null

  return JSON.parse(fs.readFileSync(path.join(resultsDir, files[0]), "utf8"))
}

function createBarChart(
  label: string,
  value: number,
  maxValue: number,
  width: number = 40,
): string {
  const filled = Math.round((value / maxValue) * width)
  const bar = "#".repeat(filled) + "-".repeat(width - filled)
  return `${label.padEnd(15)} |${bar}| ${value}ms`
}

function formatComparison(vanilla: number, effect: number): string {
  const diff = effect - vanilla
  const pct = ((effect / vanilla - 1) * 100).toFixed(1)
  const direction = diff > 0 ? "slower" : diff < 0 ? "faster" : "same"
  const color = diff > 0 ? "\x1b[31m" : diff < 0 ? "\x1b[32m" : "\x1b[33m"
  const reset = "\x1b[0m"

  return `${color}${diff >= 0 ? "+" : ""}${diff}ms (${pct}% ${direction})${reset}`
}

function analyzeResults(results: BenchmarkResults) {
  console.log("=".repeat(70))
  console.log("TypeScript Performance Analysis")
  console.log("=".repeat(70))
  console.log(`\nBenchmark run: ${results.timestamp}`)
  console.log(`Iterations: ${results.config.iterations}`)
  console.log(`Route counts tested: ${results.config.routeCounts.join(", ")}`)

  // TSC Analysis
  if (results.results[0]?.tsc) {
    console.log("\n" + "-".repeat(70))
    console.log("TSC --noEmit Performance")
    console.log("-".repeat(70))

    for (const r of results.results) {
      if (!r.tsc) continue

      console.log(`\n### ${r.routeCount} Routes\n`)

      const maxTime = Math.max(r.tsc.vanilla.timeMs, r.tsc.effect.timeMs)
      console.log(createBarChart("vanilla-trpc", r.tsc.vanilla.timeMs, maxTime))
      console.log(createBarChart("effect-trpc", r.tsc.effect.timeMs, maxTime))
      console.log(`\nDifference: ${formatComparison(r.tsc.vanilla.timeMs, r.tsc.effect.timeMs)}`)
    }

    // Scaling analysis
    console.log("\n" + "-".repeat(70))
    console.log("Scaling Analysis (TSC)")
    console.log("-".repeat(70))

    if (results.results.length >= 2) {
      const first = results.results[0]
      const last = results.results[results.results.length - 1]

      if (first.tsc && last.tsc) {
        const vanillaScale = last.tsc.vanilla.timeMs / first.tsc.vanilla.timeMs
        const effectScale = last.tsc.effect.timeMs / first.tsc.effect.timeMs

        console.log(`\nFrom ${first.routeCount} to ${last.routeCount} routes:`)
        console.log(
          `  vanilla-trpc: ${first.tsc.vanilla.timeMs}ms -> ${last.tsc.vanilla.timeMs}ms (${vanillaScale.toFixed(2)}x)`,
        )
        console.log(
          `  effect-trpc:  ${first.tsc.effect.timeMs}ms -> ${last.tsc.effect.timeMs}ms (${effectScale.toFixed(2)}x)`,
        )

        if (effectScale < vanillaScale) {
          console.log(
            `\n  ✅ effect-trpc scales ${(vanillaScale / effectScale).toFixed(2)}x better!`,
          )
        } else if (effectScale > vanillaScale) {
          console.log(
            `\n  ⚠️ vanilla-trpc scales ${(effectScale / vanillaScale).toFixed(2)}x better`,
          )
        } else {
          console.log(`\n  ➖ Both frameworks scale similarly`)
        }
      }
    }
  }

  // TSServer Analysis
  if (results.results[0]?.tsserver) {
    const operations = ["projectLoadMs", "hover", "autocomplete", "goToDefinition", "diagnostics"]

    console.log("\n" + "-".repeat(70))
    console.log("TSServer (IDE) Performance")
    console.log("-".repeat(70))

    for (const r of results.results) {
      if (!r.tsserver) continue

      console.log(`\n### ${r.routeCount} Routes\n`)

      for (const op of operations) {
        const vanilla = r.tsserver.vanilla[op] ?? 0
        const effect = r.tsserver.effect[op] ?? 0
        const maxTime = Math.max(vanilla, effect, 1)

        const opLabel =
          op === "projectLoadMs"
            ? "Project Load"
            : op === "goToDefinition"
              ? "Go to Def"
              : op.charAt(0).toUpperCase() + op.slice(1)

        console.log(`\n${opLabel}:`)
        console.log(createBarChart("vanilla-trpc", vanilla, maxTime, 30))
        console.log(createBarChart("effect-trpc", effect, maxTime, 30))
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70))
  console.log("Summary")
  console.log("=".repeat(70))

  let vanillaWins = 0
  let effectWins = 0
  let ties = 0

  for (const r of results.results) {
    if (r.tsc) {
      if (r.tsc.vanilla.timeMs < r.tsc.effect.timeMs) vanillaWins++
      else if (r.tsc.effect.timeMs < r.tsc.vanilla.timeMs) effectWins++
      else ties++
    }

    if (r.tsserver) {
      for (const op of Object.keys(r.tsserver.vanilla)) {
        const v = r.tsserver.vanilla[op]
        const e = r.tsserver.effect[op]
        if (v < e) vanillaWins++
        else if (e < v) effectWins++
        else ties++
      }
    }
  }

  console.log(`\nOverall performance comparisons:`)
  console.log(`  vanilla-trpc faster: ${vanillaWins}`)
  console.log(`  effect-trpc faster:  ${effectWins}`)
  console.log(`  Ties:                ${ties}`)
}

function exportMarkdown(results: BenchmarkResults): string {
  let md = `# TypeScript Performance Benchmark Results

**Date:** ${results.timestamp}
**Iterations:** ${results.config.iterations}
**Route counts:** ${results.config.routeCounts.join(", ")}

## TSC Compilation Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
`

  for (const r of results.results) {
    if (r.tsc) {
      const diff = r.tsc.effect.timeMs - r.tsc.vanilla.timeMs
      const pct = ((r.tsc.effect.timeMs / r.tsc.vanilla.timeMs - 1) * 100).toFixed(1)
      md += `| ${r.routeCount} | ${r.tsc.vanilla.timeMs}ms | ${r.tsc.effect.timeMs}ms | ${diff >= 0 ? "+" : ""}${diff}ms | ${pct}% |\n`
    }
  }

  if (results.results[0]?.tsserver) {
    const operations = [
      ["projectLoadMs", "Project Load"],
      ["hover", "Hover"],
      ["autocomplete", "Autocomplete"],
      ["goToDefinition", "Go to Definition"],
      ["diagnostics", "Diagnostics"],
    ]

    for (const [op, label] of operations) {
      md += `\n## TSServer ${label} Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
`
      for (const r of results.results) {
        if (r.tsserver) {
          const vanilla = r.tsserver.vanilla[op] ?? 0
          const effect = r.tsserver.effect[op] ?? 0
          const diff = effect - vanilla
          const pct = vanilla > 0 ? ((effect / vanilla - 1) * 100).toFixed(1) : "N/A"
          md += `| ${r.routeCount} | ${vanilla}ms | ${effect}ms | ${diff >= 0 ? "+" : ""}${diff}ms | ${pct}% |\n`
        }
      }
    }
  }

  return md
}

// Main
const results = loadLatestResults()
if (!results) {
  console.error("No benchmark results found. Run `npm run bench:all` first.")
  process.exit(1)
}

analyzeResults(results)

// Export markdown
const mdPath = path.join(ROOT, "results", "RESULTS.md")
fs.writeFileSync(mdPath, exportMarkdown(results))
console.log(`\nMarkdown report saved to: ${mdPath}`)
