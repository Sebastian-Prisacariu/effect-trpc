# End-to-End Test Plan

## Overview

These tests validate the complete Client ↔ Server roundtrip without actual HTTP. We use a "loopback" transport that connects Client directly to Server.

```
┌─────────┐    ┌───────────────────┐    ┌─────────┐
│ Client  │ → │ Loopback Transport │ → │ Server  │
│         │ ← │                    │ ← │         │
└─────────┘    └───────────────────┘    └─────────┘
```

---

## 1. Test Infrastructure

### 1.1 Loopback Transport

A Transport implementation that calls Server.handle() directly:

```typescript
// Transport.loopback(server) → Layer<Transport>
const loopbackTransport = <D extends Router.Definition, R>(
  server: Server.Server<D, R>
): Layer.Layer<Transport.Transport, never, R> =>
  Layer.succeed(Transport.Transport, {
    send: (request) => server.handle(request),
    sendStream: (request) => server.handleStream(request),
  })
```

**Why:** Removes HTTP from the equation. Tests the protocol, not networking.

**Alternative considered:** Mock Transport with hardcoded responses. Rejected because it doesn't test actual Server handlers.

---

### 1.2 Test Fixtures

**Schemas:**
```typescript
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
}) {}
```

**Errors:**
```typescript
class NotFoundError extends Schema.TaggedError<NotFoundError>("NotFoundError")({
  entity: Schema.String,
  id: Schema.String,
}) {}

class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")({
  message: Schema.String,
}) {}
```

**Procedures:**
```typescript
const listUsers = Procedure.query({ success: Schema.Array(User) })
const getUser = Procedure.query({ 
  payload: Schema.Struct({ id: Schema.String }), 
  success: User, 
  error: NotFoundError 
})
const createUser = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  error: ValidationError,
  invalidates: ["users"],
})
const watchUsers = Procedure.stream({ success: User })
```

**Router:**
```typescript
const testRouter = Router.make("@test", {
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
    watch: watchUsers,
  },
})
```

**Handlers (with controllable behavior):**
```typescript
// In-memory store for tests
const users = new Map<string, User>([
  ["1", new User({ id: "1", name: "Alice" })],
  ["2", new User({ id: "2", name: "Bob" })],
])

const handlers = {
  users: {
    list: () => Effect.succeed([...users.values()]),
    get: ({ id }) => {
      const user = users.get(id)
      return user 
        ? Effect.succeed(user)
        : Effect.fail(new NotFoundError({ entity: "User", id }))
    },
    create: (input) => {
      const user = new User({ id: `${Date.now()}`, name: input.name })
      users.set(user.id, user)
      return Effect.succeed(user)
    },
    watch: () => Stream.fromIterable([...users.values()]),
  },
}
```

---

## 2. Test Categories

### 2.1 Query Tests (`query.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Query with no payload | `api.users.list.runPromise()` | Returns array of users |
| Query with payload | `api.users.get.runPromise({ id: "1" })` | Returns User with id "1" |
| Query returns success schema | Response decoded as `User` | Type is `User`, not `unknown` |
| Query with void payload | Payload omitted | Works, no error |

```typescript
describe("Query", () => {
  it("returns decoded success", async () => {
    const users = await api.users.list.runPromise()
    
    expect(users).toHaveLength(2)
    expect(users[0]).toBeInstanceOf(User)
    expect(users[0].name).toBe("Alice")
  })
  
  it("accepts payload and returns result", async () => {
    const user = await api.users.get.runPromise({ id: "1" })
    
    expect(user.id).toBe("1")
    expect(user.name).toBe("Alice")
  })
})
```

---

### 2.2 Query Error Tests (`query-errors.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Query returns typed error | `get({ id: "not-found" })` | Fails with `NotFoundError` |
| Error is decoded | Error matches schema | `error.entity === "User"` |
| Invalid payload rejected | Wrong payload shape | Fails with decode error |
| Unknown procedure | Non-existent tag | Fails with "Unknown procedure" |

```typescript
describe("Query Errors", () => {
  it("returns typed error on failure", async () => {
    const result = await Effect.either(api.users.get.run({ id: "not-found" }))
    
    expect(result._tag).toBe("Left")
    expect(result.left).toBeInstanceOf(NotFoundError)
    expect(result.left.entity).toBe("User")
    expect(result.left.id).toBe("not-found")
  })
  
  it("rejects invalid payload", async () => {
    // @ts-expect-error - intentionally wrong type
    const result = await Effect.either(api.users.get.run({ wrong: "field" }))
    
    expect(result._tag).toBe("Left")
    // Should be a decode/validation error
  })
})
```

---

### 2.3 Mutation Tests (`mutation.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Mutation succeeds | `create({ name: "Charlie" })` | Returns new User |
| Mutation returns typed success | Response is `User` | `user.name === "Charlie"` |
| Mutation error | Validation fails | Returns `ValidationError` |
| Mutation side effect | Creates user in store | User exists after mutation |

```typescript
describe("Mutation", () => {
  it("creates and returns user", async () => {
    const user = await api.users.create.runPromise(
      new CreateUserInput({ name: "Charlie" })
    )
    
    expect(user).toBeInstanceOf(User)
    expect(user.name).toBe("Charlie")
  })
  
  it("persists the mutation", async () => {
    const created = await api.users.create.runPromise(
      new CreateUserInput({ name: "David" })
    )
    
    const fetched = await api.users.get.runPromise({ id: created.id })
    expect(fetched.name).toBe("David")
  })
})
```

---

### 2.4 Invalidation Tests (`invalidation.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Mutation triggers invalidation | After create, "users" invalidated | Invalidation callback called |
| Hierarchical invalidation | Invalidate "users" | Includes "users.list", "users.get" |
| Manual invalidation | `api.invalidate(["users"])` | Correct tags invalidated |

```typescript
describe("Invalidation", () => {
  it("mutation triggers invalidation of specified paths", async () => {
    const invalidated: string[] = []
    
    // Hook into invalidation (need to expose this somehow)
    // ...
    
    await api.users.create.runPromise(new CreateUserInput({ name: "Eve" }))
    
    expect(invalidated).toContain("@test/users")
    expect(invalidated).toContain("@test/users/list")
  })
})
```

**Open question:** How do we observe invalidation in tests? Options:
1. Return invalidated tags from mutation response
2. Expose an invalidation event/callback
3. Integrate with Reactivity and observe changes

---

### 2.5 Stream Tests (`stream.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Stream yields chunks | `watch()` | Receives multiple User chunks |
| Stream ends | After all chunks | StreamEnd received, stream completes |
| Stream error | Handler fails mid-stream | Receives Failure, stream ends |
| Stream cancellation | Client cancels | Server stops (if supported) |

```typescript
describe("Stream", () => {
  it("yields all chunks then ends", async () => {
    const chunks: User[] = []
    
    await Effect.runPromise(
      api.users.watch.stream.pipe(
        Stream.tap((user) => Effect.sync(() => chunks.push(user))),
        Stream.runDrain
      )
    )
    
    expect(chunks).toHaveLength(2) // Alice and Bob
    expect(chunks[0]).toBeInstanceOf(User)
  })
})
```

---

### 2.6 Transport Protocol Tests (`protocol.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Request has correct shape | TransportRequest | `{ id, tag, payload }` |
| Success response shape | Query success | `Success { id, value }` |
| Failure response shape | Query error | `Failure { id, error }` |
| StreamChunk shape | Stream item | `StreamChunk { id, chunk }` |
| StreamEnd shape | Stream complete | `StreamEnd { id }` |

```typescript
describe("Transport Protocol", () => {
  it("sends correctly shaped request", async () => {
    let capturedRequest: Transport.TransportRequest | null = null
    
    // Use a spy transport
    const spyTransport = Transport.make({
      send: (req) => {
        capturedRequest = req
        return server.handle(req)
      },
      sendStream: (req) => server.handleStream(req),
    })
    
    await api.users.list.runPromise()
    
    expect(capturedRequest).not.toBeNull()
    expect(capturedRequest!.tag).toBe("@test/users/list")
    expect(capturedRequest!.id).toBeDefined()
  })
  
  it("success response is Success instance", async () => {
    let capturedResponse: Transport.TransportResponse | null = null
    
    // Intercept response
    // ...
    
    expect(capturedResponse).toBeInstanceOf(Transport.Success)
  })
})
```

---

### 2.7 Schema Encoding/Decoding Tests (`schema.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Payload decoded on server | Complex input | Handler receives decoded type |
| Success encoded on server | Return class instance | JSON-serializable |
| Error encoded on server | Throw typed error | Matches error schema |
| Success decoded on client | Receive JSON | Get class instance |
| Error decoded on client | Receive error JSON | Get typed error |

```typescript
describe("Schema Round-trip", () => {
  it("class instances survive round-trip", async () => {
    const input = new CreateUserInput({ name: "Test" })
    const result = await api.users.create.runPromise(input)
    
    // Result should be a proper User instance, not plain object
    expect(result).toBeInstanceOf(User)
    expect(result.name).toBe("Test")
  })
})
```

---

### 2.8 Type-Level Tests (`types.test.ts`)

These don't run at runtime — they verify TypeScript catches errors at compile time.

```typescript
describe("Type Safety", () => {
  // These should cause TypeScript errors (verified by @effect/typecheck or tsd)
  
  it("rejects wrong payload type", () => {
    // @ts-expect-error - id should be string, not number
    api.users.get.runPromise({ id: 123 })
  })
  
  it("rejects invalid invalidate paths", () => {
    // @ts-expect-error - "typo" is not a valid path
    api.invalidate(["typo"])
  })
  
  it("handler must return correct type", () => {
    // @ts-expect-error - should return User, not string
    Server.make(testRouter, {
      users: {
        list: () => Effect.succeed("wrong"),
        // ...
      },
    })
  })
  
  it("client method matches procedure type", () => {
    // Query has useQuery, not useMutation
    api.users.list.useQuery
    
    // @ts-expect-error - queries don't have useMutation
    api.users.list.useMutation
  })
})
```

---

### 2.9 Edge Cases (`edge-cases.test.ts`)

| Test | Description | Expected |
|------|-------------|----------|
| Empty array response | List returns `[]` | Empty array, not error |
| Null in response | Handler returns null | Handled correctly |
| Very large payload | Big object | No truncation |
| Unicode in strings | Emoji, special chars | Preserved correctly |
| Concurrent requests | Multiple parallel | All resolve correctly |

---

## 3. File Structure

```
test/
  e2e/
    fixtures/
      schemas.ts        # User, CreateUserInput, etc.
      errors.ts         # NotFoundError, ValidationError, etc.
      procedures.ts     # listUsers, getUser, createUser, etc.
      router.ts         # testRouter
      handlers.ts       # Test handlers with in-memory store
    
    loopback.ts         # Loopback transport implementation
    setup.ts            # Test setup (create server, client, etc.)
    
    query.test.ts
    query-errors.test.ts
    mutation.test.ts
    invalidation.test.ts
    stream.test.ts
    protocol.test.ts
    schema.test.ts
    types.test.ts
    edge-cases.test.ts
```

---

## 4. Test Runner Setup

Using `@effect/vitest` for Effect-native testing:

```typescript
import { it, expect } from "@effect/vitest"
import { Effect } from "effect"

it.effect("returns users", () =>
  Effect.gen(function* () {
    const users = yield* api.users.list.run
    expect(users).toHaveLength(2)
  })
)
```

---

## 5. Open Questions

1. **How to test invalidation?**
   - Need a way to observe when invalidation happens
   - Options: callback, event emitter, or Reactivity integration

2. **How to test React hooks?**
   - Requires React Testing Library
   - Should this be separate from E2E tests?
   - Maybe a `test/react/` directory later?

3. **Should loopback transport be exported?**
   - Useful for users writing their own tests
   - Could be `Transport.loopback(server)`

4. **How to test with dependencies (R)?**
   - Handlers with services need those services provided
   - Test setup should provide test implementations

5. **Snapshot testing for responses?**
   - Could snapshot the wire format
   - Ensures protocol stability

---

## 6. Implementation Order

1. **Loopback transport** — foundation for all tests
2. **Fixtures** — schemas, router, handlers
3. **Query tests** — simplest flow
4. **Mutation tests** — includes side effects
5. **Error tests** — failure paths
6. **Stream tests** — more complex
7. **Protocol tests** — wire format
8. **Type tests** — compile-time checks
9. **Edge cases** — last

---

## 7. Success Criteria

All tests pass, and we have confidence that:

- ✅ Client can call Server procedures
- ✅ Payloads are decoded correctly
- ✅ Responses are encoded/decoded correctly
- ✅ Errors propagate with correct types
- ✅ Streams yield chunks and complete
- ✅ Invalidation is triggered
- ✅ Type safety catches mistakes at compile time
