# React Integration Analysis

## Overview

The effect-trpc library has a **custom React integration** that does NOT use `@effect-atom/atom-react` hooks despite listing it as a required peer dependency. Instead, it builds React hooks from scratch using vanilla React primitives.

## Implementation Status

### Provider Component
**Status: IMPLEMENTED**  
**Location:** `src/Client/react.ts:78-111`

```typescript
export const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  return function Provider({ layer, children }: ProviderProps) {
    const [contextValue] = useState<ClientContextValue>(() => {
      const fullLayer = ClientServiceLive.pipe(
        Layer.provideMerge(Reactivity.ReactivityLive),
        Layer.provide(layer)
      )
      const runtime = ManagedRuntime.make(fullLayer)
      const reactivity = Reactivity.make()
      return { runtime, reactivity, rootTag: router.tag }
    })
    
    useEffect(() => {
      return () => { contextValue.runtime.dispose() }
    }, [contextValue])
    
    return React.createElement(ClientContext.Provider, { value: contextValue }, children)
  }
}
```

**Assessment:** Works, but uses plain React Context instead of atom-based state management.

---

### useQuery Hook
**Status: IMPLEMENTED (custom, not using @effect-atom/atom-react)**  
**Location:** `src/Client/react.ts:122-235`

The hook:
- Uses `useState` for state management (line 151)
- Uses `useCallback` for fetch function (line 157)
- Uses `useEffect` for subscriptions (lines 191-217)
- Uses `useRef` for tracking mounted state (lines 153-154)

**What it DOES use:**
```typescript
import * as Result from "@effect-atom/atom/Result"  // Result type only!
```

**What it does NOT use:**
- `useAtom` from `@effect-atom/atom-react`
- `useAtomValue` from `@effect-atom/atom-react`
- Any reactive atom primitives

**Code Evidence (lines 151-188):**
```typescript
const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
const [isLoading, setIsLoading] = useState(false)
const mountedRef = useRef(true)
const fetchIdRef = useRef(0)

const fetchData = useCallback(async () => {
  // ... manual state management
  setIsLoading(true)
  setResult(Result.initial(true))
  // ... fetch logic
  setResult(Result.success<Success, Error>(exit.value as Success))
}, [enabled, payload, ctx.runtime])
```

---

### useMutation Hook
**Status: IMPLEMENTED (custom, not using @effect-atom/atom-react)**  
**Location:** `src/Client/react.ts:246-348`

Same pattern as useQuery - uses vanilla React state management:
```typescript
const [isLoading, setIsLoading] = useState(false)
const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
const mountedRef = useRef(true)
```

---

### useStream Hook
**Status: IMPLEMENTED (custom, not using @effect-atom/atom-react)**  
**Location:** `src/Client/react.ts:359-461`

Same pattern:
```typescript
const [items, setItems] = useState<Success[]>([])
const [isStreaming, setIsStreaming] = useState(false)
const [error, setError] = useState<Error | undefined>()
```

**Notable Issue (line 432-436):**
```typescript
// Cleanup - note: we can't easily abort a running stream
// This would need Fiber interrupt support
return () => {
  abortRef.current?.()
}
```
Stream cancellation is not actually implemented.

---

## Peer Dependency Analysis

### Package.json (lines 32-47)
```json
"peerDependencies": {
  "effect": "^3.0.0",
  "@effect/rpc": "^0.50.0",
  "@effect/platform": "^0.70.0",
  "@effect-atom/atom": "^0.5.0",
  "@effect-atom/atom-react": "^0.5.0",   // LISTED BUT NOT USED
  "react": "^18.0.0 || ^19.0.0"
},
"peerDependenciesMeta": {
  "react": { "optional": true },
  "@effect-atom/atom-react": { "optional": true }  // Marked optional, still misleading
}
```

### What IS Actually Used

| Dependency | Import Location | What's Used |
|------------|-----------------|-------------|
| `@effect-atom/atom` | `src/Client/react.ts:20` | `Result` type only |
| `@effect-atom/atom-react` | **NOWHERE** | **NOTHING** |
| `react` | `src/Client/react.ts:11-12` | Standard hooks |

### Grep Results
```bash
grep -r "@effect-atom/atom-react" src/
# No results in src/ directory
```

---

## Critical Findings

### 1. **CRITICAL: @effect-atom/atom-react Not Used**
The CLAUDE.md project requirements state:
> `@effect-atom/atom-react` | React hooks (useAtom, useAtomValue) | **REQUIRED for React**

But the actual implementation:
- Never imports `@effect-atom/atom-react`
- Uses vanilla `useState`, `useCallback`, `useEffect`
- Only uses `@effect-atom/atom/Result` as a type

### 2. **HIGH: Manual State Management Instead of Atoms**
The implementation manually manages:
- Loading states with `useState<boolean>`
- Result states with `useState<Result<S, E>>`
- Refs for mounted tracking
- Refs for fetch ID tracking

This defeats the purpose of using Effect's reactive primitives.

### 3. **MEDIUM: Reactivity System is Custom**
`src/Reactivity/index.ts` implements a custom pub/sub system:
```typescript
const subscriptions = new Map<string, Set<InvalidationCallback>>()
```

This could potentially integrate with `@effect-atom/atom`'s reactive system but doesn't.

### 4. **MEDIUM: Stream Cancellation Not Working**
`src/Client/react.ts:432-436` has a comment admitting the cleanup doesn't work:
```typescript
// Cleanup - note: we can't easily abort a running stream
// This would need Fiber interrupt support
```

### 5. **LOW: Type-Only Usage of Result**
The Result import is only for the type definition, not the reactive behavior:
```typescript
import * as Result from "@effect-atom/atom/Result"
// Used as: useState<Result.Result<Success, Error>>(Result.initial())
```

---

## What Should Be Used

Based on `@effect-atom/atom-react`, the hooks should use:

```typescript
import { useAtom, useAtomValue, Atom } from "@effect-atom/atom-react"

// Instead of:
const [result, setResult] = useState<Result.Result<S, E>>(Result.initial())

// Should be:
const resultAtom = useMemo(() => Atom.of(Result.initial<S, E>()), [])
const [result, setResult] = useAtom(resultAtom)
```

Or potentially using `AtomRpc` from `@effect-atom/atom` for RPC-specific reactive patterns.

---

## Severity Assessment

| Issue | Severity | Impact |
|-------|----------|--------|
| @effect-atom/atom-react listed but not used | **CRITICAL** | Misleading dependency, project requirements violated |
| Manual state management | **HIGH** | Loses reactive benefits, inconsistent with Effect ecosystem |
| Stream cancellation broken | **MEDIUM** | Memory leaks, zombie streams possible |
| Custom reactivity vs atom integration | **MEDIUM** | Missed optimization opportunities |
| Result used as plain type | **LOW** | Works but not idiomatic |

---

## Recommendations

1. **Either use @effect-atom/atom-react properly OR remove it from peer dependencies**
2. **Refactor hooks to use Atom-based state management**
3. **Implement proper stream cancellation using Effect.Fiber**
4. **Consider using AtomRpc for query/mutation patterns**

---

## Files Reviewed

- `src/Client/index.ts` (777 lines)
- `src/Client/react.ts` (462 lines)
- `src/Reactivity/index.ts` (305 lines)
- `src/Result/index.ts` (10 lines)
- `package.json` (69 lines)
- `test/client.test.ts` (207 lines)
