# Benchmark Result Format

This document defines the standard format for presenting TypeScript performance benchmark results.

## Summary Table (Percentage Comparison)

**Reading the table:** 
- ✅ **Positive %** = effect-trpc is **faster** (better)
- ❌ **Negative %** = effect-trpc is **slower** (worse)
- ➖ **Same** = No measurable difference

| Parameter | 100 Routes | 400 Routes | 800 Routes | 1600 Routes | 3200 Routes | 6400 Routes |
|-----------|------------|------------|------------|-------------|-------------|-------------|
| **TSC --noEmit** | ✅ +X% | ✅ +X% | ✅ +X% | ✅ +X% | ✅ +X% | ✅ +X% |
| **Project Load** | ❌ -X% | ❌ -X% | ➖ ±X% | ❌ -X% | ? | ? |
| **Hover** | ➖ Same | ➖ Same | ➖ Same | ➖ Same | ? | ? |
| **Autocomplete** | ➖ Same | ➖ Same | ➖ Same | ➖ Same | ? | ? |
| **Go-to-Definition** | ➖ Same | ➖ Same | ➖ Same | ➖ Same | ? | ? |
| **Diagnostics** | ➖ Same | ➖ Same | ➖ Same | ➖ Same | ? | ? |

## Raw Numbers Table

| Parameter | Routes | vanilla-trpc | effect-trpc | Δ (ms) |
|-----------|--------|--------------|-------------|--------|
| **TSC --noEmit** | 100 | Xms | Xms | Xms |
| | 400 | Xms | Xms | Xms |
| | ... | ... | ... | ... |

## Statistical Analysis (when running multiple iterations)

| Parameter | Routes | Framework | Median | Mean | Std Dev | Min | Max | P5 | P95 |
|-----------|--------|-----------|--------|------|---------|-----|-----|-----|-----|
| TSC | X | vanilla | Xms | Xms | Xms | Xms | Xms | Xms | Xms |
| TSC | X | effect | Xms | Xms | Xms | Xms | Xms | Xms | Xms |

## Summary by Category

| Category | Winner | Notes |
|----------|--------|-------|
| **Type-checking speed** | ✅ **effect-trpc** | X-Y% faster, scales dramatically better |
| **IDE responsiveness** | ➖ **Tie** | Both instant (<1ms) for all operations |
| **Project initialization** | ❌ **vanilla-trpc** | ~X% faster initial load |

## Scaling Analysis

| Framework | Scaling Factor (100→max routes) | Complexity Estimate |
|-----------|--------------------------------|---------------------|
| vanilla-trpc | Xx | O(n²) or worse |
| effect-trpc | Xx | O(n) or O(n log n) |

## Developer Impact

| Metric | Impact at max route count |
|--------|---------------------------|
| **Per save** | X seconds saved |
| **100 saves/day** | X minutes saved daily |
| **CI pipeline** | X% faster type-check step |
