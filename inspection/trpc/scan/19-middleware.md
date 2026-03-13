# H19: tRPC Middleware Context

## Summary

tRPC middleware receives a comprehensive context object containing request metadata, procedure information, and the ability to pass modified context and input to downstream middleware via `next()`.

## Middleware Function Signature

```typescript
type MiddlewareFunction<
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

## Context Values Available to Middleware

| Property | Type | Description |
|----------|------|-------------|
| `ctx` | `TContext` (user-defined) | The context object, potentially modified by upstream middleware |
| `type` | `"query" \| "mutation" \| "subscription"` | The procedure type being called |
| `path` | `string` | The full procedure path (e.g., `"user.create"`) |
| `input` | `TInputOut` | Parsed input (after input validation middleware runs) |
| `getRawInput` | `() => Promise<unknown>` | Function to get the raw, unparsed input |
| `meta` | `TMeta \| undefined` | Procedure metadata defined via `.meta()` |
| `signal` | `AbortSignal \| undefined` | AbortSignal for request cancellation |
| `batchIndex` | `number` | Index of this call in a batch request (0 for non-batch) |
| `next` | Function | Calls the next middleware/resolver |

## The `next()` Function

The `next()` function is overloaded with three signatures:

### 1. Basic Call
```typescript
next(): Promise<MiddlewareResult<TContextOverridesIn>>
```
Continues to the next middleware without modifications.

### 2. Context/Input Override
```typescript
next<$ContextOverride>(opts: {
  ctx?: $ContextOverride;
  input?: unknown;
}): Promise<MiddlewareResult<$ContextOverride>>
```
Passes modified context or input to downstream middleware.

### 3. Raw Input Override
```typescript
next(opts: {
  getRawInput: GetRawInputFn;
}): Promise<MiddlewareResult<TContextOverridesIn>>
```
Overrides the raw input getter function.

## Middleware Result

```typescript
type MiddlewareResult<_TContextOverride> =
  | MiddlewareOKResult<_TContextOverride>
  | MiddlewareErrorResult<_TContextOverride>;

interface MiddlewareOKResult<_TContextOverride> {
  readonly marker: MiddlewareMarker;
  ok: true;
  data: unknown;
}

interface MiddlewareErrorResult<_TContextOverride> {
  readonly marker: MiddlewareMarker;
  ok: false;
  error: TRPCError;
}
```

## Built-in Middleware Types

### Input Validation Middleware
Created automatically when `.input()` is called:
```typescript
function createInputMiddleware<TInput>(parse: ParseFn<TInput>) {
  const inputMiddleware: AnyMiddlewareFunction = async function(opts) {
    const rawInput = await opts.getRawInput();
    const parsedInput = await parse(rawInput);
    
    // Merges with existing input if both are objects
    const combinedInput = isObject(opts.input) && isObject(parsedInput)
      ? { ...opts.input, ...parsedInput }
      : parsedInput;
    
    return opts.next({ input: combinedInput });
  };
  inputMiddleware._type = 'input';
  return inputMiddleware;
}
```

### Output Validation Middleware
Created automatically when `.output()` is called:
```typescript
function createOutputMiddleware<TOutput>(parse: ParseFn<TOutput>) {
  const outputMiddleware: AnyMiddlewareFunction = async function({ next }) {
    const result = await next();
    if (!result.ok) return result;
    
    const data = await parse(result.data);
    return { ...result, data };
  };
  outputMiddleware._type = 'output';
  return outputMiddleware;
}
```

## Resolver Context (Different from Middleware)

The final resolver receives a subset of the middleware context:

```typescript
interface ProcedureResolverOptions<TContext, _TMeta, TContextOverridesIn, TInputOut> {
  ctx: Simplify<Overwrite<TContext, TContextOverridesIn>>;
  input: TInputOut extends UnsetMarker ? undefined : TInputOut;
  signal: AbortSignal | undefined;
  path: string;
  batchIndex?: number;
}
```

**Notable differences:**
- No `type` (procedure type is known at definition time)
- No `meta` (available at definition time, not needed at runtime)
- No `getRawInput` (input is already parsed)
- No `next` (resolver is terminal)

## Context Creation Flow

1. **Initial Context**: Created via `createContext()` function passed to adapter
2. **Request Info Available**: `TRPCRequestInfo` is passed to `createContext`:
   ```typescript
   type ResolveHTTPRequestOptionsContextFn<TRouter> = (opts: {
     info: TRPCRequestInfo
   }) => Promise<inferRouterContext<TRouter>>;
   ```
3. **Middleware Chain**: Each middleware can extend context via `next({ ctx: {...} })`
4. **Resolver**: Receives final merged context

## TRPCRequestInfo (Available in createContext)

```typescript
interface TRPCRequestInfo {
  accept: 'application/jsonl' | null;
  type: ProcedureType | 'unknown';
  isBatchCall: boolean;
  calls: TRPCRequestInfoProcedureCall[];
  connectionParams: Dict<string> | null;
  signal: AbortSignal;
  url: URL | null;
}

interface TRPCRequestInfoProcedureCall {
  path: string;
  getRawInput: () => Promise<unknown>;
  result: () => unknown;
  procedure: AnyProcedure | null;
  batchIndex: number;
}
```

## Middleware Builder Pattern

```typescript
interface MiddlewareBuilder<TContext, TMeta, TContextOverrides, TInputOut> {
  _middlewares: MiddlewareFunction<...>[];
  
  unstable_pipe<$ContextOverridesOut>(
    fn: MiddlewareFunction<...> | MiddlewareBuilder<...>
  ): MiddlewareBuilder<...>;
}
```

Allows composing multiple middlewares:
```typescript
const withAuth = t.middleware(async ({ ctx, next }) => {
  const user = await getUser(ctx.session);
  return next({ ctx: { user } });
});

const withOrg = t.middleware(async ({ ctx, next }) => {
  const org = await getOrg(ctx.user);
  return next({ ctx: { org } });
});

// Compose middlewares
const protectedProcedure = t.procedure
  .use(withAuth)
  .use(withOrg);
```

## Implications for effect-trpc

1. **Effect Context mapping**: The `ctx` object should map to Effect's `Context.Context`
2. **Error handling**: `TRPCError` in middleware should map to Effect typed errors
3. **AbortSignal**: Should integrate with Effect's interruption system
4. **Middleware composition**: Effect's `Layer` composition is more powerful than tRPC's `unstable_pipe`
5. **Input/Output validation**: Effect Schema provides superior schema composition

## Source Files

- `packages/server/src/unstable-core-do-not-import/middleware.ts`
- `packages/server/src/unstable-core-do-not-import/procedureBuilder.ts`
- `packages/server/src/unstable-core-do-not-import/http/types.ts`
- `packages/server/src/unstable-core-do-not-import/http/resolveResponse.ts`
