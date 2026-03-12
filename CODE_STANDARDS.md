# Code Standards

Standards for effect-trpc, learned from the Effect codebase.

---

## 1. Module Structure

Every module follows this pattern:

```
src/ModuleName/
├── index.ts          # Public API only (re-exports from internal)
└── internal/
    ├── types.ts      # Internal type definitions
    ├── impl.ts       # Implementation
    └── errors.ts     # Error classes
```

**Reference:** [Effect RPC module structure](https://github.com/Effect-TS/effect/tree/main/packages/rpc/src)

---

## 2. JSDoc Standards

Every public export must have:

```typescript
/**
 * Brief description of what this does.
 *
 * @since 1.0.0
 * @category constructors | models | combinators | utilities | guards | errors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 *
 * const myQuery = Procedure.query({
 *   success: Schema.String,
 *   handler: () => Effect.succeed("hello")
 * })
 * ```
 */
export const query = ...
```

**Reference:** [Effect Schema JSDoc](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schema.ts#L1-L100)

---

## 3. Type Definitions

### Use `readonly` everywhere

```typescript
// ❌ Bad
interface Config {
  url: string
  options: { timeout: number }
}

// ✅ Good
interface Config {
  readonly url: string
  readonly options: {
    readonly timeout: number
  }
}
```

### Use branded types for IDs

```typescript
// ❌ Bad
type RequestId = string

// ✅ Good
type RequestId = string & Brand.Brand<"RequestId">
```

**Reference:** [Effect Brand](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Brand.ts)

### Variance annotations on type parameters

```typescript
// ✅ Correct variance
interface Reader<out A> {
  readonly read: () => A
}

interface Writer<in A> {
  readonly write: (a: A) => void
}

interface Transform<in A, out B> {
  readonly transform: (a: A) => B
}
```

**Reference:** [Effect Effect.ts variance](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts#L100-L150)

---

## 4. Effect Patterns

### Never mix async/await with Effect

```typescript
// ❌ Bad
const sendAndReceive = async (request) => {
  const result = await Effect.runPromise(someEffect)
  return result
}

// ✅ Good
const sendAndReceive = (request: Request) =>
  Effect.flatMap(Transport, (transport) =>
    transport.send(request).pipe(
      Stream.runHead,
      Effect.flatten
    )
  )
```

### Use `Effect.gen` for sequential operations

```typescript
// ✅ Good
const program = Effect.gen(function* () {
  const transport = yield* Transport
  const response = yield* transport.send(request)
  const decoded = yield* Schema.decodeUnknown(ResponseSchema)(response)
  return decoded
})
```

**Reference:** [Effect gen usage](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcClient.ts)

### Use `pipe` for transformations

```typescript
// ✅ Good
const result = someEffect.pipe(
  Effect.map(transform),
  Effect.flatMap(validate),
  Effect.catchTag("NotFound", handleNotFound)
)
```

### Layer composition

```typescript
// ✅ Good - explicit layer dependencies
const MyServiceLive: Layer.Layer<MyService, never, Dep1 | Dep2> = 
  Layer.effect(
    MyService,
    Effect.gen(function* () {
      const dep1 = yield* Dep1
      const dep2 = yield* Dep2
      return { /* implementation */ }
    })
  )
```

**Reference:** [Effect RPC layer composition](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcServer.ts#L50-L100)

---

## 5. Error Handling

### Use Schema.TaggedError for domain errors

```typescript
// ✅ Good
class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    entity: Schema.String,
    id: Schema.String,
  }
) {}
```

### Use Data.TaggedEnum for internal errors

```typescript
// ✅ Good
type TransportError = Data.TaggedEnum<{
  Network: { readonly cause: unknown }
  Timeout: { readonly duration: Duration.Duration }
  Protocol: { readonly message: string }
}>

const TransportError = Data.taggedEnum<TransportError>()
```

**Reference:** [Effect Data.TaggedEnum](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Data.ts)

---

## 6. Service Pattern

### Context.Tag for swappable services

```typescript
// ✅ Good
class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  {
    readonly send: (request: Request) => Stream.Stream<Response, TransportError>
  }
>() {}
```

### Effect.Service for singleton services with default impl

```typescript
// ✅ Good (when there's one obvious implementation)
class RequestIdGenerator extends Effect.Service<RequestIdGenerator>()(
  "@effect-trpc/RequestIdGenerator",
  {
    succeed: {
      next: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
  }
) {}
```

**Reference:** [Effect.Service](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts#L8000-L8100)

---

## 7. Dual API Pattern

Provide both data-first and data-last versions:

```typescript
import { dual } from "effect/Function"

export const map: {
  // Data-last (for pipe)
  <A, B>(f: (a: A) => B): (self: Result<A>) => Result<B>
  // Data-first (for direct calls)
  <A, B>(self: Result<A>, f: (a: A) => B): Result<B>
} = dual(
  2,
  <A, B>(self: Result<A>, f: (a: A) => B): Result<B> => {
    // implementation
  }
)
```

**Reference:** [Effect dual pattern](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Function.ts#L200-L250)

---

## 8. Testing

### Use `@effect/vitest` for Effect-aware tests

```typescript
import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"

describe("MyService", () => {
  it.effect("should do something", () =>
    Effect.gen(function* () {
      const result = yield* myService.doSomething()
      expect(result).toBe(expected)
    })
  )
})
```

### Type-level tests with `@effect/typecheck`

```typescript
// test/types.test.ts
import { typecheck } from "@effect/typecheck"

// This should compile
typecheck`
  import { Procedure } from "../src"
  
  const q = Procedure.query({
    success: Schema.String,
    handler: () => Effect.succeed("ok")
  })
`

// This should NOT compile
typecheck.fail`
  import { Procedure } from "../src"
  
  // Missing 'success' field
  const q = Procedure.query({
    handler: () => Effect.succeed("ok")
  })
`
```

**Reference:** [Effect typecheck tests](https://github.com/Effect-TS/effect/blob/main/packages/effect/test/Schema.test.ts)

---

## 9. Build & Package

### Dual package exports (CJS + ESM)

```json
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    },
    "./client": {
      "import": "./dist/esm/client.js",
      "require": "./dist/cjs/client.js"
    },
    "./server": {
      "import": "./dist/esm/server.js",
      "require": "./dist/cjs/server.js"
    }
  }
}
```

### Use `.js` extensions in imports

```typescript
// ✅ Good (works with ESM)
import { something } from "./internal/impl.js"

// ❌ Bad
import { something } from "./internal/impl"
```

**Reference:** [Effect package.json](https://github.com/Effect-TS/effect/blob/main/packages/effect/package.json)

---

## 10. File Naming

- `index.ts` - Public exports only
- `internal/*.ts` - Implementation details (not exported)
- `*.test.ts` - Tests (co-located or in test/)
- Use kebab-case for multi-word files: `http-transport.ts`

---

## Key Files to Study

| Pattern | File |
|---------|------|
| Module structure | [packages/rpc/src/](https://github.com/Effect-TS/effect/tree/main/packages/rpc/src) |
| Service definition | [RpcClient.ts](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcClient.ts) |
| Schema usage | [RpcSchema.ts](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcSchema.ts) |
| Layer composition | [RpcServer.ts](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcServer.ts) |
| Error handling | [RpcClientError.ts](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/RpcClientError.ts) |
| Test patterns | [packages/rpc/test/](https://github.com/Effect-TS/effect/tree/main/packages/rpc/test) |
| Build config | [packages/effect/package.json](https://github.com/Effect-TS/effect/blob/main/packages/effect/package.json) |
