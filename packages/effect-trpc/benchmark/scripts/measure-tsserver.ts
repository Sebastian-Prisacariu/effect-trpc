/**
 * TSServer Performance Measurement (Alternative Approach)
 *
 * Uses TypeScript's language service directly instead of the server protocol.
 * This is more reliable and gives us direct access to timing information.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

interface MeasurementResult {
  operation: string
  timeMs: number
  success: boolean
}

interface TsServerBenchmark {
  framework: string
  projectLoadMs: number
  measurements: MeasurementResult[]
}

/**
 * Create a language service for a project
 */
function createLanguageService(projectDir: string): {
  service: ts.LanguageService
  files: Map<string, string>
} {
  const configPath = path.join(projectDir, "tsconfig.json")
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectDir)

  const files = new Map<string, string>()

  // Read all files
  for (const fileName of config.fileNames) {
    files.set(fileName, fs.readFileSync(fileName, "utf8"))
  }

  const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const content = files.get(fileName) ?? fs.readFileSync(fileName, "utf8")
      return ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => projectDir,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  const service = ts.createLanguageService(servicesHost, ts.createDocumentRegistry())

  return { service, files }
}

/**
 * Find test position in file
 */
function findPosition(
  content: string,
  pattern: RegExp,
): { line: number; offset: number; position: number } {
  const match = content.match(pattern)
  if (!match || match.index === undefined) {
    return { line: 1, offset: 1, position: 0 }
  }

  const beforeMatch = content.slice(0, match.index)
  const lines = beforeMatch.split("\n")

  return {
    line: lines.length,
    offset: lines[lines.length - 1].length + 1,
    position: match.index,
  }
}

/**
 * Run benchmark for a framework
 */
function benchmarkFramework(projectDir: string): TsServerBenchmark {
  const framework = path.basename(projectDir)
  console.log(`\nBenchmarking ${framework}...`)

  const clientPath = path.join(projectDir, "client.ts")
  const measurements: MeasurementResult[] = []

  // 1. Create language service (measure load time)
  console.log("  Creating language service...")
  const loadStart = performance.now()
  const { service, files } = createLanguageService(projectDir)

  // Force initial compilation
  service.getProgram()
  const projectLoadMs = performance.now() - loadStart
  console.log(`  Project loaded in ${Math.round(projectLoadMs)}ms`)

  const clientContent = files.get(clientPath) ?? ""

  // Find test positions
  const hoverPos = findPosition(clientContent, /result_\d+/)
  const autocompletePos = findPosition(clientContent, /trpc\./)
  autocompletePos.position += 5 // After "trpc."
  const definitionPos = findPosition(clientContent, /route_\d+/)

  // 2. Measure hover (quick info)
  console.log("  Measuring hover...")
  const hoverTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    service.getQuickInfoAtPosition(clientPath, hoverPos.position)
    hoverTimes.push(performance.now() - start)
  }
  const medianHover = hoverTimes.sort((a, b) => a - b)[2]
  measurements.push({ operation: "hover", timeMs: Math.round(medianHover), success: true })
  console.log(`    Hover: ${Math.round(medianHover)}ms`)

  // 3. Measure autocomplete (completions)
  console.log("  Measuring autocomplete...")
  const completionTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    service.getCompletionsAtPosition(clientPath, autocompletePos.position, undefined)
    completionTimes.push(performance.now() - start)
  }
  const medianCompletion = completionTimes.sort((a, b) => a - b)[2]
  measurements.push({
    operation: "autocomplete",
    timeMs: Math.round(medianCompletion),
    success: true,
  })
  console.log(`    Autocomplete: ${Math.round(medianCompletion)}ms`)

  // 4. Measure go-to-definition
  console.log("  Measuring go-to-definition...")
  const defTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    service.getDefinitionAtPosition(clientPath, definitionPos.position)
    defTimes.push(performance.now() - start)
  }
  const medianDef = defTimes.sort((a, b) => a - b)[2]
  measurements.push({ operation: "goToDefinition", timeMs: Math.round(medianDef), success: true })
  console.log(`    Go-to-definition: ${Math.round(medianDef)}ms`)

  // 5. Measure diagnostics
  console.log("  Measuring diagnostics...")
  const diagTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    service.getSemanticDiagnostics(clientPath)
    diagTimes.push(performance.now() - start)
  }
  const medianDiag = diagTimes.sort((a, b) => a - b)[2]
  measurements.push({ operation: "diagnostics", timeMs: Math.round(medianDiag), success: true })
  console.log(`    Diagnostics: ${Math.round(medianDiag)}ms`)

  return {
    framework,
    projectLoadMs: Math.round(projectLoadMs),
    measurements,
  }
}

// Main
function main() {
  const vanillaDir = path.join(ROOT, "vanilla-trpc")
  const effectDir = path.join(ROOT, "effect-trpc")

  if (!fs.existsSync(path.join(vanillaDir, "generated", "routes.ts"))) {
    console.error("Generated routes not found. Run `npm run generate` first.")
    process.exit(1)
  }

  console.log("=".repeat(60))
  console.log("Language Service Performance Benchmark")
  console.log("=".repeat(60))

  const vanillaResult = benchmarkFramework(vanillaDir)
  const effectResult = benchmarkFramework(effectDir)

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("Results Summary")
  console.log("=".repeat(60))

  console.log("\nProject Load Time:")
  console.log(`  vanilla-trpc: ${vanillaResult.projectLoadMs}ms`)
  console.log(`  effect-trpc:  ${effectResult.projectLoadMs}ms`)
  const loadDiff = effectResult.projectLoadMs - vanillaResult.projectLoadMs
  const loadPct = ((effectResult.projectLoadMs / vanillaResult.projectLoadMs - 1) * 100).toFixed(1)
  console.log(`  Difference:   ${loadDiff >= 0 ? "+" : ""}${loadDiff}ms (${loadPct}%)`)

  console.log("\nOperation Times (median of 5):")
  for (const m of vanillaResult.measurements) {
    const em = effectResult.measurements.find((x) => x.operation === m.operation)
    if (em) {
      const diff = em.timeMs - m.timeMs
      const pct = m.timeMs > 0 ? ((em.timeMs / m.timeMs - 1) * 100).toFixed(1) : "0"
      console.log(
        `  ${m.operation.padEnd(15)}: vanilla=${m.timeMs}ms, effect=${em.timeMs}ms (${diff >= 0 ? "+" : ""}${diff}ms, ${pct}%)`,
      )
    }
  }

  // Save results
  const resultsFile = path.join(ROOT, "results", `tsserver-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true })
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        vanilla: vanillaResult,
        effect: effectResult,
      },
      null,
      2,
    ),
  )

  console.log(`\nResults saved to: ${resultsFile}`)
}

main()
