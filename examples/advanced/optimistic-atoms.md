# Advanced: Optimistic Updates with Atoms

For most cases, use the declarative `optimistic` option on mutations:

```typescript
const create = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  invalidates: ["user.list"],
  optimistic: {
    target: "user.list",
    reducer: (users, input) => [...users, { ...input, id: "temp" }],
  },
})
```

But for complex scenarios, you can access the underlying atoms directly and compose with Effect Atom's primitives.

---

## Accessing Query Atoms

Every query exposes its underlying atom:

```typescript
import { createClient } from "effect-trpc/client"
import { Atom } from "@effect-atom/atom-react"

const api = createClient<AppRouter>({ url: "/api/trpc" })

// The raw query atom (read-only, returns Result<User[], Error>)
const usersQueryAtom = api.user.list.atom
```

---

## Manual Optimistic Updates

Use Effect Atom's `Atom.optimistic` and `Atom.optimisticFn`:

```typescript
import { Atom, Result } from "@effect-atom/atom-react"

// 1. Unwrap the Result to get just the data
const usersAtom = Atom.map(
  api.user.list.atom,
  Result.getOrElse(() => [])
)

// 2. Wrap with optimistic layer
const optimisticUsersAtom = Atom.optimistic(usersAtom)

// 3. Create optimistic mutation
const addUserOptimistic = Atom.optimisticFn(optimisticUsersAtom, {
  // Immediately apply (before server responds)
  reducer: (currentUsers, input: CreateUserInput) => [
    ...currentUsers,
    { ...input, id: `temp-${Date.now()}` } as User,
  ],
  
  // Run in background (actual mutation)
  fn: (input: CreateUserInput) => api.user.create.mutate(input),
})
```

---

## Using in Components

```typescript
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react"

function UserList() {
  // Read optimistic state
  const users = useAtomValue(optimisticUsersAtom)
  
  // Get mutation setter
  const addUser = useAtomSet(addUserOptimistic)
  
  return (
    <div>
      <ul>
        {users.map(user => (
          <li key={user.id}>
            {user.name}
            {user.id.startsWith("temp-") && " (saving...)"}
          </li>
        ))}
      </ul>
      
      <button onClick={() => addUser({ name: "New User", email: "new@example.com" })}>
        Add User
      </button>
    </div>
  )
}
```

---

## When to Use This

Use manual atom composition when:

- **Multiple queries need updating** — one mutation affects several query caches
- **Complex transformations** — optimistic update logic is too complex for a simple reducer
- **Conditional optimistic updates** — only apply optimistically in certain conditions
- **Custom rollback behavior** — need more control than automatic rollback
- **Combining with other atoms** — integrating with non-RPC state

For everything else, the declarative `optimistic: { target, reducer }` is simpler and type-safe.

---

## Showing Server Truth vs Optimistic State

You can render both if needed (useful for debugging or admin UIs):

```typescript
function DebugUserList() {
  const serverUsers = useAtomValue(usersAtom)           // Server truth
  const optimisticUsers = useAtomValue(optimisticUsersAtom)  // Includes pending
  
  return (
    <div className="grid grid-cols-2">
      <div>
        <h2>Server State</h2>
        {serverUsers.map(u => <div key={u.id}>{u.name}</div>)}
      </div>
      <div>
        <h2>Optimistic State</h2>
        {optimisticUsers.map(u => <div key={u.id}>{u.name}</div>)}
      </div>
    </div>
  )
}
```
