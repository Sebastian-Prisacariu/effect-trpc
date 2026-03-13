# TypeScript Performance Benchmark Results

**Date:** 2026-02-24T10:00:19.546Z
**Iterations:** 3
**Route counts:** 100, 400, 800, 1600

## TSC Compilation Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 1270ms | 735ms | -535ms | -42.1% |
| 400 | 2629ms | 809ms | -1820ms | -69.2% |
| 800 | 4641ms | 741ms | -3900ms | -84.0% |
| 1600 | 8518ms | 1024ms | -7494ms | -88.0% |

## TSServer Project Load Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 502ms | 615ms | +113ms | 22.5% |
| 400 | 563ms | 641ms | +78ms | 13.9% |
| 800 | 672ms | 661ms | -11ms | -1.6% |
| 1600 | 466ms | 661ms | +195ms | 41.8% |

## TSServer Hover Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 0ms | 0ms | +0ms | N/A% |
| 400 | 0ms | 0ms | +0ms | N/A% |
| 800 | 0ms | 0ms | +0ms | N/A% |
| 1600 | 0ms | 0ms | +0ms | N/A% |

## TSServer Autocomplete Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 1ms | 0ms | -1ms | -100.0% |
| 400 | 0ms | 0ms | +0ms | N/A% |
| 800 | 0ms | 0ms | +0ms | N/A% |
| 1600 | 0ms | 0ms | +0ms | N/A% |

## TSServer Go to Definition Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 0ms | 0ms | +0ms | N/A% |
| 400 | 0ms | 0ms | +0ms | N/A% |
| 800 | 0ms | 0ms | +0ms | N/A% |
| 1600 | 0ms | 0ms | +0ms | N/A% |

## TSServer Diagnostics Time

| Routes | vanilla-trpc | effect-trpc | Difference | % Change |
|--------|--------------|-------------|------------|----------|
| 100 | 0ms | 0ms | +0ms | N/A% |
| 400 | 0ms | 0ms | +0ms | N/A% |
| 800 | 0ms | 0ms | +0ms | N/A% |
| 1600 | 0ms | 0ms | +0ms | N/A% |
