# Authentication

Handle auth tokens and headers.

---

## Overview

Authentication is handled via **middleware** — set up once, applies to all calls automatically.

---

## Client Middleware (Recommended)

Use the middleware pattern to add auth headers:

```typescript
import { Middleware } from "effect-trpc"
import { Headers } from "@effect/platform"

// Define middleware (from our example)
class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}

// Client-side middleware — adds headers to every request
const AuthClientLive = Middleware.layerClient(Auth, ({ request, rpc }) =>
  Effect.gen(function* () {
    const token = yield* getStoredToken()  // From localStorage, cookie, etc.
    return {
      ...request,
      headers: Headers.set(request.headers, "authorization", `Bearer ${token}`)
    }
  })
)
```

**Usage — all calls get auth headers automatically:**

```tsx
<api.Provider 
  layer={Transport.http("/api/trpc").pipe(Layer.provide(AuthClientLive))}
>
  <App />
</api.Provider>
```

Now `api.user.list.useQuery()` automatically includes the auth header.

---

## Token Refresh

Handle expired tokens in middleware:

```typescript
const AuthClientLive = Middleware.layerClient(Auth, ({ request, rpc }) =>
  Effect.gen(function* () {
    let token = yield* getStoredToken()
    
    // Check if expired
    if (isTokenExpired(token)) {
      token = yield* refreshToken()
      yield* storeToken(token)
    }
    
    return {
      ...request,
      headers: Headers.set(request.headers, "authorization", `Bearer ${token}`)
    }
  })
)
```

---

## Provider Headers (Simple Cases)

For static headers that don't need logic:

```tsx
<api.Provider 
  layer={Transport.http("/api/trpc")}
  headers={{ "X-App-Version": "1.0.0", "X-Client": "web" }}
>
```

Or dynamic via callback:

```tsx
function AuthenticatedProvider({ children }) {
  const { token } = useAuth()
  
  return (
    <api.Provider 
      layer={Transport.http("/api/trpc")}
      headers={() => ({ "Authorization": `Bearer ${token}` })}
    >
      {children}
    </api.Provider>
  )
}
```

---

## Per-Call Headers (Escape Hatch)

Effect RPC supports per-call headers if needed:

```typescript
// Imperative
await api.user.list.runPromise({
  headers: { "X-Override": "value" }
})

// These merge with middleware headers
```

Use sparingly — middleware should handle most cases.

---

## Server-Side Auth

Server middleware validates the token and provides `CurrentUser`:

```typescript
// Server middleware
const AuthLive = Layer.succeed(Auth,
  Auth.of(({ headers }) =>
    Effect.gen(function* () {
      const token = headers.get("authorization")?.replace("Bearer ", "")
      if (!token) {
        return yield* Effect.fail(new UnauthorizedError({ message: "No token" }))
      }
      
      const user = yield* verifyToken(token)
      return user  // Becomes CurrentUser in handlers
    })
  )
)
```

Handlers can access the authenticated user:

```typescript
const UserProceduresLive = UserProcedures.implement({
  list: () =>
    Effect.gen(function* () {
      const currentUser = yield* CurrentUser  // From Auth middleware
      // Only return data for this user, etc.
    }),
})
```

---

## Full Example

```typescript
// ═══════════════════════════════════════════════════════════════════
// SHARED — Middleware definition
// ═══════════════════════════════════════════════════════════════════

class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}

// ═══════════════════════════════════════════════════════════════════
// SERVER — Validate token, provide CurrentUser
// ═══════════════════════════════════════════════════════════════════

const AuthServerLive = Layer.succeed(Auth,
  Auth.of(({ headers }) =>
    Effect.gen(function* () {
      const token = headers.get("authorization")?.replace("Bearer ", "")
      if (!token) return yield* Effect.fail(new UnauthorizedError({ message: "Missing token" }))
      return yield* verifyJwt(token)
    })
  )
)

// ═══════════════════════════════════════════════════════════════════
// CLIENT — Add token to requests
// ═══════════════════════════════════════════════════════════════════

const AuthClientLive = Middleware.layerClient(Auth, ({ request }) =>
  Effect.gen(function* () {
    const token = localStorage.getItem("auth_token")
    if (!token) return request  // Unauthenticated request
    return {
      ...request,
      headers: Headers.set(request.headers, "authorization", `Bearer ${token}`)
    }
  })
)

// ═══════════════════════════════════════════════════════════════════
// REACT — Provider with auth
// ═══════════════════════════════════════════════════════════════════

<api.Provider 
  layer={Transport.http("/api/trpc").pipe(Layer.provide(AuthClientLive))}
>
  <App />
</api.Provider>
```

---

## Summary

| Pattern | Use Case |
|---------|----------|
| Client middleware | Auth tokens, refresh logic |
| Provider headers | Static headers (version, client ID) |
| Per-call headers | Rare overrides |
| Server middleware | Validate tokens, provide CurrentUser |
