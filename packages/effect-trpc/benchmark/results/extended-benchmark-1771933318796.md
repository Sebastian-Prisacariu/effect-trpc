# Extended TypeScript Performance Benchmark Results

**Date:** 2026-02-24T11:41:58.787Z
**Iterations per route count:** 50
**Route counts tested:** 100, 400, 800, 1600, 3200, 6400

## Summary Table (Percentage Comparison)

**Reading the table:** 
- ✅ **Positive %** = effect-trpc is **faster** (better)
- ❌ **Negative %** = effect-trpc is **slower** (worse)
- ➖ **Same** = No measurable difference (<1% or <1ms)

### TSC --noEmit Time (Median)

| Routes | vanilla-trpc | effect-trpc | Improvement |
|--------|--------------|-------------|-------------|
| 100 | 1273ms | 758ms | ✅ **+40.5%** |
| 400 | 2582ms | 748ms | ✅ **+71.0%** |
| 800 | 4347ms | 760ms | ✅ **+82.5%** |
| 1600 | 8665ms | 757ms | ✅ **+91.3%** |
| 3200 | 20461ms | 942ms | ✅ **+95.4%** |
| 6400 | 59075ms | 1034ms | ✅ **+98.2%** |

### Project Load Time (Median)

| Routes | vanilla-trpc | effect-trpc | Comparison |
|--------|--------------|-------------|------------|
| 100 | 307ms | 546ms | ❌ -77.9% |
| 400 | 290ms | 535ms | ❌ -84.5% |
| 800 | 343ms | 540ms | ❌ -57.4% |
| 1600 | 363ms | 507ms | ❌ -39.7% |
| 3200 | 445ms | 621ms | ❌ -39.6% |
| 6400 | 660ms | 777ms | ❌ -17.7% |

## Detailed Statistical Analysis

### TSC --noEmit Time

| Routes | Framework | Median | Mean | Std Dev | Min | Max | P5 | P95 |
|--------|-----------|--------|------|---------|-----|-----|-----|-----|
| 100 | vanilla-trpc | 1273ms | 1246ms | ±126ms | 978ms | 1500ms | 999ms | 1430ms |
| | effect-trpc | 758ms | 737ms | ±85ms | 574ms | 1041ms | 580ms | 836ms |
| 400 | vanilla-trpc | 2582ms | 2538ms | ±209ms | 2093ms | 3183ms | 2149ms | 2848ms |
| | effect-trpc | 748ms | 739ms | ±107ms | 545ms | 1076ms | 566ms | 903ms |
| 800 | vanilla-trpc | 4347ms | 4364ms | ±209ms | 3971ms | 4836ms | 3983ms | 4721ms |
| | effect-trpc | 760ms | 742ms | ±75ms | 575ms | 889ms | 583ms | 824ms |
| 1600 | vanilla-trpc | 8665ms | 8753ms | ±638ms | 7560ms | 12190ms | 8166ms | 9508ms |
| | effect-trpc | 757ms | 750ms | ±97ms | 560ms | 964ms | 594ms | 919ms |
| 3200 | vanilla-trpc | 20461ms | 20899ms | ±1490ms | 18892ms | 25707ms | 19425ms | 24285ms |
| | effect-trpc | 942ms | 959ms | ±267ms | 623ms | 2424ms | 668ms | 1336ms |
| 6400 | vanilla-trpc | 59075ms | 63048ms | ±9172ms | 53709ms | 92429ms | 54011ms | 79585ms |
| | effect-trpc | 1034ms | 1037ms | ±205ms | 664ms | 1696ms | 738ms | 1455ms |

### Project Load Time

| Routes | Framework | Median | Mean | Std Dev | Min | Max | P5 | P95 |
|--------|-----------|--------|------|---------|-----|-----|-----|-----|
| 100 | vanilla-trpc | 307ms | 312ms | ±22ms | 289ms | 341ms | 289ms | 341ms |
| | effect-trpc | 546ms | 534ms | ±18ms | 504ms | 551ms | 504ms | 551ms |
| 400 | vanilla-trpc | 290ms | 298ms | ±37ms | 257ms | 357ms | 257ms | 357ms |
| | effect-trpc | 535ms | 542ms | ±69ms | 428ms | 631ms | 428ms | 631ms |
| 800 | vanilla-trpc | 343ms | 340ms | ±62ms | 237ms | 432ms | 237ms | 432ms |
| | effect-trpc | 540ms | 532ms | ±55ms | 435ms | 593ms | 435ms | 593ms |
| 1600 | vanilla-trpc | 363ms | 373ms | ±63ms | 294ms | 485ms | 294ms | 485ms |
| | effect-trpc | 507ms | 504ms | ±27ms | 471ms | 538ms | 471ms | 538ms |
| 3200 | vanilla-trpc | 445ms | 455ms | ±80ms | 351ms | 598ms | 351ms | 598ms |
| | effect-trpc | 621ms | 612ms | ±60ms | 532ms | 701ms | 532ms | 701ms |
| 6400 | vanilla-trpc | 660ms | 747ms | ±222ms | 481ms | 1137ms | 481ms | 1137ms |
| | effect-trpc | 777ms | 838ms | ±188ms | 697ms | 1204ms | 697ms | 1204ms |

## Scaling Analysis

| Metric | vanilla-trpc | effect-trpc |
|--------|--------------|-------------|
| TSC time at 100 routes | 1273ms | 758ms |
| TSC time at 6400 routes | 59075ms | 1034ms |
| Scaling factor | 46.41x | 1.36x |
| Scaling advantage | - | **34.02x better** |

### Time Saved at Scale

| Routes | Time saved per TSC run | Saves/day (100) | Weekly savings |
|--------|------------------------|-----------------|----------------|
| 100 | 0.5s | 0.9 min | 4.3 min |
| 400 | 1.8s | 3.1 min | 15.3 min |
| 800 | 3.6s | 6.0 min | 29.9 min |
| 1600 | 7.9s | 13.2 min | 65.9 min |
| 3200 | 19.5s | 32.5 min | 162.7 min |
| 6400 | 58.0s | 96.7 min | 483.7 min |

## Variance Analysis

Low standard deviation indicates consistent performance. High variance may indicate:
- Background system processes
- Garbage collection pauses
- Cache effects

| Routes | vanilla-trpc CV | effect-trpc CV | More Consistent |
|--------|-----------------|----------------|-----------------|
| 100 | 10.1% | 11.5% | vanilla-trpc |
| 400 | 8.2% | 14.5% | vanilla-trpc |
| 800 | 4.8% | 10.1% | vanilla-trpc |
| 1600 | 7.3% | 12.9% | vanilla-trpc |
| 3200 | 7.1% | 27.8% | vanilla-trpc |
| 6400 | 14.5% | 19.8% | vanilla-trpc |
