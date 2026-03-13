# H8: Effect Services Pattern Analysis

## Overview

Effect Atom uses `Context.Tag` properly and follows idiomatic Effect patterns for service architecture. The library demonstrates sophisticated usage of Effect's dependency injection system while maintaining clean abstractions.

## Context.Tag Usage

### Core Service Tags

#### 1. AtomRegistry (Registry.ts:74-77)
```typescript
export class AtomRegistry extends Context.Tag("@effect/atom/Registry/CurrentRegistry")<
  AtomRegistry,
  Registry
>() {}
```

**Assessment:** ✅ **Proper Usage**
- Uses class-based Tag pattern (recommended for TypeScript)
- Clear identifier string following namespace convention
- Clean separation: `AtomRegistry` (tag) vs `Registry` (interface)

#### 2. Reactivity Service (from @effect/experimental)
```typescript
// Used via import from @effect/experimental
import * as Reactivity from "@effect/experimental/Reactivity"

// The Reactivity.Reactivity tag is defined in effect/experimental:
export class Reactivity extends Context.Tag("@effect/experimental/Reactivity")<
  Reactivity,
  Reactivity.Service
>() {}
```

**Assessment:** ✅ **Uses Existing Effect Service**
- Effect Atom doesn't reinvent reactivity; it imports from `@effect/experimental`
- This is the correct approach: reuse existing Effect ecosystem services

#### 3. AtomRpcClient (AtomRpc.ts:32-38)
```typescript
export interface AtomRpcClient<Self, Id extends string, Rpcs extends Rpc.Any, E>
  extends Context.Tag<Self, RpcClient.RpcClient.Flat<Rpcs, RpcClientError>>
{
  new(_: never): Context.TagClassShape<Id, RpcClient.RpcClient.Flat<Rpcs, RpcClientError>>
  readonly layer: Layer.Layer<Self, E>
  readonly runtime: Atom.AtomRuntime<Self, E>
  // ...
}

// Factory function at line 105-209:
export const Tag = <Self>() =>
<Id extends string, Rpcs extends Rpc.Any, ER, RM>(
  id: Id,
  options: { ... }
): AtomRpcClient<Self, Id, Rpcs, ER> => {
  const self: Mutable<AtomRpcClient<Self, Id, Rpcs, ER>> = Context.Tag(id)<
    Self,
    RpcClient.RpcClient.Flat<Rpcs, RpcClientError>
  >() as any
  // ...
}
```

**Assessment:** ✅ **Advanced Factory Pattern**
- Creates typed service tags dynamically
- Augments tags with `layer` and `runtime` properties
- Enables type-safe RPC client construction

#### 4. AtomHttpApiClient (AtomHttpApi.ts:32-37)
```typescript
export interface AtomHttpApiClient<Self, Id extends string, Groups, ApiE, E>
  extends Context.Tag<Self, Simplify<HttpApiClient.Client<Groups, ApiE, never>>>

// Similar factory pattern to AtomRpcClient
```

## Layer Patterns

### Registry Layer (Registry.ts:83-107)

```typescript
export const layerOptions = (options?: {
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]>
  readonly scheduleTask?: ((f: () => void) => void)
  readonly timeoutResolution?: number
  readonly defaultIdleTTL?: number
}): Layer.Layer<AtomRegistry> =>
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

export const layer: Layer.Layer<Registry.AtomRegistry> = layerOptions()
```

**Key Patterns:**
1. **`Layer.scoped`** - Proper resource management
2. **Scope finalization** - Registry disposal on scope close
3. **FiberRef integration** - Uses Effect's scheduler system
4. **Options pattern** - Configurable layer factory

### AtomRpc Layer (AtomRpc.ts:129-136)

```typescript
self.layer = Layer.scoped(
  self,
  options.makeEffect ??
    RpcClient.make(options.group, {
      ...options,
      flatten: true
    }) as Effect.Effect<RpcClient.RpcClient.Flat<Rpcs, RpcClientError>, never, RM>
).pipe(Layer.provide(options.protocol))
```

**Key Patterns:**
1. **Layer composition** via `Layer.provide`
2. **Protocol injection** - Protocol layer provides required dependencies
3. **Self-contained** - Each client tag has its own layer

### Runtime Factory (Atom.ts:652-705)

```typescript
export const context: (options: {
  readonly memoMap: Layer.MemoMap
}) => RuntimeFactory = (options) => {
  let globalLayer: Layer.Layer<any, any, AtomRegistry> = Reactivity.layer
  
  function factory<E, R>(
    create:
      | Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
      | ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
  ): AtomRuntime<R, E> {
    // ...
    self.read = function read(get: Context) {
      const layer = get(layerAtom)
      const build = Effect.flatMap(
        Effect.flatMap(Effect.scope, (scope) => 
          Layer.buildWithMemoMap(layer, options.memoMap, scope)),
        (context) => Effect.provide(Effect.runtime<R>(), context)
      )
      return effect(get, build, { uninterruptible: true })
    }
    return self
  }
  
  factory.memoMap = options.memoMap
  factory.addGlobalLayer = (layer) => {
    globalLayer = Layer.provideMerge(globalLayer, Layer.provide(layer, Reactivity.layer))
  }
  
  // Reactivity integration
  const reactivityAtom = make(
    Effect.scopeWith((scope) => 
      Layer.buildWithMemoMap(Reactivity.layer, options.memoMap, scope)).pipe(
      Effect.map(EffectContext.get(Reactivity.Reactivity))
    )
  )
  
  factory.withReactivity = (keys) => (atom) =>
    transform(atom, (get) => {
      const reactivity = Result.getOrThrow(get(reactivityAtom))
      get.addFinalizer(reactivity.unsafeRegister(keys, () => {
        get.refresh(atom)
      }))
      // ...
    })
  
  return factory
}
```

**Advanced Patterns:**
1. **MemoMap usage** - Shared layer memoization across atoms
2. **Global layer merging** - Dynamic layer composition
3. **Reactivity integration** - Atom refresh on invalidation
4. **Runtime building** - Creates Effect runtimes within atoms

## Service Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      User Application                        │
├─────────────────────────────────────────────────────────────┤
│  AtomRpcClient.Tag()    AtomHttpApiClient.Tag()             │
│       │                         │                            │
│       ▼                         ▼                            │
│  ┌─────────┐              ┌─────────┐                       │
│  │ .layer  │              │ .layer  │  (Self-contained)     │
│  └────┬────┘              └────┬────┘                       │
│       │                        │                             │
├───────┴────────────────────────┴─────────────────────────────┤
│                    AtomRuntime                               │
│   ┌──────────────────────────────────────────────────┐      │
│   │  .atom()  .fn()  .pull()  .subscriptionRef()     │      │
│   │  .withReactivity()                               │      │
│   └──────────────────────────────────────────────────┘      │
│                          │                                   │
│                          ▼                                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────────────┐       │
│  │   AtomRegistry   │◄───│  Reactivity.Reactivity   │       │
│  │  (Context.Tag)   │    │  (from @effect/exp)      │       │
│  └────────┬─────────┘    └──────────────────────────┘       │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                       │
│  │    Registry      │  (Implementation)                     │
│  │  - nodes Map     │                                       │
│  │  - subscribe()   │                                       │
│  │  - get/set/etc   │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

## Comparison: Effect Atom vs Our Approach

### What Effect Atom Does Well

| Pattern | Effect Atom | Our Potential Approach |
|---------|------------|------------------------|
| **Reactivity** | Uses `@effect/experimental/Reactivity` | Should also use this |
| **Layer Composition** | `Layer.provide`, `Layer.provideMerge` | Same |
| **Resource Management** | `Layer.scoped` + finalizers | Same |
| **Service Identity** | Class-based `Context.Tag` | Same |
| **MemoMap Sharing** | Global `defaultMemoMap` | Should adopt |

### Key Insight: Effect Atom Doesn't Create Its Own Reactivity

Effect Atom imports `Reactivity` from `@effect/experimental`:

```typescript
import * as Reactivity from "@effect/experimental/Reactivity"
```

The `Reactivity` service is an **existing Effect service** that provides:
- `mutation(keys, effect)` - Invalidate keys after effect completes
- `query(keys, effect)` - Re-run effect when keys invalidate
- `stream(keys, effect)` - Stream of values, re-emitting on invalidation
- `unsafeRegister(keys, handler)` - Register invalidation handlers

**Lesson for effect-trpc:** We should NOT create our own Reactivity service. Instead, we should:
1. Use `@effect/experimental/Reactivity` for cache invalidation
2. Integrate it similarly to how Effect Atom does

## Layer Pattern Summary

### 1. Scoped Layers with Finalizers
```typescript
Layer.scoped(Tag, Effect.gen(function*() {
  const scope = yield* Effect.scope
  const resource = createResource()
  yield* Scope.addFinalizer(scope, Effect.sync(() => resource.dispose()))
  return resource
}))
```

### 2. Layer Factories with Options
```typescript
export const layerOptions = (opts?: Options): Layer.Layer<Service> =>
  Layer.scoped(ServiceTag, make(opts))

export const layer: Layer.Layer<Service> = layerOptions()
```

### 3. Dynamic Tag Creation (for RPC/HTTP Clients)
```typescript
export const Tag = <Self>() => <Id extends string>(...) => {
  const self = Context.Tag(id)<Self, ServiceType>() as Mutable<EnhancedTag>
  self.layer = Layer.scoped(self, buildClient())
  return self
}
```

### 4. MemoMap for Layer Deduplication
```typescript
export const defaultMemoMap: Layer.MemoMap = globalValue(
  "@effect-atom/atom/Atom/defaultMemoMap",
  () => Effect.runSync(Layer.makeMemoMap)
)

// Use with Layer.buildWithMemoMap for shared layer instances
```

## Recommendations for effect-trpc

1. **DO NOT create a custom Reactivity service** - Use `@effect/experimental/Reactivity`

2. **Follow the Registry pattern** - Create a similar scoped registry for procedure caching

3. **Use RuntimeFactory pattern** - For creating typed client runtimes with proper layer integration

4. **Adopt MemoMap sharing** - Ensure layers are memoized across the application

5. **Layer composition via provide** - Protocol/transport as provided layers

## Conclusion

Effect Atom demonstrates **exemplary** usage of Effect's service patterns:
- Clean `Context.Tag` usage with class syntax
- Proper `Layer.scoped` resource management
- Smart reuse of `@effect/experimental/Reactivity` instead of reinventing
- Sophisticated runtime factory patterns for typed client creation

This validates that our effect-trpc implementation should:
1. Use existing Effect services where available
2. Follow the same Layer patterns for resource lifecycle
3. Create service tags with factory functions when dynamic typing is needed
