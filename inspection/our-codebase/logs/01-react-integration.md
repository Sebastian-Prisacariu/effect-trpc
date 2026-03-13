# React Integration Analysis

**Date:** 2026-03-13
**Files Analyzed:**
- `src/Client/index.ts` (776 lines)
- `src/Client/react.ts` (457 lines)  
- `src/SSR/index.ts` (209 lines)

## Summary

The React integration uses `@effect-atom/atom-react` as required, but has **significant implementation gaps** and **incorrect API usage** that will cause runtime errors.

---

## 1. @effect-atom/atom-react Import Status

### Imports in `src/Client/react.ts` (lines 20-30)

```typescript
import {
  Atom,
  Registry,
  Result,
  useAtomValue,
  useAtomSuspense,
  useAtomRefresh,
  useAtomMount,
  RegistryContext,
  RegistryProvider,
} from "@effect-atom/atom-react"
```

**Status:** IMPORTED

| Import | Exists in Library | Used Correctly |
|--------|-------------------|----------------|
| `Atom` | Yes | NO - see issues |
| `Registry` | Yes | Partially |
| `Result` | Yes | Yes |
| `useAtomValue` | Yes | Yes |
| `useAtomSuspense` | Yes | Partially |
| `useAtomRefresh` | Yes | Yes |
| `useAtomMount` | Yes | Yes |
| `RegistryContext` | Yes | Partially |
| `RegistryProvider` | Yes | Yes |

### Missing Imports
- `useAtomSet` - needed for mutations
- `useAtom` - tuple hook [value, setter]

---

## 2. Critical Issues

### Issue 2.1: Invalid `Atom.AtomRuntime` Type Construction

**Severity:** CRITICAL
**Location:** `src/Client/react.ts:53`

```typescript
interface TrpcContextValue {
  readonly atomRuntime: Atom.AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
  readonly rootTag: string
}
```

**Problem:** `Atom.AtomRuntime` takes `<R, ER>` where `R` is the provided context type and `ER` is the error type. However:
1. `ClientServiceTag` is a `Context.Tag`, not a service type
2. The type should be `AtomRuntime<ClientService | Reactivity.Reactivity.Service>`

**Fix:**
```typescript
readonly atomRuntime: Atom.AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
// Should be:
readonly atomRuntime: Atom.AtomRuntime<ClientService | Reactivity.Reactivity.Service>
```

---

### Issue 2.2: Invalid `Atom.runtime()` Usage

**Severity:** CRITICAL  
**Location:** `src/Client/react.ts:92-93`

```typescript
// Create AtomRuntime from the layer
const atomRuntime = Atom.runtime(fullLayer)
```

**Problem:** `Atom.runtime` is a `RuntimeFactory`, not a function that takes a layer directly. According to `@effect-atom/atom` source (Atom.ts:721-723):

```typescript
export const runtime: RuntimeFactory = globalValue(
  "@effect-atom/atom/Atom/defaultContext",
  () => context({ memoMap: defaultMemoMap })
)
```

The `RuntimeFactory` interface (Atom.ts:630-646) shows it takes a `Layer` or a function returning a `Layer`:
```typescript
<R, E>(
  create:
    | Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
    | ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
): AtomRuntime<R, E>
```

So `Atom.runtime(fullLayer)` SHOULD work, but requires `AtomRegistry | Reactivity.Reactivity` in the layer's requirements. Our `fullLayer` provides `ClientServiceTag` and `Reactivity`, but doesn't account for `AtomRegistry`.

---

### Issue 2.3: Non-Existent `factory.withReactivity` Property Access

**Severity:** CRITICAL
**Location:** `src/Client/react.ts:188-189`

```typescript
if (reactivityKeys.length > 0) {
  atom = ctx.atomRuntime.factory.withReactivity(reactivityKeys)(atom)
}
```

**Problem:** `AtomRuntime` has a `factory: RuntimeFactory` property, and `RuntimeFactory` has `withReactivity`. However, we're accessing it on the instance created from `Atom.runtime(fullLayer)`, which returns an `AtomRuntime`, not the factory itself.

**Analysis of @effect-atom source (Atom.ts:661-665):**
```typescript
const self = Object.create(RuntimeProto)
// ...
self.factory = factory  // The factory reference IS preserved!
```

So `atomRuntime.factory` should work. But the type `AtomRuntime<R, ER>` interface (lines 535-624) shows `factory: RuntimeFactory` IS present. This should work if types align.

---

### Issue 2.4: Incorrect useMutation Implementation

**Severity:** HIGH
**Location:** `src/Client/react.ts:272-296, 301-335`

**Problems:**

1. **Using `atomRuntime.fn` without proper atom management:**
```typescript
const mutationFn = useMemo(() => {
  return ctx.atomRuntime.fn<Payload>()(
    (payload, _get) => Effect.gen(function* () { /* ... */ }),
    { reactivityKeys: invalidatePaths.length > 0 ? invalidatePaths : undefined }
  )
}, [ctx.atomRuntime, tag])
```

The `fn` method returns an `AtomResultFn` (a writable atom), but then the code tries to use it incorrectly:

```typescript
// WRONG - registry.set expects the atom to exist in the registry
registry.set(mutationFn, payload)

// WRONG - immediately tries to get result (won't be ready)
const resultAtom = mutationFn
const mutationResult = registry.get(resultAtom)
```

2. **Missing async/effect handling:**
The mutation doesn't wait for the effect to complete. `registry.set` is synchronous and doesn't return a promise.

3. **Should use `useAtomSet` with `mode: "promise"`:**
```typescript
// Correct approach:
const mutate = useAtomSet(mutationFn, { mode: "promise" })
```

---

### Issue 2.5: Incomplete useStream Implementation

**Severity:** HIGH
**Location:** `src/Client/react.ts:406-436`

```typescript
// Create stream atom using runtime.pull for streams
const streamAtom = useMemo(() => {
  const streamEffect = Effect.gen(function* () {
    const service = yield* ClientServiceTag
    return service.sendStream(/* ... */)
  })
  
  return ctx.atomRuntime.atom(Stream.unwrap(streamEffect))
}, [ctx.atomRuntime, tag, payload])

// Subscribe to stream updates
useEffect(() => {
  if (!enabled) return
  
  setIsConnected(true)
  setData([])
  setError(undefined)
  
  // Use the atom to get stream values
  // This is simplified - proper implementation would use useAtomValue
  
  return () => {
    setIsConnected(false)
    abortRef.current?.()
  }
}, [enabled, streamAtom])
```

**Problems:**
1. Comment admits "This is simplified" - the implementation doesn't actually consume stream values
2. `atomRuntime.atom(Stream.unwrap(...))` wraps a stream but doesn't subscribe to updates
3. Should use `atomRuntime.pull` for streams that accumulate values
4. Missing `useAtomValue(streamAtom)` to actually read values

---

### Issue 2.6: Reactivity Integration Issues

**Severity:** MEDIUM
**Location:** `src/Client/react.ts:32-34, 88`

```typescript
import * as Reactivity from "@effect/experimental/Reactivity"
// ...
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.layer),
  Layer.provide(layer)
)
```

**Problem:** Uses `@effect/experimental/Reactivity` but `@effect-atom/atom` has its own Reactivity module that's already integrated into `AtomRuntime`. This creates a potential conflict/duplication.

**Evidence from @effect-atom (Atom.ts:655):**
```typescript
let globalLayer: Layer.Layer<any, any, AtomRegistry> = Reactivity.layer
```

The atom library already includes Reactivity in its runtime factory.

---

### Issue 2.7: Provider Not Passing Layer to AtomRuntime Correctly

**Severity:** HIGH
**Location:** `src/Client/react.ts:83-99`

```typescript
return function TrpcProvider({ layer, children }: ProviderProps) {
  const contextValue = useMemo<TrpcContextValue>(() => {
    const fullLayer = ClientServiceLive.pipe(
      Layer.provideMerge(Reactivity.layer),
      Layer.provide(layer)
    )
    
    const atomRuntime = Atom.runtime(fullLayer)
    // ...
  }, [layer])
```

**Problems:**
1. Creates a new `atomRuntime` on each `layer` change without disposing the old one
2. Layer composition is backwards - `ClientServiceLive.pipe(Layer.provide(layer))` means ClientServiceLive requires Transport, then layer provides it. This is correct.
3. But the `atomRuntime` is NOT connected to the `RegistryProvider`!

**The RegistryProvider is used:**
```typescript
return React.createElement(
  RegistryProvider,
  {},
  React.createElement(
    TrpcContext.Provider,
    { value: contextValue },
    children
  )
)
```

But atoms created via `atomRuntime.atom()` won't automatically use this registry - they create their own scoped execution!

---

## 3. Comparison with @effect-atom/atom Patterns

### Expected Pattern (from effect-atom README):

```typescript
import { Atom, useAtomValue, useAtomSet } from "@effect-atom/atom-react"

// Async atom
const usersAtom = Atom.make(
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    // fetch...
  })
)

// In component:
function UserList() {
  const result = useAtomValue(usersAtom)
  // result is Result<Users, Error>
}
```

### Our Pattern (INCORRECT):

```typescript
// Inside hook, dynamically creating atom
const queryAtom = useMemo(() => {
  return ctx.atomRuntime.atom(queryEffect)
}, [ctx.atomRuntime, tag])

// Using custom context instead of RegistryContext
const ctx = useTrpcContext()
```

---

## 4. SSR Integration

**Location:** `src/SSR/index.ts`

### Status: MINIMAL/STUB

```typescript
import { Hydration, Registry } from "@effect-atom/atom-react"
```

**Issues:**
1. `Hydration` is imported but barely used
2. `Hydrate` component doesn't actually hydrate:
```typescript
export const Hydrate: React.FC<HydrateProps> = ({ state, children }) => {
  React.useEffect(() => {
    if (state) {
      // Hydration happens automatically via context
      // The Provider's registry will pick up the state
    }
  }, [state])
  
  return React.createElement(React.Fragment, null, children)
}
```
3. No actual hydration logic - just passes children through

---

## 5. Type Safety Issues

### Issue 5.1: React Type Declarations

**Location:** `src/Client/index.ts:499-506`

```typescript
declare namespace React {
  interface FC<P = {}> {
    (props: P): React.ReactElement | null
  }
  type ReactNode = any
  type ReactElement = any
}
```

**Problem:** Using `any` for React types defeats type safety.

---

## 6. Recommendations

### Priority 1 (Critical - Will Cause Runtime Errors)

1. **Fix AtomRuntime usage** - Review how `Atom.runtime()` should be used with custom layers
2. **Fix useMutation** - Use `useAtomSet` with `mode: "promise"` pattern
3. **Connect Provider to Registry** - Ensure atoms use the RegistryContext

### Priority 2 (High - Functional Gaps)

4. **Implement useStream properly** - Use `atomRuntime.pull` for stream accumulation
5. **Fix reactivity integration** - Don't duplicate Reactivity layer
6. **Implement SSR hydration** - Use effect-atom's Hydration module properly

### Priority 3 (Medium - Type Safety)

7. **Fix React type declarations** - Import from `@types/react`
8. **Fix AtomRuntime generic types** - Use service types, not Tag types

---

## 7. Evidence Summary

| File | Line | Issue | Severity |
|------|------|-------|----------|
| react.ts | 53 | Wrong AtomRuntime type params | CRITICAL |
| react.ts | 93 | Questionable Atom.runtime() usage | CRITICAL |
| react.ts | 188-189 | factory.withReactivity access | CRITICAL |
| react.ts | 272-335 | useMutation doesn't work | HIGH |
| react.ts | 406-436 | useStream incomplete | HIGH |
| react.ts | 88 | Duplicate Reactivity layer | MEDIUM |
| react.ts | 101-109 | Provider/Registry disconnect | HIGH |
| SSR/index.ts | 171-181 | Hydrate is a stub | MEDIUM |
| index.ts | 499-506 | any types for React | LOW |

---

## 8. Conclusion

The React integration has the right structure and imports `@effect-atom/atom-react` correctly, but the implementation has fundamental issues that will cause runtime failures. The hooks don't follow effect-atom's patterns, and there's a disconnect between the custom context (TrpcContext) and the atom registry (RegistryContext).

**Estimated effort to fix:** 2-3 days of focused refactoring, assuming familiarity with effect-atom patterns.
