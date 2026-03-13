# H19: tRPC Middleware Context Analysis

## Summary

tRPC middleware has **full access** to procedure type and path. This is a key insight for effect-trpc.

## Middleware Function Signature

From `middleware.ts:89-120`:

```typescript
export type MiddlewareFunction<
  TContext,
  TMeta,
  TContextOverridesIn,
  $ContextOverridesOut,
  TInputOut,
> = {
  (opts: {
    ctx: Simplify<Overwrite<TContext, TContextOverridesIn>>;
    type: ProcedureType;           // 'query' | 'mutation' | 'subscription'
    path: string;                   // Full procedure path (e.g., "user.getById")
    input: TInputOut;               // Parsed input (after previous middleware)
    getRawInput: GetRawInputFn;     // () => Promise<unknown>
    meta: TMeta | undefined;        // Procedure metadata
    signal: AbortSignal | undefined;// Request abort signal
    batchIndex: number;             // Index in batch request (0 for non-batch)
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
  _type?: string | undefined;  // Internal marker (e.g., 'input', 'output')
};
```

## Context Fields

| Field | Type | Description |
|-------|------|-------------|
| `ctx` | `TContext & TContextOverrides` | User context + middleware additions |
| `type` | `'query' \| 'mutation' \| 'subscription'` | Procedure type |
| `path` | `string` | Full dot-separated path (e.g., `"user.posts.list"`) |
| `input` | `TInputOut` | Parsed/validated input |
| `getRawInput` | `() => Promise<unknown>` | Raw input before parsing |
| `meta` | `TMeta \| undefined` | User-defined metadata |
| `signal` | `AbortSignal \| undefined` | Request cancellation |
| `batchIndex` | `number` | Position in batch (0 = first or non-batch) |
| `next` | function | Continue to next middleware |

## Procedure Types

From `procedure.ts:5-9`:

```typescript
export const procedureTypes = ['query', 'mutation', 'subscription'] as const;
export type ProcedureType = (typeof procedureTypes)[number];
```

## Middleware Invocation Chain

From `procedureBuilder.ts:634-672`:

```typescript
async function callRecursive(
  index: number,
  _def: AnyProcedureBuilderDef,
  opts: ProcedureCallOptions<any>,
): Promise<MiddlewareResult<any>> {
  try {
    const middleware = _def.middlewares[index]!;
    const result = await middleware({
      ...opts,              // includes path, type, ctx, signal, batchIndex
      meta: _def.meta,      // procedure-defined meta
      input: opts.input,
      next(_nextOpts?: any) {
        const nextOpts = _nextOpts as {
          ctx?: Record<string, unknown>;
          input?: unknown;
          getRawInput?: GetRawInputFn;
        } | undefined;

        return callRecursive(index + 1, _def, {
          ...opts,
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

## ProcedureCallOptions

From `procedureBuilder.ts:615-626`:

```typescript
export interface ProcedureCallOptions<TContext> {
  ctx: TContext;
  getRawInput: GetRawInputFn;
  input?: unknown;
  path: string;
  type: ProcedureType;
  signal: AbortSignal | undefined;
  batchIndex: number;
}
```

## How Path Gets Set

In `router.ts:473-481`, when calling a procedure:

```typescript
return await procedure({
  path: fullPath,           // Joined from proxy path segments
  getRawInput: async () => args[0],
  ctx,
  type: procedure._def.type,
  signal: opts?.signal,
  batchIndex: 0,
});
```

And in `resolveResponse.ts:374-381` for HTTP calls:

```typescript
const data: unknown = await proc({
  path: call.path,          // From request URL
  getRawInput: call.getRawInput,
  ctx: ctxManager.value(),
  type: proc._def.type,
  signal: combinedAbort.signal,
  batchIndex: call.batchIndex,
});
```

## Special Middleware Types

### Input Middleware

```typescript
export function createInputMiddleware<TInput>(parse: ParseFn<TInput>) {
  const inputMiddleware: AnyMiddlewareFunction = async function inputValidatorMiddleware(opts) {
    const rawInput = await opts.getRawInput();
    const parsedInput = await parse(rawInput);
    
    // Multiple input parsers combine objects
    const combinedInput = isObject(opts.input) && isObject(parsedInput)
      ? { ...opts.input, ...parsedInput }
      : parsedInput;

    return opts.next({ input: combinedInput });
  };
  inputMiddleware._type = 'input';
  return inputMiddleware;
}
```

### Output Middleware

```typescript
export function createOutputMiddleware<TOutput>(parse: ParseFn<TOutput>) {
  const outputMiddleware: AnyMiddlewareFunction = async function outputValidatorMiddleware({ next }) {
    const result = await next();
    if (!result.ok) return result;  // Pass through failures
    
    const data = await parse(result.data);
    return { ...result, data };
  };
  outputMiddleware._type = 'output';
  return outputMiddleware;
}
```

## Middleware Chaining

From `middleware.ts:127-161`:

```typescript
function createMiddlewareInner(middlewares: AnyMiddlewareFunction[]): AnyMiddlewareBuilder {
  return {
    _middlewares: middlewares,
    unstable_pipe(middlewareBuilderOrFn) {
      const pipedMiddleware = '_middlewares' in middlewareBuilderOrFn
        ? middlewareBuilderOrFn._middlewares
        : [middlewareBuilderOrFn];
      return createMiddlewareInner([...middlewares, ...pipedMiddleware]);
    },
  };
}
```

## Error Handler Context

From `procedure.ts:97-103`:

```typescript
export interface ErrorHandlerOptions<TContext> {
  error: TRPCError;
  type: ProcedureType | 'unknown';
  path: string | undefined;
  input: unknown;
  ctx: TContext | undefined;
}
```

## Key Insights for effect-trpc

1. **Path is available**: Middleware always has access to the full procedure path
2. **Type is available**: Procedure type (`query`/`mutation`/`subscription`) is always known
3. **Meta is available**: Custom metadata defined via `.meta()` is passed through
4. **Signal for cancellation**: AbortSignal enables proper cleanup
5. **Batch awareness**: `batchIndex` tells middleware which request in a batch

### What effect-trpc middleware should provide:

```typescript
interface EffectMiddlewareOpts<Ctx, Meta, Input> {
  ctx: Ctx
  type: 'query' | 'mutation' | 'subscription'
  path: string                      // Full procedure path
  input: Input                      // Parsed input
  getRawInput: Effect<unknown>      // Deferred raw input
  meta: Meta | undefined            // Procedure metadata
  signal: AbortSignal | undefined   // Request abort
  batchIndex: number                // Position in batch
  next: <NewCtx>(opts?: {
    ctx?: NewCtx
    input?: unknown
  }) => Effect<Result, Error, R>
}
```

This is complete parity with tRPC - we have everything we need.
