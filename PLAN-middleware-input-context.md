# Plan: Middleware Input Requirements & Request Context

**Status**: Planned  
**Created**: 2026-02-26  
**Related**: FrontCore LMS pageParams system

## Background

FrontCore LMS had a "pageParams" system that sent route parameters (organizationSlug, courseSlug, etc.) via an `x-page-params` header. This enabled the server to calculate user permissions based on their current navigation context.

After analysis, we determined that **header-based context has caching problems** - queries would refetch when unrelated params changed. The solution is **input-based context** where each procedure explicitly declares what params it needs.

## Design Goals

1. **Correct caching** - Query keys based only on actual dependencies
2. **Type-safe** - Input requirements enforced at compile time
3. **Explicit** - See full procedure contract in definition
4. **Effect-idiomatic** - Use Layers, Tags, and standard Effect patterns
5. **Testable** - Easy to mock middleware with Layer substitution

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ DEFINITION PHASE (Types/Contract)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Middleware("name")                                             │
│    .input(Schema)        // What it reads from procedure input  │
│    .error(Err1, Err2)    // Errors it can produce               │
│    .provides<Context>()  // What it adds to handler context     │
│                                                                 │
│  Procedure                                                      │
│    .input(Schema)        // Procedure-specific input            │
│    .output(Schema)       // Success response                    │
│    .error(Err1, Err2)    // Procedure-specific errors           │
│    .mutation()           // or .query(), .stream(), etc.        │
│    .use(Middleware)      // Apply middleware (expands types)    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ IMPLEMENTATION PHASE (Layers)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Middleware.toLayer((ctx, input) => Effect<Context, Error, R>)  │
│  Procedure.toLayer((ctx, input) => Effect<Output, Error, R>)    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ HTTP BOUNDARY (R = never required)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  router.pipe(                                                   │
│    Router.provide(AppLive),  // Provide all layers              │
│    Router.toHttpHandler()    // Only works if R = never         │
│  )                                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## API Design

### 1. Middleware Definition

```typescript
// Middleware requires explicit tag (like Effect.fn pattern)
const OrgMiddleware = Middleware("OrgMiddleware")
  .input(Schema.Struct({ organizationSlug: Schema.String }))
  .error(NotAuthorized, NotOrgMember)  // Varargs, must extend Schema.TaggedError
  .provides<{ orgMembership: OrgMembership }>()
```

**Key points:**
- Tag required upfront: `Middleware("name")`
- `.error()` accepts varargs (internally unions them)
- `.error()` only accepts classes extending `Schema.TaggedError`
- `.provides<T>()` declares what context it adds

### 2. Procedure Definition

```typescript
// Procedures don't need explicit tags - inferred from structure
const updateFile = Procedure
  .input(Schema.Struct({
    fileId: FileId,
    name: Schema.String,
  }))
  .output(FileSchema)
  .error(FileNotFound)  // Single error, no union needed
  .mutation()
  .use(OrgMiddleware)   // Expands input/error types
```

**Key points:**
- No explicit tag (inferred from `Procedures.make` keys + router nesting)
- `.error()` varargs, must extend `Schema.TaggedError`
- `.use(middleware)` applies middleware, expanding types via **expansion pattern**

### 3. Type Expansion

When middleware is applied via `.use()`:

```typescript
// Original procedure
input: { fileId, name }
error: FileNotFound

// After .use(OrgMiddleware)
input: { fileId, name } & { organizationSlug }  // Intersection (merged)
error: FileNotFound | NotAuthorized | NotOrgMember  // Union (combined)
context: BaseContext & { orgMembership }  // Extended
```

### 4. Router & Procedures

**Tag Naming Convention**: `[domain].[action]` format enables powerful patterns like cache invalidation by domain, permission scoping, and logging/metrics grouping.

```typescript
// Procedures.make - no tag, just groups procedures
const MediaProcedures = Procedures.make({
  update: updateFile,   // Key: "update"
  delete: deleteFile,   // Key: "delete"
  list: listFiles,      // Key: "list"
})

// Router.make - tags inferred from structure
const router = Router.make({
  media: MediaProcedures,  // Full tags: "media.update", "media.delete", "media.list"
  users: UserProcedures,   // Full tags: "users.create", etc.
})

// Router R = OrgMiddleware | "media.update" | "media.delete" | ...
```

**Nesting**: `Router.make()` accepts both `Procedures` and nested `Router`:

```typescript
const router = Router.make({
  health: HealthProcedures,      // Procedures group
  media: mediaRouter,            // Nested router
  admin: Router.make({           // Inline nested router
    users: AdminUserProcedures,
    settings: AdminSettingsProcedures,
  }),
})
// Tags: "health.*", "media.*", "admin.users.*", "admin.settings.*"
```

**Combining Routers**: Use `Router.make()` with object spread (no separate merge function for v1):

```typescript
// Combine multiple routers
const fullRouter = Router.make({
  ...healthRouter.routes,
  ...mediaRouter.routes,
  ...usersRouter.routes,
})

// Or nest them for namespacing
const apiRouter = Router.make({
  v1: Router.make({
    health: HealthProcedures,
    media: MediaProcedures,
  }),
  v2: Router.make({
    health: HealthProceduresV2,
    media: MediaProceduresV2,
  }),
})
// Tags: "v1.health.*", "v1.media.*", "v2.health.*", "v2.media.*"
```

**Why `[domain].[action]` naming is valuable**:

```typescript
// Cache invalidation by domain
utils.invalidate('media')        // Invalidates all "media.*" queries
utils.invalidate('media.list')   // Invalidates specific query

// Logging/metrics grouping
// All "media.*" calls grouped in traces/dashboards

// Permission scoping (potential future feature)
if (!hasAccess(user, 'admin.*')) {
  // Deny access to entire admin domain
}
```

### 5. Middleware Implementation

```typescript
// No explicit `next` - return extended context or fail
const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
  Effect.gen(function* () {
    const membership = yield* OrgMembershipService.load(
      ctx.userId,
      input.organizationSlug
    )
    
    if (!membership) {
      // Direct yield of TaggedError (no Effect.fail needed)
      yield* new NotOrgMember({ organizationSlug: input.organizationSlug })
    }
    
    // Return FULL context (not just additions)
    return { ...ctx, orgMembership: membership }
  })
)
```

**Key points:**
- No `next` parameter - Effect composition handles sequencing
- Return full context: `{ ...ctx, newFields }`
- Errors yielded directly (TaggedError is yieldable)

### 6. Procedure Implementation

```typescript
const UpdateFileLive = updateFile.toLayer((ctx, input) =>
  Effect.gen(function* () {
    // ctx.orgMembership available from middleware
    const file = yield* FileRepository.findById(input.fileId)
    
    if (!file) {
      yield* new FileNotFound({ fileId: input.fileId })
    }
    
    return yield* FileRepository.update(input.fileId, { name: input.name })
  })
)
```

### 7. Layer Provision & HTTP Handler

```typescript
const AppLive = Layer.mergeAll(
  OrgMiddlewareLive,
  UpdateFileLive,
  DeleteFileLive,
  ListFilesLive,
)

// Option A (Effect-native): Pipe with Router.provide then Router.toHttpHandler
const handler = router.pipe(
  Router.provide(AppLive),   // R becomes never
  Router.toHttpHandler()     // Only works if R = never
)

// Type error if layers missing:
const broken = router.pipe(
  Router.provide(OrgMiddlewareLive),  // Missing procedure layers
  Router.toHttpHandler()              // ❌ Type error: R ≠ never
)
```

## Error Handling

### Error Definition

All errors must use `Schema.TaggedError`:

```typescript
// ✅ Correct
class NotAuthorized extends Schema.TaggedError<NotAuthorized>()(
  "NotAuthorized",
  { reason: Schema.String }
) {}

// ❌ Wrong - plain struct
const NotAuthorized = Schema.Struct({
  _tag: Schema.Literal("NotAuthorized"),
  reason: Schema.String,
})
```

### Error Yielding

TaggedError instances are directly yieldable:

```typescript
// ✅ Idiomatic - direct yield
yield* new NotAuthorized({ reason: "..." })

// ❌ Redundant - unnecessary wrapper
yield* Effect.fail(new NotAuthorized({ reason: "..." }))
```

### Error Contract Enforcement

Implementation must only use declared errors:

```typescript
const myProcedure = Procedure
  .error(NotFound, ValidationError)  // Contract
  .mutation()

const MyProcedureLive = myProcedure.toLayer((ctx, input) =>
  Effect.gen(function* () {
    yield* new NotFound()       // ✅ Allowed
    yield* new ValidationError() // ✅ Allowed
    yield* new OtherError()     // ❌ TypeScript error - not in contract
  })
)
```

## Middleware Composition

Multiple middlewares stack, with context flowing through:

```typescript
const AuthMiddleware = Middleware("Auth")
  .error(Unauthenticated)
  .provides<{ session: Session }>()

const OrgMiddleware = Middleware("Org")
  .input(Schema.Struct({ organizationSlug: Schema.String }))
  .error(NotOrgMember)
  .provides<{ orgMembership: OrgMembership }>()

// Procedure uses both
const updateFile = Procedure
  .input(...)
  .mutation()
  .use(AuthMiddleware)  // First: adds session
  .use(OrgMiddleware)   // Second: reads session, adds orgMembership

// Final context: { session, orgMembership }
// Final error: ... | Unauthenticated | NotOrgMember
```

Implementation receives accumulated context:

```typescript
const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
  Effect.gen(function* () {
    // ctx.session available from AuthMiddleware
    const membership = yield* loadMembership(ctx.session.userId, input.organizationSlug)
    return { ...ctx, orgMembership: membership }
  })
)
```

## Testing

Easy to mock with Layer substitution:

```typescript
// Production
const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
  Effect.gen(function* () {
    const membership = yield* OrgMembershipService.load(...)
    return { ...ctx, orgMembership: membership }
  })
)

// Test mock
const OrgMiddlewareMock = OrgMiddleware.toLayer((ctx, _input) =>
  Effect.succeed({
    ...ctx,
    orgMembership: { role: "Admin", organizationId: "test-org" }
  })
)

// In tests
const testHandler = router.pipe(
  Router.provide(Layer.mergeAll(
    OrgMiddlewareMock,  // Use mock
    UpdateFileLive,
  )),
  Router.toHttpHandler()
)
```

## Implementation Tasks

### Breaking Changes (No Backward Compatibility)

Until effect-trpc reaches stability, we do NOT maintain backward compatibility. All previous patterns that don't align with this plan must be removed:

1. **Remove old middleware patterns**:
   - Any `(ctx, input, next)` patterns with explicit `next`
   - Any middleware that doesn't use `.toLayer()`
   - Any middleware without explicit tag via `Middleware("name")`

2. **Remove old procedure patterns**:
   - Any procedures with explicit tags (tags should be inferred from Router)
   - Any procedures not using the builder pattern

3. **Remove old router patterns**:
   - Any `Router.merge()` function (use `Router.make()` with spread instead)
   - Any patterns that don't use `Router.provide()` before `Router.toHttpHandler()`

4. **Update decision documents**:
   - Review all `docs/DECISION-*.md` files
   - Remove or update anything that conflicts with this plan
   - This plan supersedes all previous decisions on middleware/context

### Documentation Updates

After implementation is complete:

1. **Update README.md** with:
   - New middleware API (`Middleware("name").input().error().provides()`)
   - New procedure API (builder pattern, no explicit tags)
   - Router composition patterns
   - Error handling examples with `Schema.TaggedError`
   - Layer provision pattern (`Router.provide()` → `Router.toHttpHandler()`)
   - Migration guide from old patterns

2. **Remove outdated examples** from README that show old patterns

3. **Add API reference** for:
   - `Middleware()` builder
   - `Procedure` builder  
   - `Procedures.make()`
   - `Router.make()`
   - `Router.provide()`
   - `Router.toHttpHandler()`

### Error Propagation Verification

Ensure errors flow correctly through the entire chain:

```typescript
// 1. Middleware errors must propagate to procedure error type
const OrgMiddleware = Middleware("Org")
  .error(NotAuthorized, NotOrgMember)  // These errors...

const updateFile = Procedure
  .error(FileNotFound)
  .mutation()
  .use(OrgMiddleware)
// Final error: FileNotFound | NotAuthorized | NotOrgMember  ✅

// 2. Implementation errors must match declared errors
const UpdateFileLive = updateFile.toLayer((ctx, input) =>
  Effect.gen(function* () {
    yield* new FileNotFound()     // ✅ Declared
    yield* new NotAuthorized()    // ✅ From middleware
    yield* new OtherError()       // ❌ Must be TypeScript error!
  })
)

// 3. Client must receive typed errors
const { error } = effectApi.procedures.media.update.useMutation()
// error type: FileNotFound | NotAuthorized | NotOrgMember | RpcError

// 4. Error.catchTag must work
Effect.gen(function* () {
  yield* client.procedures.media.update({ ... })
}).pipe(
  Effect.catchTag("FileNotFound", (e) => ...),      // ✅ Typed
  Effect.catchTag("NotAuthorized", (e) => ...),     // ✅ Typed
  Effect.catchTag("NotOrgMember", (e) => ...),      // ✅ Typed
)
```

**Type-level enforcement**:
- Procedure handler return type: `Effect<Output, DeclaredErrors, R>`
- Middleware handler return type: `Effect<ExtendedContext, DeclaredErrors, R>`
- Any error not in the declared set = TypeScript compile error

**Runtime enforcement**:
- Schema validation on error serialization
- Unknown errors become defects (not typed errors)

## Migration from pageParams

For FrontCore LMS:

### Before (Header-based)
```typescript
// Client: Send all params in header
const context = { organizationSlug, courseSlug, lessonId }
// Header: x-page-params: JSON.stringify(context)

// Server: Extract from header, calculate all permissions
const permissions = calculatePermissions(pageParams, userId)
```

### After (Input-based)
```typescript
// Client: Include only what procedure needs
effectApi.procedures.media.list.useQuery({
  organizationSlug,  // Required by OrgMiddleware
  folderId,          // Procedure-specific
})

// Server: Middleware reads from input, calculates relevant permissions
const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
  Effect.gen(function* () {
    const membership = yield* loadMembership(ctx.userId, input.organizationSlug)
    return { ...ctx, orgMembership: membership }
  })
)
```

### Benefits
1. **Correct caching** - Only relevant params in query key
2. **No over-fetching** - Changing lessonId doesn't refetch org-level queries
3. **Explicit** - See what each procedure needs
4. **Type-safe** - Missing params = TypeScript error

## Future Considerations

### Scoped Client Pattern (v2)
Auto-include common params:
```typescript
const orgClient = effectApi.scoped(() => {
  const { organizationSlug } = useParams()
  return { organizationSlug }
})

// Auto-includes organizationSlug
orgClient.procedures.media.list.useQuery({ folderId })
```

### Router Utilities (v2)

**Router.mergeDeep** - Deep merge with conflict resolution:
```typescript
const routerA = Router.make({ users: UserProcsA })
const routerB = Router.make({ users: UserProcsB })

// Deep merge - combines procedures from same domain
const merged = Router.mergeDeep(routerA, routerB)
// users = merged(UserProcsA, UserProcsB)

// With conflict handling
const merged = Router.mergeDeep(routerA, routerB, {
  onConflict: 'error' | 'overwrite' | 'skip'
})
```

**Procedures.prefix** - Add prefix to procedure tags:
```typescript
const prefixed = Procedures.prefix('v2', MediaProcedures)
// "list" → "v2.list", "update" → "v2.update"
```

**Router.prefix** - Add prefix to all router tags:
```typescript
const prefixed = Router.prefix('admin', adminRouter)
// "users.list" → "admin.users.list"
```

### Wrap Middleware (v2)
For before/after logic:
```typescript
const LoggingMiddleware = Middleware("Logging")
  .wrap()  // Enables before/after

const LoggingMiddlewareLive = LoggingMiddleware.toLayer((ctx, input, proceed) =>
  Effect.gen(function* () {
    const start = Date.now()
    const result = yield* proceed(ctx)
    console.log(`Took ${Date.now() - start}ms`)
    return result
  })
)
```

### ESLint Rule
Ensure all errors extend `Schema.TaggedError`:
```typescript
// eslint-plugin-effect-trpc
// Rule: require-tagged-error
```

## Summary

| Aspect | Decision |
|--------|----------|
| Context delivery | Input-based (not headers) |
| Type expansion | Expansion for both input and error |
| Middleware tag | Required upfront: `Middleware("name")` |
| Procedure tag | Inferred from router structure (no explicit tag) |
| Procedures.make | `Procedures.make({...})` - no tag, groups procedures |
| Router.make | `Router.make({...})` - accepts Procedures or nested Routers |
| Tag format | `[domain].[action]` - e.g., "media.update", "admin.users.list" |
| Router combining | Use `Router.make()` with spread for v1; `Router.mergeDeep()` in v2 |
| Error varargs | `.error(Err1, Err2)` - no Schema.Union needed |
| Error types | Must extend `Schema.TaggedError` |
| Middleware pattern | `(ctx, input)` - no explicit `next` |
| Context return | Full context: `{ ...ctx, additions }` |
| Implementation | `.toLayer()` - creates Layer for DI |
| Layer provision | Before handler: `Router.provide()` then `Router.toHttpHandler()` |
| R enforcement | `toHttpHandler()` requires `R = never` |
