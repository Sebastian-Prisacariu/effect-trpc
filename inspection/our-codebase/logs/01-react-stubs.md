# React Hooks and Provider Implementation Analysis

**Date:** March 13, 2026  
**Scope:** All React-related stubs, TODOs, and missing implementations in effect-trpc

---

## Executive Summary

The React integration in effect-trpc is **completely stubbed out**. While the API surface is designed and type signatures are in place, **zero functional React code exists**. The hooks throw errors when called, and the Provider component is a pass-through stub. The required dependency `@effect-atom/atom-react` is declared but **never imported or used**.

### Impact Assessment

| Component | Status | Impact |
|-----------|--------|--------|
| `api.Provider` | Stub - returns children unchanged | **CRITICAL** - No runtime context provided to components |
| `useQuery` | Throws "requires React" error | **CRITICAL** - Queries don't work in React |
| `useMutation` | Throws "requires React" error | **CRITICAL** - Mutations don't work in React |
| `useStream` | Throws "requires React" error | **CRITICAL** - Streams don't work in React |
| `@effect-atom/atom-react` integration | **Unused** | **CRITICAL** - No reactive state management |
| `Result.match` in components | Type-only reference | **HIGH** - No runtime binding |
| Query atoms | **Not implemented** | **HIGH** - No cache management |

---

## 1. React Hooks Stubs

### 1.1 `createUseQuery` (src/Client/index.ts:720-728)

```typescript
const createUseQuery = <P extends Procedure.Query<any, any, any>>(
  tag: string,
  procedure: P
): UseQueryFn<any, any, any> => {
  // TODO: Implement with actual React hooks
  return (() => {
    throw new Error("useQuery requires React. Use inside a component wrapped by <api.Provider>")
  }) as any
}
```

**What it claims to do (from types at lines 383-391):**
```typescript
export type UseQueryFn<Payload, Success, Error> = Payload extends void
  ? (options?: QueryOptions) => QueryResult<Success, Error>
  : (payload: Payload, options?: QueryOptions) => QueryResult<Success, Error>
```

**What it actually does:**
- Throws an error immediately when called
- No React hooks are invoked
- No state management
- No cache integration

**Missing implementation requirements:**
1. Create/access an Atom for the query data
2. Subscribe to the atom with `useAtomValue` from `@effect-atom/atom-react`
3. Trigger the Effect when enabled/payload changes
4. Handle loading/error/success states via `Result`
5. Integrate with Reactivity service for cache invalidation
6. Support `QueryOptions` (enabled, refetchInterval, staleTime)

---

### 1.2 `createUseMutation` (src/Client/index.ts:730-738)

```typescript
const createUseMutation = <P extends Procedure.Mutation<any, any, any, any>>(
  tag: string,
  procedure: P
): UseMutationFn<any, any, any> => {
  // TODO: Implement with actual React hooks
  return (() => {
    throw new Error("useMutation requires React. Use inside a component wrapped by <api.Provider>")
  }) as any
}
```

**What it claims to do (from types at lines 427-457):**
```typescript
export type UseMutationFn<Payload, Success, Error> = 
  (options?: MutationOptions<Success, Error>) => MutationResult<Payload, Success, Error>

export interface MutationResult<Payload, Success, Error> {
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly isLoading: boolean
  readonly isError: boolean
  readonly isSuccess: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly reset: () => void
}
```

**What it actually does:**
- Throws an error immediately
- No state management for mutation lifecycle

**Missing implementation requirements:**
1. Create local state atom for mutation status
2. Implement `mutate` that runs Effect and updates state
3. Implement `mutateAsync` that returns Promise
4. Handle optimistic updates from `procedure.optimistic` config
5. Call `Reactivity.invalidate()` on success with `procedure.invalidates` paths
6. Support `MutationOptions` callbacks (onSuccess, onError, onSettled)
7. Implement `reset` to clear mutation state

---

### 1.3 `createUseStream` (src/Client/index.ts:740-748)

```typescript
const createUseStream = <P extends Procedure.Stream<any, any, any>>(
  tag: string,
  procedure: P
): UseStreamFn<any, any, any> => {
  // TODO: Implement with actual React hooks
  return (() => {
    throw new Error("useStream requires React. Use inside a component wrapped by <api.Provider>")
  }) as any
}
```

**What it claims to do (from types at lines 465-491):**
```typescript
export interface StreamResult<Success, Error> {
  readonly data: readonly Success[]
  readonly latestValue: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
  readonly stop: () => void
  readonly restart: () => void
}
```

**What it actually does:**
- Throws an error immediately
- No stream subscription logic

**Missing implementation requirements:**
1. Create atom for accumulated stream data
2. Subscribe to the Effect Stream when component mounts
3. Accumulate chunks into `data` array
4. Track `latestValue` and connection status
5. Implement `stop()` to interrupt the fiber
6. Implement `restart()` to reconnect
7. Handle cleanup on unmount (important for fibers!)

---

## 2. Provider Component Stub

### Location: src/Client/index.ts:708-718

```typescript
const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  // This would be implemented with actual React
  // For now, return a stub
  return ({ layer, children }) => {
    // TODO: Create ManagedRuntime from layer
    // TODO: Provide via React context
    return children as any
  }
}
```

**What it claims to do (from types at lines 256-259):**
```typescript
export interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly children: React.ReactNode
}
```

**What it actually does:**
- Returns `children` unchanged
- Does NOT create a ManagedRuntime
- Does NOT set up React Context
- The `layer` prop is completely ignored

**Missing implementation requirements:**
1. Create a React Context for the client runtime
2. Use `ManagedRuntime.make(layer)` to create the runtime
3. Provide runtime via Context.Provider
4. Handle cleanup with `runtime.dispose()` on unmount
5. Potentially expose runtime via `useClient()` hook
6. Integrate Reactivity.ReactivityLive into the layer

---

## 3. TODOs Found

### 3.1 In src/Client/index.ts

| Line | TODO |
|------|------|
| 714 | `// TODO: Create ManagedRuntime from layer` |
| 715 | `// TODO: Provide via React context` |
| 724 | `// TODO: Implement with actual React hooks` (useQuery) |
| 734 | `// TODO: Implement with actual React hooks` (useMutation) |
| 744 | `// TODO: Implement with actual React hooks` (useStream) |

### 3.2 In src/Transport/index.ts

| Line | TODO |
|------|------|
| 361 | `// TODO: Implement proper SSE/streaming - for now just convert single response` |

---

## 4. Effect-Atom Integration Analysis

### 4.1 Package Dependencies (package.json:36-37, 52-53)

```json
{
  "peerDependencies": {
    "@effect-atom/atom": "^0.5.0",
    "@effect-atom/atom-react": "^0.5.0"
  },
  "devDependencies": {
    "@effect-atom/atom": "^0.5.0",
    "@effect-atom/atom-react": "^0.5.0"
  }
}
```

**Status:** Dependencies are declared but `@effect-atom/atom-react` is **never imported in any source file**.

### 4.2 Result Module Re-export (src/Result/index.ts)

```typescript
/**
 * Result - Query result states
 * 
 * Re-exports from @effect-atom/atom for consistency.
 */

export * from "@effect-atom/atom/Result"
```

**Status:** This works but is only used for **types**. No actual Result atoms are created.

### 4.3 QueryResult Type (src/Client/index.ts:411-419)

```typescript
export interface QueryResult<Success, Error> {
  readonly result: import("@effect-atom/atom/Result").Result<Success, Error>
  // ...
}
```

**Status:** Type-only reference. The hooks that would return this never create a `Result`.

### 4.4 Intended Usage (from examples/advanced/optimistic-atoms.md)

The documentation shows the intended pattern:

```typescript
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react"

function UserList() {
  const users = useAtomValue(optimisticUsersAtom)
  const addUser = useAtomSet(addUserOptimistic)
  // ...
}
```

**Status:** This pattern is documented but **no code implements it**.

### 4.5 Missing Atom Integration Points

1. **No atom creation** - Queries should create atoms for their cache
2. **No `useAtom`/`useAtomValue`** - Hooks don't use atom-react
3. **No optimistic atoms** - `Atom.optimistic` from documentation is unused
4. **No cache layer** - No shared atom store for queries

---

## 5. Test Evidence for Stubs

### Location: test/client.test.ts:256-276

```typescript
describe("Hook stubs", () => {
  const api = Client.make(appRouter)
  const mockLayer = Transport.mock({})
  const bound = api.provide(mockLayer)

  it("useQuery exists on query client", () => {
    // The stub throws when called outside React, but the method should exist
    expect(typeof bound.users.list.useQuery).toBe("function")
  })

  it("useMutation exists on mutation client", () => {
    expect(typeof bound.users.create.useMutation).toBe("function")
  })

  it("useQuery throws outside React", () => {
    expect(() => bound.users.list.useQuery()).toThrow(/React/)
  })

  it("useMutation throws outside React", () => {
    expect(() => bound.users.create.useMutation()).toThrow(/React/)
  })
})
```

**Observation:** Tests explicitly document that hooks are stubs that throw. This is intentional temporary behavior, not a bug.

---

## 6. What Would Be Needed to Implement React Hooks

### 6.1 Architecture Requirements

1. **React Context for Runtime**
   ```typescript
   const ClientContext = React.createContext<ManagedRuntime<...> | null>(null)
   ```

2. **Provider Implementation**
   ```typescript
   const Provider: React.FC<ProviderProps> = ({ layer, children }) => {
     const runtimeRef = React.useRef<ManagedRuntime<ClientServiceTag, never>>()
     
     React.useEffect(() => {
       const fullLayer = Layer.mergeAll(
         ClientServiceLive.pipe(Layer.provide(layer)),
         Reactivity.ReactivityLive
       )
       runtimeRef.current = ManagedRuntime.make(fullLayer)
       return () => runtimeRef.current?.dispose()
     }, [layer])
     
     return (
       <ClientContext.Provider value={runtimeRef.current}>
         {children}
       </ClientContext.Provider>
     )
   }
   ```

3. **useQuery Implementation Sketch**
   ```typescript
   const createUseQuery = (tag: string, procedure: Procedure.Query<...>) => {
     return (payload?: unknown, options?: QueryOptions) => {
       const runtime = React.useContext(ClientContext)
       const [result, setResult] = React.useState<Result<Success, Error>>(Result.initial())
       
       React.useEffect(() => {
         if (!options?.enabled === false) return
         
         setResult(Result.loading())
         
         const fiber = runtime.runFork(
           Effect.gen(function* () {
             const service = yield* ClientServiceTag
             return yield* service.send(tag, payload, ...)
           })
         )
         
         fiber.await().then(exit => {
           if (Exit.isSuccess(exit)) {
             setResult(Result.success(exit.value))
           } else {
             setResult(Result.failure(exit.cause))
           }
         })
         
         return () => fiber.interrupt()
       }, [payload, options?.enabled])
       
       // Subscribe to invalidation
       React.useEffect(() => {
         const reactivity = runtime.context.getOption(Reactivity.Reactivity)
         if (Option.isNone(reactivity)) return
         
         return reactivity.value.subscribe(tag, () => {
           // Trigger refetch
         })
       }, [tag])
       
       return {
         result,
         isLoading: Result.isLoading(result),
         isError: Result.isFailure(result),
         isSuccess: Result.isSuccess(result),
         data: Result.getOrUndefined(result),
         error: Result.getErrorOrUndefined(result),
         refetch: () => { /* trigger manual refetch */ },
       }
     }
   }
   ```

### 6.2 Integration with @effect-atom/atom-react

For proper integration with Effect Atom:

1. **Create query atoms per-query-key**
   ```typescript
   const queryAtom = Atom.of<Result<Success, Error>>(Result.initial())
   ```

2. **Use atom hooks in useQuery**
   ```typescript
   const [result, setResult] = useAtom(queryAtom)
   ```

3. **Enable optimistic updates**
   ```typescript
   const optimisticAtom = Atom.optimistic(queryAtom)
   ```

---

## 7. Recommendations

### Immediate Actions

1. **Document stub status prominently** - README should warn that React hooks are not implemented
2. **Add "React not implemented" issue** - Track this as a blocker for React adoption

### Implementation Priority

| Priority | Task | Complexity |
|----------|------|------------|
| P0 | Implement Provider with ManagedRuntime | Medium |
| P0 | Implement basic useQuery without caching | Medium |
| P1 | Implement useMutation with invalidation | Medium |
| P1 | Integrate @effect-atom/atom for caching | High |
| P2 | Implement useStream | Medium |
| P2 | Implement optimistic updates | High |
| P3 | Add staleTime/refetchInterval support | Medium |

### Alternative Approach

Consider whether the current approach is correct. Options:

1. **Keep custom hooks** - Implement all hooks from scratch
2. **Use TanStack Query adapter** - Wrap Effect in TanStack Query primitives
3. **Lean fully into Effect Atom** - Let users compose atoms manually (simpler but less ergonomic)

---

## 8. Files Analyzed

| File | Lines | Findings |
|------|-------|----------|
| src/Client/index.ts | 760 | Hook stubs, Provider stub, React types |
| src/Reactivity/index.ts | 305 | Working invalidation service (not React-specific) |
| src/Result/index.ts | 10 | Re-export only |
| test/client.test.ts | 291 | Tests document stub behavior |
| examples/desired-api.ts | 307 | Shows intended (non-working) React usage |
| examples/advanced/optimistic-atoms.md | 137 | Documents @effect-atom/atom-react usage |
| package.json | 69 | Declares but doesn't use @effect-atom/atom-react |

---

## Conclusion

The React integration in effect-trpc exists only as a **facade**. Types and API design are solid, but implementation is completely absent. Users attempting to use this in React will encounter runtime errors. The project's stated dependency on `@effect-atom/atom-react` is aspirational - the package is not actually used.

**Risk:** Documentation and examples show working React code that will fail at runtime. This creates a significant DX problem.
