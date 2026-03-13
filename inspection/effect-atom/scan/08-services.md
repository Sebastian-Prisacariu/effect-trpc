# H8: Service Patterns in Effect Atom

## Overview

Effect Atom uses a sophisticated service pattern built on `Context.Tag` that integrates Effect services with the reactive Atom system. The core patterns are:

1. **AtomRegistry** - Global reactive store service
2. **AtomRuntime** - Service-scoped runtime for creating atoms
3. **Context.Tag extensions** - For AtomRpc, AtomHttpApi, etc.

## AtomRegistry Service

`Registry.ts:74-77`

```typescript
export class AtomRegistry extends Context.Tag("@effect/atom/Registry/CurrentRegistry")<
  AtomRegistry,
  Registry
>() {}
```

The AtomRegistry is a standard `Context.Tag` that provides the reactive store:

```typescript
interface Registry {
  readonly get: <A>(atom: Atom.Atom<A>) => A
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void
  readonly refresh: <A>(atom: Atom.Atom<A>) => void
  readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void
  readonly subscribe: <A>(atom: Atom.Atom<A>, f: (_: A) => void, options?: {
    readonly immediate?: boolean
  }) => () => void
  readonly dispose: () => void
}
```

## AtomRuntime Pattern

`Atom.ts:535-624`

**AtomRuntime is NOT a Context.Tag** - it's a specialized `Atom` that holds a `Runtime`:

```typescript
export interface AtomRuntime<R, ER = never> 
  extends Atom<Result.Result<Runtime.Runtime<R>, ER>> {
  
  readonly factory: RuntimeFactory
  readonly layer: Atom<Layer.Layer<R, ER>>
  
  // Methods for creating service-scoped atoms
  readonly atom: { ... }
  readonly fn: { ... }
  readonly pull: { ... }
  readonly subscriptionRef: { ... }
  readonly subscribable: { ... }
}
```

### Key Insight: AtomRuntime is an Atom

The `AtomRuntime<R, ER>` interface extends `Atom<Result.Result<Runtime.Runtime<R>, ER>>`:

- It **IS** an atom that holds the runtime result
- The runtime is built from a `Layer<R, ER>`
- It has methods to create atoms that use services from R

### Creating an AtomRuntime

```typescript
// Atom.ts:652-706
export const context: (options: {
  readonly memoMap: Layer.MemoMap
}) => RuntimeFactory = (options) => {
  let globalLayer: Layer.Layer<any, any, AtomRegistry> = Reactivity.layer
  
  function factory<E, R>(
    create: Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
           | ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
  ): AtomRuntime<R, E> {
    // Create AtomRuntime with RuntimeProto
    const self = Object.create(RuntimeProto)
    
    // Build layer atom
    const layerAtom = keepAlive(
      typeof create === "function"
        ? readable((get) => Layer.provideMerge(create(get), globalLayer))
        : readable(() => Layer.provideMerge(create, globalLayer))
    )
    self.layer = layerAtom
    
    // Read function builds runtime from layer
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
  
  factory.memoMap = options.memoMap
  factory.addGlobalLayer = (layer) => { ... }
  factory.withReactivity = (keys) => (atom) => { ... }
  
  return factory
}

// Default runtime factory
export const runtime: RuntimeFactory = globalValue(
  "@effect-atom/atom/Atom/defaultContext",
  () => context({ memoMap: defaultMemoMap })
)
```

## AtomRpc Tag Pattern

`AtomRpc.ts:32-41`

The `AtomRpcClient` extends `Context.Tag` and includes an AtomRuntime:

```typescript
export interface AtomRpcClient<Self, Id extends string, Rpcs extends Rpc.Any, E>
  extends Context.Tag<Self, RpcClient.RpcClient.Flat<Rpcs, RpcClientError>>
{
  new(_: never): Context.TagClassShape<Id, RpcClient.RpcClient.Flat<Rpcs, RpcClientError>>

  readonly layer: Layer.Layer<Self, E>
  readonly runtime: Atom.AtomRuntime<Self, E>  // <-- AtomRuntime for the service
  
  readonly mutation: ...
  readonly query: ...
}
```

### Creating AtomRpcClient

```typescript
// AtomRpc.ts:105-157
export const Tag = <Self>() =>
<Id extends string, Rpcs extends Rpc.Any, ER, RM>( 
  id: Id,
  options: {
    readonly group: RpcGroup.RpcGroup<Rpcs>
    readonly protocol: Layer.Layer<Exclude<RM, Scope>, ER>
    readonly runtime?: Atom.RuntimeFactory | undefined  // Can inject custom factory
  }
): AtomRpcClient<Self, Id, Rpcs, ER> => {
  
  // Create Context.Tag for the service
  const self: Mutable<AtomRpcClient<Self, Id, Rpcs, ER>> = Context.Tag(id)<
    Self,
    RpcClient.RpcClient.Flat<Rpcs, RpcClientError>
  >() as any

  // Build the layer
  self.layer = Layer.scoped(
    self,
    options.makeEffect ??
      RpcClient.make(options.group, { ...options, flatten: true })
  ).pipe(Layer.provide(options.protocol))
  
  // Create AtomRuntime from the layer
  const runtimeFactory = options.runtime ?? Atom.runtime
  self.runtime = runtimeFactory(self.layer)  // <-- KEY PATTERN
  
  // Wire up mutation/query using runtime
  self.mutation = Atom.family(<Tag extends Rpc.Tag<Rpcs>>(tag: Tag) =>
    self.runtime.fn<{ ... }>()( ... )  // Uses runtime.fn
  )
  
  self.query = ... // Uses runtime.atom, runtime.pull
  
  return self
}
```

## Type Errors in Our React Code

Looking at `src/Client/react.ts:53`, the issue is:

```typescript
// Our code
interface TrpcContextValue {
  readonly atomRuntime: Atom.AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
  readonly rootTag: string
}
```

**Problems:**

1. **Wrong generic parameter** - `AtomRuntime<R>` expects `R` to be the **service type**, not the Tag class:
   ```typescript
   // WRONG
   AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
   
   // CORRECT
   AtomRuntime<ClientServiceTag | Reactivity.Reactivity, never>
   // or better:
   AtomRuntime<ClientService | Reactivity.Reactivity>
   ```

2. **Using runtime() incorrectly** - `Atom.runtime()` is a RuntimeFactory, not a method that takes a layer:
   ```typescript
   // Our code (WRONG)
   const atomRuntime = Atom.runtime(fullLayer)  // runtime is a factory function
   
   // CORRECT - runtime IS a factory, but need to call it correctly
   const atomRuntime = Atom.runtime(fullLayer)  // This IS correct!
   // But the return type is AtomRuntime<R, E> where R is services in the layer
   ```

3. **Layer typing** - The layer provides services, not tags:
   ```typescript
   // In Atom.ts the factory signature is:
   function factory<E, R>(
     create: Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
   ): AtomRuntime<R, E>
   ```

## Correct Usage Pattern

From `AtomRpc.ts` and `AtomHttpApi.ts`:

```typescript
// 1. Define a service interface
interface ClientService {
  readonly send: (tag: string, payload: unknown) => Effect.Effect<unknown>
}

// 2. Create a Context.Tag for the service
class ClientServiceTag extends Context.Tag("@effect-trpc/ClientService")<
  ClientServiceTag,
  ClientService
>() {}

// 3. Create a Layer that provides the service
const ClientServiceLive: Layer.Layer<ClientServiceTag, never, Transport> = 
  Layer.effect(ClientServiceTag, Effect.gen(function* () {
    const transport = yield* Transport
    return { send: ... }
  }))

// 4. Create AtomRuntime from the layer
const atomRuntime = Atom.runtime(ClientServiceLive)
// Type: AtomRuntime<ClientServiceTag, never>

// 5. Use runtime to create atoms with service access
const myAtom = atomRuntime.atom(
  Effect.gen(function* () {
    const service = yield* ClientServiceTag  // Has access!
    return yield* service.send(...)
  })
)
```

## Runtime Methods

The `RuntimeProto` (`Atom.ts:196-280`) provides methods on AtomRuntime:

### atom()
```typescript
atom(this: AtomRuntime<any, any>, arg: any, options?: { readonly initialValue?: unknown }) {
  const read = makeRead(arg, options)
  return readable((get) => {
    const previous = get.self<Result.Result<any, any>>()
    const runtimeResult = get(this)  // Get the runtime
    if (runtimeResult._tag !== "Success") {
      return Result.replacePrevious(runtimeResult, previous)
    }
    return read(get, runtimeResult.value)  // Pass runtime to read
  })
}
```

### fn()
```typescript
fn(this: AtomRuntime<any, any>, arg: any, options?: { ... }) {
  if (arguments.length === 0) {
    return (arg: any, options?: {}) => makeFnRuntime(this, arg, options)
  }
  return makeFnRuntime(this, arg, options)
}
```

## Fixes for Our Implementation

### Issue 1: Type parameter
```typescript
// BEFORE
interface TrpcContextValue {
  readonly atomRuntime: Atom.AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
}

// AFTER - use service types, not tag classes, and add error parameter
interface TrpcContextValue<R = ClientServiceTag, E = never> {
  readonly atomRuntime: Atom.AtomRuntime<R, E>
  readonly rootTag: string
}
```

### Issue 2: Runtime creation
```typescript
// Current (mostly correct)
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.layer),
  Layer.provide(layer)
)
const atomRuntime = Atom.runtime(fullLayer)

// The type will be inferred from the layer:
// AtomRuntime<ClientServiceTag | Reactivity.Reactivity, TransportError>
```

### Issue 3: Using AtomRuntime methods
```typescript
// Make sure to use runtime methods, not create atoms directly
const queryAtom = ctx.atomRuntime.atom(queryEffect)  // Correct!
const mutationFn = ctx.atomRuntime.fn<Payload>()(mutationEffect)  // Correct!
```

## React Integration Pattern (from atom-react)

```typescript
// Hooks.ts - uses RegistryContext, not AtomRuntime
export const useAtomValue: {
  <A>(atom: Atom.Atom<A>): A
} = <A>(atom: Atom.Atom<A>): A => {
  const registry = React.useContext(RegistryContext)  // Gets Registry
  return useStore(registry, atom)  // Uses registry to read atom
}
```

**Key insight**: React hooks use `Registry` (from RegistryContext), not AtomRuntime directly. The AtomRuntime creates atoms, the Registry reads/subscribes to them.

## Summary: The Three Layers

1. **Context.Tag** (`AtomRegistry`, `ClientServiceTag`)
   - Standard Effect dependency injection tags
   - Provides services to Effects

2. **AtomRuntime** 
   - An Atom that holds `Result<Runtime<R>, E>`
   - Has methods to create atoms with access to services from R
   - Created from a Layer

3. **Registry**
   - The reactive store
   - Reads, writes, subscribes to atoms
   - Used in React via RegistryContext

## Recommended Pattern for effect-trpc

```typescript
// 1. Don't store AtomRuntime in React context - it's for creating atoms
// 2. Create atoms with runtime OUTSIDE of components (module scope)
// 3. Use RegistryContext in hooks to read atoms

// Module scope
const createQueryAtom = <P, S, E>(
  runtime: Atom.AtomRuntime<ClientServiceTag, never>,
  tag: string,
  payload: P
) => runtime.atom(
  Effect.gen(function* () {
    const service = yield* ClientServiceTag
    return yield* service.send(tag, payload)
  })
)

// Hook scope
function useQuery<P, S, E>(tag: string, payload: P) {
  const { atomRuntime } = useTrpcContext()
  
  // Create atom (should be memoized properly)
  const queryAtom = useMemo(() => 
    createQueryAtom(atomRuntime, tag, payload),
    [atomRuntime, tag, payload]
  )
  
  // Use registry to read
  return useAtomValue(queryAtom)
}
```
