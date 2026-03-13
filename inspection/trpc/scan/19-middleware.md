# H19: Middleware Pattern Analysis

## tRPC Middleware Architecture

### Core Middleware Structure

tRPC middleware is defined in `middleware.ts` with a sophisticated type-safe pattern:

```typescript
// middleware.ts:89-120
export type MiddlewareFunction<
  TContext,
  TMeta,
  TContextOverridesIn,
  $ContextOverridesOut,
  TInputOut,
> = {
  (opts: {
    ctx: Simplify<Overwrite<TContext, TContextOverridesIn>>;
    type: ProcedureType;
    path: string;
    input: TInputOut;
    getRawInput: GetRawInputFn;
    meta: TMeta | undefined;
    signal: AbortSignal | undefined;
    batchIndex: number;
    next: {
      (): Promise<MiddlewareResult<TContextOverridesIn>>;
      <$ContextOverride>(opts: {
        ctx?: $ContextOverride;
        input?: unknown;
      }): Promise<MiddlewareResult<$ContextOverride>>;
      (opts: {
        getRawInput: GetRawInputFn;
      }): Promise<MiddlewareResult<TContextOverridesIn>>;
    };
  }): Promise<MiddlewareResult<$ContextOverridesOut>>;
  _type?: string | undefined;
};
```

### Middleware Options Available in tRPC

Every middleware receives these options:

| Option | Type | Purpose |
|--------|------|---------|
| `ctx` | `TContext` | Current context (accumulated from previous middleware) |
| `type` | `'query' \| 'mutation' \| 'subscription'` | Procedure type |
| `path` | `string` | Full procedure path (e.g., `"user.getById"`) |
| `input` | `TInputOut` | Parsed/validated input |
| `getRawInput` | `() => Promise<unknown>` | Raw input before validation |
| `meta` | `TMeta \| undefined` | Procedure metadata |
| `signal` | `AbortSignal \| undefined` | Request abort signal |
| `batchIndex` | `number` | Index in batch (for batched calls) |
| `next` | `NextFunction` | Call next middleware/resolver |

### The `next()` Function

The `next` function is overloaded to support multiple patterns:

```typescript
next: {
  // Simple call - just continue
  (): Promise<MiddlewareResult<TContextOverridesIn>>;
  
  // Extend context and/or modify input
  <$ContextOverride>(opts: {
    ctx?: $ContextOverride;
    input?: unknown;
  }): Promise<MiddlewareResult<$ContextOverride>>;
  
  // Replace getRawInput (for deferred parsing)
  (opts: {
    getRawInput: GetRawInputFn;
  }): Promise<MiddlewareResult<TContextOverridesIn>>;
}
```

### Context Propagation

tRPC uses **context overwriting** with type accumulation:

```typescript
// procedureBuilder.ts:634-672 - Recursive execution
async function callRecursive(
  index: number,
  _def: AnyProcedureBuilderDef,
  opts: ProcedureCallOptions<any>,
): Promise<MiddlewareResult<any>> {
  try {
    const middleware = _def.middlewares[index]!;
    const result = await middleware({
      ...opts,
      meta: _def.meta,
      input: opts.input,
      next(_nextOpts?: any) {
        const nextOpts = _nextOpts as { ctx?: Record<string, unknown>; input?: unknown; getRawInput?: GetRawInputFn } | undefined;

        return callRecursive(index + 1, _def, {
          ...opts,
          // Context merging: shallow merge of new context into existing
          ctx: nextOpts?.ctx ? { ...opts.ctx, ...nextOpts.ctx } : opts.ctx,
          input: nextOpts && 'input' in nextOpts ? nextOpts.input : opts.input,
          getRawInput: nextOpts?.getRawInput ?? opts.getRawInput,
        });
      },
    });
    return result;
  } catch (cause) {
    return {
      ok: false,
      error: getTRPCErrorFromUnknown(cause),
      marker: middlewareMarker,
    };
  }
}
```

### Middleware Marker Pattern

tRPC uses a compile-time marker to ensure middleware always returns via `next()`:

```typescript
// middleware.ts:7-11
export const middlewareMarker = 'middlewareMarker' as 'middlewareMarker' & {
  __brand: 'middlewareMarker';
};

interface MiddlewareResultBase {
  readonly marker: MiddlewareMarker;  // Forces returning through next()
}
```

### Built-in Input/Output Middleware

tRPC creates middleware for input/output validation:

```typescript
// middleware.ts:186-214 - Input validation as middleware
export function createInputMiddleware<TInput>(parse: ParseFn<TInput>) {
  const inputMiddleware: AnyMiddlewareFunction = async function inputValidatorMiddleware(opts) {
    let parsedInput: ReturnType<typeof parse>;
    const rawInput = await opts.getRawInput();
    try {
      parsedInput = await parse(rawInput);
    } catch (cause) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        cause,
      });
    }
    // Multiple input parsers: merge objects
    const combinedInput =
      isObject(opts.input) && isObject(parsedInput)
        ? { ...opts.input, ...parsedInput }
        : parsedInput;

    return opts.next({ input: combinedInput });
  };
  inputMiddleware._type = 'input';
  return inputMiddleware;
}

// middleware.ts:219-243 - Output validation as middleware
export function createOutputMiddleware<TOutput>(parse: ParseFn<TOutput>) {
  const outputMiddleware: AnyMiddlewareFunction = async function outputValidatorMiddleware({ next }) {
    const result = await next();
    if (!result.ok) {
      return result; // Pass through failures
    }
    try {
      const data = await parse(result.data);
      return { ...result, data };
    } catch (cause) {
      throw new TRPCError({
        message: 'Output validation failed',
        code: 'INTERNAL_SERVER_ERROR',
        cause,
      });
    }
  };
  outputMiddleware._type = 'output';
  return outputMiddleware;
}
```

### Middleware Builder Pattern

tRPC supports creating reusable middleware with `unstable_pipe`:

```typescript
// middleware.ts:43-84
export interface MiddlewareBuilder<TContext, TMeta, TContextOverrides, TInputOut> {
  unstable_pipe<$ContextOverridesOut>(
    fn:
      | MiddlewareFunction<TContext, TMeta, TContextOverrides, $ContextOverridesOut, TInputOut>
      | MiddlewareBuilder<Overwrite<TContext, TContextOverrides>, TMeta, $ContextOverridesOut, TInputOut>,
  ): MiddlewareBuilder<TContext, TMeta, Overwrite<TContextOverrides, $ContextOverridesOut>, TInputOut>;

  _middlewares: MiddlewareFunction<TContext, TMeta, TContextOverrides, object, TInputOut>[];
}
```

### Procedure Builder Integration

Middleware is applied via `.use()`:

```typescript
// procedureBuilder.ts:259-283
use<$ContextOverridesOut>(
  fn:
    | MiddlewareBuilder<Overwrite<TContext, TContextOverrides>, TMeta, $ContextOverridesOut, TInputOut>
    | MiddlewareFunction<TContext, TMeta, TContextOverrides, $ContextOverridesOut, TInputOut>,
): ProcedureBuilder<
  TContext, TMeta,
  Overwrite<TContextOverrides, $ContextOverridesOut>,  // Types accumulate!
  TInputIn, TInputOut,
  TOutputIn, TOutputOut,
  TCaller
>;
```

---

## Effect-tRPC Middleware Architecture

### Current Implementation

```typescript
// src/Middleware/index.ts

// Middleware provides a service
export interface MiddlewareTag<Self, Provides, Failure = never>
  extends Context.Tag<Self, MiddlewareImpl<Provides, Failure>> {
  readonly provides: Context.Tag<any, Provides>
}

export interface MiddlewareImpl<Provides, Failure> {
  readonly run: (request: MiddlewareRequest) => Effect.Effect<Provides, Failure>
}

// Or wraps execution
export interface WrapMiddlewareImpl<Failure> {
  readonly wrap: <A, E, R>(
    request: MiddlewareRequest,
    next: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
}
```

### Execution Model

```typescript
// src/Middleware/index.ts:346-365
const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware as any
    
    if ("wrap" in impl) {
      // Wrap middleware - wraps the handler execution
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      // Provides middleware - runs first, then provides service to handler
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure>).run(request)
      return yield* next.pipe(
        Effect.provideService(middleware.provides, provided)
      )
    }
  })
```

---

## Feature Comparison

### What tRPC Has That We're Missing

| Feature | tRPC | effect-trpc | Gap Analysis |
|---------|------|-------------|--------------|
| **Procedure Type** | `opts.type` available | Missing | Should have access to query/mutation |
| **Procedure Path** | `opts.path` available | `request.tag` (partial) | Need full dotted path |
| **getRawInput** | Lazy raw input access | Missing | Important for logging/auditing |
| **batchIndex** | Index in batch request | Missing | Needed for batch context |
| **AbortSignal** | `opts.signal` available | Missing | Should propagate for cancellation |
| **Meta access** | `opts.meta` available | Missing | Procedure metadata in middleware |
| **Input modification** | `next({ input })` | Not supported | Can't transform input in middleware |
| **Context accumulation** | `next({ ctx })` | Service provision | Different model - see below |
| **Standalone middleware** | `experimental_standaloneMiddleware` | Using Tags | Similar but different API |
| **Middleware piping** | `unstable_pipe` | `Middleware.all()` | Similar functionality |
| **concat()** | `procedure.concat()` | Not implemented | Composing procedure builders |

### Context Model Differences

**tRPC**: Mutable context accumulation
```typescript
// Context is an object that grows
const authedProcedure = publicProcedure.use((opts) => {
  if (!opts.ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return opts.next({
    ctx: { user: opts.ctx.user }  // Add to context
  })
})
```

**effect-trpc**: Service provision (Effect pattern)
```typescript
// Services are provided to the Effect environment
const AuthMiddlewareLive = Middleware.implement(AuthMiddleware, (request) =>
  Effect.gen(function* () {
    const token = request.headers.get("authorization")
    if (!token) return yield* Effect.fail(new UnauthorizedError({}))
    return yield* verifyToken(token)
  })
)
// Handler accesses via: yield* CurrentUser
```

### MiddlewareRequest - What We Have vs What We Need

**Current (effect-trpc)**:
```typescript
interface MiddlewareRequest {
  readonly id: string
  readonly tag: string      // Procedure name
  readonly headers: Headers
  readonly payload: unknown
}
```

**Should Add**:
```typescript
interface MiddlewareRequest {
  readonly id: string
  readonly path: string          // Full path: "user.getById"
  readonly type: ProcedureType   // "query" | "mutation" | "subscription"
  readonly headers: Headers
  readonly payload: unknown
  readonly getRawInput: () => Promise<unknown>
  readonly meta: unknown
  readonly signal: AbortSignal | undefined
  readonly batchIndex: number
}
```

---

## Missing Features Priority

### High Priority

1. **Procedure Type (`type`)** - Essential for middleware that behaves differently for mutations vs queries
2. **Full Path (`path`)** - Required for logging, metrics, and authorization by path
3. **Meta Access** - Critical for route-level configuration (roles, permissions, rate limits)
4. **AbortSignal** - Needed for proper cancellation propagation

### Medium Priority

5. **getRawInput** - Useful for audit logging before validation
6. **Input Modification** - Would enable middleware that transforms inputs
7. **batchIndex** - Important for batch-aware middleware

### Low Priority (Effect handles differently)

8. **Context Accumulation** - Effect's service provision is arguably better
9. **Middleware Piping** - `Middleware.all()` serves similar purpose

---

## Recommendations

### 1. Expand MiddlewareRequest

```typescript
interface MiddlewareRequest {
  readonly id: string
  readonly path: string
  readonly type: "query" | "mutation" | "subscription"
  readonly headers: Headers
  readonly rawPayload: unknown
  readonly input: unknown  // After validation (if available)
  readonly meta: unknown
  readonly signal: AbortSignal | undefined
  readonly batchIndex: number
}
```

### 2. Add getRawInput Pattern

```typescript
interface MiddlewareRequest {
  // ... other fields
  readonly getRawInput: Effect.Effect<unknown, never, never>
}
```

### 3. Support Input Transformation

Consider allowing wrap middleware to transform input:

```typescript
export interface WrapMiddlewareImpl<Failure> {
  readonly wrap: <A, E, R>(
    request: MiddlewareRequest,
    next: (transformedInput?: unknown) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
}
```

### 4. Add Procedure Type Guards

```typescript
// Allow middleware to be applied only to certain procedure types
const MutationOnly = Middleware.forType("mutation")(AuthMiddleware)
```

---

## Error Handling Comparison

### tRPC
```typescript
// Errors are caught and wrapped in MiddlewareResult
try {
  const result = await middleware({ ...opts, next });
  return result;
} catch (cause) {
  return {
    ok: false,
    error: getTRPCErrorFromUnknown(cause),
    marker: middlewareMarker,
  };
}
```

### effect-trpc
```typescript
// Errors flow through Effect's error channel
const executeOne = (...) =>
  Effect.gen(function* () {
    const impl = yield* middleware
    if ("wrap" in impl) {
      return yield* impl.wrap(request, next)  // Errors propagate naturally
    } else {
      const provided = yield* impl.run(request)  // Failures are typed
      return yield* next.pipe(Effect.provideService(middleware.provides, provided))
    }
  })
```

**Effect's approach is arguably better** - typed errors flow through the normal Effect error channel, no need for Result wrapper pattern.

---

## Summary

Effect-tRPC's middleware model uses Effect's native service provision which is more type-safe and composable than tRPC's mutable context pattern. However, we're missing several **runtime context values** that tRPC middleware has access to:

**Critical gaps:**
1. Procedure type (query/mutation/subscription)
2. Full procedure path
3. Meta/metadata access
4. AbortSignal propagation

These don't require changing the architectural model - they just need to be added to `MiddlewareRequest`.
