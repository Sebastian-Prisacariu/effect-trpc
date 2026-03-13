# H9: Invalidation Mechanism - withReactivity

## Overview

Effect Atom's `withReactivity` mechanism bridges the reactive atom system with Effect's `@effect/experimental/Reactivity` service. This enables atoms to automatically re-execute when external "reactivity keys" are invalidated (e.g., after a mutation modifies server data).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       @effect/experimental/Reactivity                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  handlers: Map<hash | string, Set<() => void>>                        │  │
│  │                                                                        │  │
│  │  unsafeRegister(keys, handler) → Adds handler to key sets             │  │
│  │  unsafeInvalidate(keys)        → Calls all handlers for those keys    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ unsafeRegister / invalidate
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          withReactivity(keys)(atom)                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  transform(atom, (get) => {                                            │  │
│  │    reactivity = get(reactivityAtom)    // Get Reactivity service       │  │
│  │    get.addFinalizer(                                                   │  │
│  │      reactivity.unsafeRegister(keys, () => get.refresh(atom))          │  │
│  │    )                                                                   │  │
│  │    get.subscribe(atom, value => get.setSelf(value))                    │  │
│  │    return get.once(atom)                                               │  │
│  │  })                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ refresh triggers invalidation
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Registry Invalidation Flow                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Registry.refresh(atom)                                                │  │
│  │    → atom.refresh ? atom.refresh(refresh) : invalidateAtom(atom)       │  │
│  │    → node.invalidate()                                                 │  │
│  │    → node.state = NodeState.stale                                      │  │
│  │    → disposeLifetime() + invalidateChildren()                          │  │
│  │    → Re-evaluate node.value() (triggers new Effect execution)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Source Code Analysis

### 1. Reactivity Service (`@effect/experimental/Reactivity`)

**Location:** `/packages/experimental/src/Reactivity.ts`

```typescript
export const make = Effect.sync(() => {
  const handlers = new Map<number | string, Set<() => void>>()

  // Invalidation: call all registered handlers for given keys
  const unsafeInvalidate = (
    keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>
  ): void => {
    if (Array.isArray(keys)) {
      for (let i = 0; i < keys.length; i++) {
        const set = handlers.get(stringOrHash(keys[i]))
        if (set === undefined) continue
        for (const run of set) run()  // Trigger all handlers
      }
    } else {
      // Record format: { tableName: [id1, id2, ...] }
      const record = keys as ReadonlyRecord<string, Array<unknown>>
      for (const key in record) {
        // Individual ID invalidation: "tableName:idHash"
        const hashes = idHashes(key, record[key])
        for (let i = 0; i < hashes.length; i++) {
          const set = handlers.get(hashes[i])
          if (set === undefined) continue
          for (const run of set) run()
        }
        // Table-level invalidation: "tableName"
        const set = handlers.get(key)
        if (set !== undefined) {
          for (const run of set) run()
        }
      }
    }
  }

  // Registration: add handler to be called on invalidation
  const unsafeRegister = (
    keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>,
    handler: () => void
  ): () => void => {
    const resolvedKeys = Array.isArray(keys) 
      ? keys.map(stringOrHash) 
      : recordHashes(keys)
    
    for (const key of resolvedKeys) {
      let set = handlers.get(key)
      if (set === undefined) {
        set = new Set()
        handlers.set(key, set)
      }
      set.add(handler)
    }
    
    // Return cleanup function
    return () => {
      for (const key of resolvedKeys) {
        const set = handlers.get(key)!
        set.delete(handler)
        if (set.size === 0) handlers.delete(key)
      }
    }
  }

  // Mutation: run effect then invalidate keys
  const mutation = <A, E, R>(
    keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> => Effect.zipLeft(effect, invalidate(keys))

  return Reactivity.of({ mutation, query, stream, unsafeInvalidate, invalidate, unsafeRegister })
})
```

**Key insight:** Reactivity uses a simple pub-sub pattern with hashed keys. Keys can be:
- Simple array: `["users", "posts"]`
- Record with IDs: `{ users: [userId1, userId2], posts: [postId] }`

### 2. withReactivity Implementation

**Location:** `Atom.ts:689-705`

```typescript
const reactivityAtom = removeTtl(make(
  Effect.scopeWith((scope) => 
    Layer.buildWithMemoMap(Reactivity.layer, options.memoMap, scope)
  ).pipe(
    Effect.map(EffectContext.get(Reactivity.Reactivity))
  )
))

factory.withReactivity =
  (keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>) =>
  <A extends Atom<any>>(atom: A): A =>
    transform(atom, (get) => {
      // 1. Get the Reactivity service
      const reactivity = Result.getOrThrow(get(reactivityAtom))
      
      // 2. Register refresh handler with cleanup via finalizer
      get.addFinalizer(reactivity.unsafeRegister(keys, () => {
        get.refresh(atom)  // When keys invalidated, refresh the atom
      }))
      
      // 3. Forward atom values to transformed atom
      get.subscribe(atom, (value) => get.setSelf(value))
      
      // 4. Return initial value
      return get.once(atom)
    }) as any as A
```

**Mechanism:**
1. Creates wrapper atom via `transform()`
2. On mount, registers with Reactivity service for given keys
3. When any key is invalidated, calls `get.refresh(atom)` 
4. Cleanup happens automatically via `addFinalizer`

### 3. Registry Invalidation

**Location:** `internal/registry.ts:97-103, 392-406`

```typescript
// Registry.refresh entry point
refresh = <A>(atom: Atom.Atom<A>): void => {
  if (atom.refresh !== undefined) {
    atom.refresh(this.refresh)  // Custom refresh handler
  } else {
    this.invalidateAtom(atom)   // Default: invalidate node
  }
}

invalidateAtom = <A>(atom: Atom.Atom<A>): void => {
  this.ensureNode(atom).invalidate()
}

// Node invalidation
invalidate(): void {
  if (this.state === NodeState.valid) {
    this.state = NodeState.stale
    this.disposeLifetime()  // Cleanup existing effects/subscriptions
  }

  if (batchState.phase === BatchPhase.collect) {
    batchState.stale.push(this)  // Defer in batch
  } else if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
    // Lazy: just mark stale, don't re-compute
    this.invalidateChildren()
    this.skipInvalidation = true
  } else {
    // Eager: immediately re-compute
    this.value()
  }
}

invalidateChildren(): void {
  if (this.children.length === 0) return
  
  const children = this.children
  this.children = []
  for (let i = 0; i < children.length; i++) {
    children[i].invalidate()
  }
}
```

**Node States:**
```typescript
const enum NodeState {
  uninitialized = NodeFlags.alive | NodeFlags.waitingForValue,
  stale = NodeFlags.alive | NodeFlags.initialized | NodeFlags.waitingForValue,
  valid = NodeFlags.alive | NodeFlags.initialized,
  removed = 0
}
```

### 4. Usage in AtomRpc

**Location:** `AtomRpc.ts:150-181`

```typescript
// Mutations: trigger invalidation after effect completes
const mutationFamily = Atom.family(({ ... }) =>
  self.runtime.fn(
    Effect.fn("mutation", function*(headers, payload, reactivityKeys) {
      const client = yield* self
      const effect = client(tag, payload, { headers } as any)
      return yield* reactivityKeys
        ? Reactivity.mutation(effect, reactivityKeys)  // Invalidate after mutation
        : effect
    })
  )
)

// Queries: wrap with withReactivity to auto-refresh
const queryFamily = Atom.family(({ ... }) => {
  let atom = RpcSchema.isStreamSchema(rpc.successSchema)
    ? self.runtime.pull(...)
    : self.runtime.atom(...)
  
  return reactivityKeys
    ? self.runtime.factory.withReactivity(reactivityKeys)(atom)
    : atom
})
```

## Invalidation Flow Example

```
Time →
───────────────────────────────────────────────────────────────────────────────

1. Create query atom with reactivity keys
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ const usersAtom = withReactivity(["users"])(                            │
   │   runtime.atom(Effect.flatMap(client, c => c.getUsers()))               │
   │ )                                                                       │
   └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
2. Atom mounted → registers with Reactivity
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ reactivity.unsafeRegister(["users"], () => get.refresh(usersAtom))     │
   │                                                                         │
   │ Reactivity.handlers = Map {                                             │
   │   "users" → Set { refreshHandler }                                      │
   │ }                                                                       │
   └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
3. User calls mutation
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ const createUser = client.mutation("createUser", {                      │
   │   payload: { name: "Alice" },                                           │
   │   reactivityKeys: ["users"]                                             │
   │ })                                                                      │
   │                                                                         │
   │ // Internally: Reactivity.mutation(effect, ["users"])                   │
   └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
4. Mutation completes → Reactivity.invalidate(["users"])
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ unsafeInvalidate(["users"])                                             │
   │   → handlers.get("users")   // Set { refreshHandler }                   │
   │   → refreshHandler()        // Calls get.refresh(usersAtom)             │
   └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
5. Atom refresh → Registry invalidation
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ registry.refresh(usersAtom)                                             │
   │   → node.invalidate()                                                   │
   │   → node.state = stale                                                  │
   │   → disposeLifetime() // Cancel previous effect, cleanup finalizers     │
   │   → node.value()      // Re-run atom read function                      │
   │   → Effect re-executes (fresh data from server)                         │
   └─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
6. Subscribers notified
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ node.setValue(newResult)                                                │
   │   → node.listeners.forEach(listener => listener())                      │
   │   → React components re-render with fresh data                          │
   └─────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Centralized Reactivity Service

All reactivity is managed through a single `Reactivity` service instance per runtime. This ensures:
- Consistent invalidation across all atoms
- Single source of truth for key→handler mappings
- Proper cleanup via finalizers

### 2. Transform-Based Wrapping

`withReactivity` uses `transform()` rather than modifying the atom directly:
- Original atom logic unchanged
- Wrapper handles subscription/forwarding
- Clean separation of concerns

### 3. Lazy vs Eager Invalidation

```typescript
if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
  this.invalidateChildren()
  this.skipInvalidation = true  // Don't recompute until needed
} else {
  this.value()  // Recompute immediately
}
```

- **Lazy atoms without listeners:** Just mark stale, defer computation
- **Active atoms:** Immediately recompute for fresh data

### 4. Batched Invalidation

Multiple invalidations in a batch are collected, then processed together:
```typescript
export function batch(f: () => void): void {
  batchState.phase = BatchPhase.collect
  try {
    f()
    // Process all stale nodes
    for (const node of batchState.stale) {
      batchRebuildNode(node)
    }
    // Notify all listeners
    batchState.phase = BatchPhase.commit
    for (const node of batchState.notify) {
      node.notify()
    }
  } finally {
    batchState.phase = BatchPhase.disabled
  }
}
```

## Relevance to effect-trpc

For effect-trpc's invalidation mechanism:

1. **Consider Effect's Reactivity Service**
   - Already provides the pub-sub mechanism
   - Handles key hashing and cleanup
   - Used by Effect Atom in production

2. **Key Format Options**
   - Simple: `["users", "posts"]`
   - Structured: `{ users: [id1, id2] }` for granular invalidation

3. **Integration Points**
   - Mutations should call `Reactivity.invalidate(keys)` on success
   - Queries should register via `unsafeRegister(keys, refreshFn)`

4. **Cleanup is Critical**
   - `unsafeRegister` returns cleanup function
   - Must be called when query unmounts
   - Effect Atom uses `addFinalizer` pattern

5. **Batching for Performance**
   - Multiple invalidations should be batched
   - Prevents cascade of re-renders
