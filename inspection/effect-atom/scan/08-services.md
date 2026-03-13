# H8: Effect Services Pattern Analysis

## Summary

Effect Atom uses **one core Context.Tag service** (`AtomRegistry`) and a sophisticated **Layer composition pattern** via `AtomRuntime`. This is a clean, modern Effect service pattern that we should follow.

## Service Definitions

### Primary Service: AtomRegistry

```typescript
// Registry.ts:74-77
export class AtomRegistry extends Context.Tag("@effect/atom/Registry/CurrentRegistry")<
  AtomRegistry,
  Registry
>() {}
```

Key characteristics:
- Uses Effect's `Context.Tag` class pattern (not `Context.Tag()` function)
- Service identifier: `"@effect/atom/Registry/CurrentRegistry"`
- The interface (`Registry`) is separate from the tag

### Registry Interface

```typescript
interface Registry {
  readonly [TypeId]: TypeId
  readonly getNodes: () => ReadonlyMap<Atom.Atom<any> | string, Node<any>>
  readonly get: <A>(atom: Atom.Atom<A>) => A
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void
  readonly refresh: <A>(atom: Atom.Atom<A>) => void
  readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void
  readonly setSerializable: (key: string, encoded: unknown) => void
  readonly modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [A, W]) => A
  readonly update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W) => void
  readonly subscribe: <A>(atom: Atom.Atom<A>, f: (_: A) => void, options?: {...}) => () => void
  readonly reset: () => void
  readonly dispose: () => void
}
```

## Layer Composition

### Basic Layer

```typescript
// Registry.ts:107
export const layer: Layer.Layer<AtomRegistry> = layerOptions()

// Registry.ts:83-101
export const layerOptions = (options?: {...}): Layer.Layer<AtomRegistry> =>
  Layer.scoped(
    AtomRegistry,
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const scheduler = yield* FiberRef.get(FiberRef.currentScheduler)
      const registry = internal.make({
        ...options,
        scheduleTask: options?.scheduleTask ?? ((f) => scheduler.scheduleTask(f, 0))
      })
      yield* Scope.addFinalizer(scope, Effect.sync(() => registry.dispose()))
      return registry
    })
  )
```

### AtomRuntime - Layer Factory Pattern

This is the most interesting pattern. `AtomRuntime` creates atoms that build Effect services:

```typescript
// Atom.ts:652-706
export const context: (options: {
  readonly memoMap: Layer.MemoMap
}) => RuntimeFactory = (options) => {
  let globalLayer: Layer.Layer<any, any, AtomRegistry> = Reactivity.layer
  
  function factory<E, R>(
    create: Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity> | 
            ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
  ): AtomRuntime<R, E> {
    const self = Object.create(RuntimeProto)
    // ...
    
    const layerAtom = keepAlive(
      typeof create === "function"
        ? readable((get) => Layer.provideMerge(create(get), globalLayer))
        : readable(() => Layer.provideMerge(create, globalLayer))
    )
    self.layer = layerAtom

    self.read = function read(get: Context) {
      const layer = get(layerAtom)
      const build = Effect.flatMap(
        Effect.flatMap(Effect.scope, (scope) => 
          Layer.buildWithMemoMap(layer, options.memoMap, scope)
        ),
        (context) => Effect.provide(Effect.runtime<R>(), context)
      )
      return effect(get, build, { uninterruptible: true })
    }

    return self
  }
  // ...
}
```

### Default Runtime (Global Singleton)

```typescript
// Atom.ts:712-724
export const defaultMemoMap: Layer.MemoMap = globalValue(
  "@effect-atom/atom/Atom/defaultMemoMap",
  () => Effect.runSync(Layer.makeMemoMap)
)

export const runtime: RuntimeFactory = globalValue(
  "@effect-atom/atom/Atom/defaultContext",
  () => context({ memoMap: defaultMemoMap })
)
```

## Effect Integration Patterns

### 1. Atoms Can Require Services

Atoms can declare Effect service dependencies:

```typescript
// Effect/Stream atoms can require AtomRegistry
Atom.make(Effect.Effect<A, E, Scope.Scope | AtomRegistry>)

// Runtime atoms can require additional services
const MyRuntime = Atom.runtime(MyLayer)  // Layer<MyService>
MyRuntime.atom(Effect.Effect<A, E, Scope.Scope | MyService | AtomRegistry>)
```

### 2. Service Context Threading

The registry is provided to atom computations:

```typescript
// Atom.ts:495-502
const contextMap = new Map(runtime.context.unsafeMap)
contextMap.set(Scope.Scope.key, scope)
contextMap.set(AtomRegistry.key, ctx.registry)
const scopedRuntime = Runtime.make({
  context: EffectContext.unsafeMake(contextMap),
  fiberRefs: runtime.fiberRefs,
  runtimeFlags: runtime.runtimeFlags
})
```

### 3. AtomRpc Integration

`AtomRpc` creates service tags that are also atoms:

```typescript
// AtomRpc.ts:104-138
export const Tag = <Self>() => <...>(id: Id, options: {...}) => {
  const self: AtomRpcClient<...> = Context.Tag(id)() as any

  self.layer = Layer.scoped(
    self,
    options.makeEffect ?? RpcClient.make(options.group, {...})
  ).pipe(Layer.provide(options.protocol))
  
  const runtimeFactory = options.runtime ?? Atom.runtime
  self.runtime = runtimeFactory(self.layer)
  // ...
}
```

## React Integration

### Context Provider Pattern

React uses its own context, not Effect Context:

```typescript
// RegistryContext.ts:22-25
export const RegistryContext = React.createContext<Registry.Registry>(
  Registry.make({
    scheduleTask,
    defaultIdleTTL: 400
  })
)
```

### Hooks Access Registry

```typescript
// Hooks.ts:91
export const useAtomValue = <A>(atom: Atom.Atom<A>): A => {
  const registry = React.useContext(RegistryContext)
  return useStore(registry, atom)
}
```

## Patterns We Should Follow

### 1. Context.Tag Class Pattern

```typescript
// Recommended: Class-based tag
export class TrpcClient extends Context.Tag("@effect-trpc/Client")<
  TrpcClient,
  TrpcClientImpl
>() {}

// Not: Function-based tag  
const TrpcClient = Context.Tag<TrpcClientImpl>("@effect-trpc/Client")
```

### 2. Separate Interface from Tag

```typescript
interface TrpcClientImpl {
  readonly query: <T>(...) => Effect.Effect<T, TrpcError>
  readonly mutation: <T>(...) => Effect.Effect<T, TrpcError>
}

export class TrpcClient extends Context.Tag("@effect-trpc/Client")<
  TrpcClient,
  TrpcClientImpl
>() {}
```

### 3. Layer.scoped for Resources

```typescript
export const layer = (config: TrpcConfig): Layer.Layer<TrpcClient> =>
  Layer.scoped(
    TrpcClient,
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const client = createClient(config)
      yield* Scope.addFinalizer(scope, Effect.sync(() => client.close()))
      return client
    })
  )
```

### 4. Runtime Factory for Service Atoms

```typescript
// Create runtime from layer
const clientRuntime = Atom.runtime(TrpcClient.layer(config))

// Create atoms that use the service
const userAtom = clientRuntime.atom(
  Effect.flatMap(TrpcClient, (client) => client.query("user.get"))
)
```

### 5. React Provider Structure

```typescript
// TrpcProvider.tsx
export const TrpcRegistryContext = React.createContext<Registry.Registry>(
  Registry.make({ scheduleTask, defaultIdleTTL: 400 })
)

export const TrpcProvider = ({ config, children }) => {
  const registry = React.useMemo(() => Registry.make({...}), [])
  return (
    <TrpcRegistryContext.Provider value={registry}>
      {children}
    </TrpcRegistryContext.Provider>
  )
}
```

## Key Insights

1. **Single core service** - AtomRegistry is the only Effect service needed for the core library
2. **Layer composition** - Additional services are composed via AtomRuntime and Layer.provideMerge
3. **MemoMap sharing** - Layers are memoized across atoms using a shared MemoMap
4. **React-Effect bridge** - React.Context holds the Registry, not Effect.Context
5. **Scoped resources** - Layers use Layer.scoped with finalizers for cleanup
6. **Global singletons** - Default runtime/memoMap use Effect's globalValue

## Recommended Service Structure for effect-trpc

```
@effect-trpc/core
  - TrpcClient (Context.Tag) - the Effect service
  - layer(config) - Layer.Layer<TrpcClient>

@effect-trpc/atom  
  - TrpcRuntime = Atom.runtime(TrpcClient.layer) - builds runtime from layer
  - query/mutation atoms via TrpcRuntime.atom/TrpcRuntime.fn

@effect-trpc/react
  - TrpcRegistryContext (React.Context)
  - TrpcProvider (uses Registry.make)
  - Hooks (useQuery, useMutation) access registry via useContext
```

This follows the exact same pattern as @effect-atom/atom + @effect-atom/atom-react.
