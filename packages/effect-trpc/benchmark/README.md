# TypeScript Performance Benchmark

Benchmarks TypeScript compiler and language server performance comparing **vanilla tRPC** vs **effect-trpc** at scale.

## Why This Matters

Large applications with many RPC routes can cause TypeScript performance issues:
- Slow autocomplete in IDEs
- Laggy hover information
- Long type-checking times
- High memory usage

This benchmark measures these metrics across different route counts to help understand how each framework scales.

## What's Measured

### TSC Compilation (`tsc --noEmit`)
- Total compilation time
- Type checking time (via `--generateTrace`)
- Binding time
- Parse time

### TSServer (Language Server)
- **Project Load**: Time to initialize the project
- **Hover**: Time to show type information on hover
- **Autocomplete**: Time to generate completion suggestions
- **Go to Definition**: Time to find definition location
- **Diagnostics**: Time to compute errors/warnings

## Quick Start

```bash
# Install dependencies
npm install

# Run quick benchmark (100 and 400 routes)
npm run bench:quick

# Run full benchmark (100, 400, 800, 1600 routes)
npm run bench:all

# Analyze results
npm run analyze
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run generate` | Generate routes (default: 400) |
| `npm run generate:100` | Generate 100 routes |
| `npm run generate:400` | Generate 400 routes |
| `npm run generate:800` | Generate 800 routes |
| `npm run generate:1600` | Generate 1600 routes |
| `npm run bench:tsc` | Run TSC benchmark only |
| `npm run bench:tsserver` | Run TSServer benchmark only |
| `npm run bench:all` | Run complete benchmark suite |
| `npm run bench:quick` | Quick benchmark (fewer routes/iterations) |
| `npm run analyze` | Analyze and display results |
| `npm run clean` | Clean generated files |

## Route Generation

Routes are generated with varying complexity to simulate real-world scenarios:

- **50% Simple**: Single ID input, basic output
- **35% Medium**: Pagination, optional filters
- **15% Complex**: Nested objects, arrays, unions, records

Procedure types:
- **70% Queries**
- **30% Mutations**

## Directory Structure

```
benchmark/
├── vanilla-trpc/
│   ├── generated/
│   │   └── routes.js      # Generated route definitions
│   ├── client.js          # Client usage (test targets)
│   └── tsconfig.json
├── effect-trpc/
│   ├── generated/
│   │   └── routes.js      # Generated route definitions
│   ├── client.js          # Client usage (test targets)
│   └── tsconfig.json
├── scripts/
│   ├── generate-routes.js # Route generator
│   ├── measure-tsc.js     # TSC benchmark
│   ├── measure-tsserver.js # TSServer benchmark
│   ├── run-benchmark.js   # Main benchmark runner
│   └── analyze-results.js # Results analyzer
├── results/               # Benchmark results (JSON + Markdown)
├── package.json
├── tsconfig.base.json
└── README.md
```

## Understanding Results

### Interpretation Guide

- **Negative % change**: effect-trpc is faster
- **Positive % change**: vanilla-trpc is faster
- **< 10% difference**: Likely within noise margin

### What to Look For

1. **Scaling behavior**: Does one framework scale better as routes increase?
2. **IDE responsiveness**: Are hover/autocomplete times acceptable (< 100ms)?
3. **Project load time**: Important for developer experience when switching branches

### Acceptable Thresholds

| Operation | Good | Acceptable | Poor |
|-----------|------|------------|------|
| Hover | < 50ms | < 100ms | > 200ms |
| Autocomplete | < 100ms | < 200ms | > 500ms |
| Go to Definition | < 50ms | < 100ms | > 200ms |
| TSC (800 routes) | < 5s | < 10s | > 20s |

## Manual Testing

For subjective "feel" testing in your IDE:

1. Generate routes: `npm run generate:800`
2. Open `vanilla-trpc/client.js` or `effect-trpc/client.js`
3. Try:
   - Typing `trpc.` and waiting for autocomplete
   - Hovering over `result` variables
   - Ctrl+Click on route names
4. Note any perceived lag

## Contributing

When adding new benchmarks:

1. Add measurement code to the appropriate script
2. Update the results interface in `run-benchmark.js`
3. Update the analysis in `analyze-results.js`
4. Document in this README

## Caveats

- Results vary by machine (CPU, RAM, disk speed)
- TypeScript version affects performance
- First run may be slower (cold cache)
- Real projects have additional complexity (imports, dependencies)
