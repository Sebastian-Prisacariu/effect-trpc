/**
 * Client usage example.
 * 
 * Shows how to use the API client in React components.
 */

import * as React from "react"
import { createClient, Result } from "../src/client/index.js"
import { UserRpcs, NotFoundError } from "./procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Create the API client
// ─────────────────────────────────────────────────────────────────────────────

export const api = createClient(UserRpcs, {
  url: "/api/rpc",
  
  // Define invalidation rules
  invalidates: {
    create: ["list"],           // Creating a user refetches the list
    update: ["list", "byId"],   // Updating refetches list and individual
    delete: ["list", "byId"],   // Deleting refetches list and clears cache
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Provider Setup (in _app.tsx or layout.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export function ApiProvider({ children }: { children: React.ReactNode }) {
  return <api.Provider>{children}</api.Provider>
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: User List Component
// ─────────────────────────────────────────────────────────────────────────────

export function UserList() {
  const query = api.list.useQuery()
  
  // Using Result.match for exhaustive state handling
  return Result.match(query.result, {
    onInitial: () => (
      <div className="skeleton">Loading users...</div>
    ),
    
    onWaiting: () => (
      <div className="spinner">Refreshing...</div>
    ),
    
    onSuccess: (users) => (
      <div>
        <h2>Users ({users.length})</h2>
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              {user.name} ({user.email})
            </li>
          ))}
        </ul>
        <button onClick={query.refetch}>Refresh</button>
      </div>
    ),
    
    onFailure: (error) => (
      <div className="error">
        Error loading users: {String(error)}
      </div>
    ),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: User Detail with Tagged Error Handling
// ─────────────────────────────────────────────────────────────────────────────

export function UserDetail({ userId }: { userId: string }) {
  const query = api.byId.useQuery({ id: userId })
  
  // More granular error handling with tagged errors
  if (Result.isInitial(query.result)) {
    return <div className="skeleton">Loading...</div>
  }
  
  if (Result.isWaiting(query.result)) {
    return <div className="spinner">Loading user...</div>
  }
  
  if (Result.isFailure(query.result)) {
    const error = query.result.cause
    
    // Handle specific error types
    if (error instanceof NotFoundError) {
      return (
        <div className="not-found">
          User not found: {error.entityId}
        </div>
      )
    }
    
    // Generic error fallback
    return (
      <div className="error">
        Something went wrong: {String(error)}
      </div>
    )
  }
  
  // Success case
  const user = query.result.value
  
  return (
    <div className="user-detail">
      <h2>{user.name}</h2>
      <p>Email: {user.email}</p>
      <p>Created: {user.createdAt.toLocaleDateString()}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: Create User Form
// ─────────────────────────────────────────────────────────────────────────────

export function CreateUserForm() {
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  
  const mutation = api.create.useMutation()
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    mutation.mutate({ name, email })
  }
  
  // Reset form on success
  React.useEffect(() => {
    if (mutation.isSuccess) {
      setName("")
      setEmail("")
      // mutation.reset() // Optionally reset the mutation state
    }
  }, [mutation.isSuccess])
  
  return (
    <form onSubmit={handleSubmit}>
      <h3>Create User</h3>
      
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={mutation.isLoading}
      />
      
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={mutation.isLoading}
      />
      
      <button type="submit" disabled={mutation.isLoading}>
        {mutation.isLoading ? "Creating..." : "Create User"}
      </button>
      
      {mutation.isSuccess && (
        <div className="success">
          Created user: {mutation.data?.name}
        </div>
      )}
      
      {mutation.isError && (
        <div className="error">
          Error: {String(mutation.error)}
        </div>
      )}
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: Full Page
// ─────────────────────────────────────────────────────────────────────────────

export function UsersPage() {
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)
  
  return (
    <ApiProvider>
      <div className="users-page">
        <div className="sidebar">
          <CreateUserForm />
          <UserList />
        </div>
        
        <div className="main">
          {selectedUserId ? (
            <UserDetail userId={selectedUserId} />
          ) : (
            <p>Select a user to view details</p>
          )}
        </div>
      </div>
    </ApiProvider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced: Using the Result.builder pattern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A more ergonomic Result builder (if we add this to the library).
 * 
 * @example
 * ```tsx
 * return resultBuilder(query.result)
 *   .onInitial(() => <Skeleton />)
 *   .onWaiting(() => <Spinner />)
 *   .onSuccess((users) => <UserList users={users} />)
 *   .onErrorTag('NotFoundError', (e) => <NotFound id={e.entityId} />)
 *   .onErrorTag('ValidationError', (e) => <ValidationError field={e.field} />)
 *   .onError((e) => <GenericError error={e} />)
 *   .render()
 * ```
 */

// This could be added to the library:
export function resultBuilder<T, E>(result: Result.Result<T, E>) {
  type Handler<R> = () => R
  type SuccessHandler<R> = (value: T) => R
  type ErrorHandler<R> = (error: E) => R
  
  let initialHandler: Handler<React.ReactNode> = () => null
  let waitingHandler: Handler<React.ReactNode> = () => null
  let successHandler: SuccessHandler<React.ReactNode> = () => null
  let errorHandler: ErrorHandler<React.ReactNode> = () => null
  const taggedErrorHandlers = new Map<string, (error: any) => React.ReactNode>()
  
  const builder = {
    onInitial(handler: Handler<React.ReactNode>) {
      initialHandler = handler
      return builder
    },
    
    onWaiting(handler: Handler<React.ReactNode>) {
      waitingHandler = handler
      return builder
    },
    
    onSuccess(handler: SuccessHandler<React.ReactNode>) {
      successHandler = handler
      return builder
    },
    
    onErrorTag<Tag extends string>(
      tag: Tag,
      handler: (error: Extract<E, { _tag: Tag }>) => React.ReactNode
    ) {
      taggedErrorHandlers.set(tag, handler)
      return builder
    },
    
    onError(handler: ErrorHandler<React.ReactNode>) {
      errorHandler = handler
      return builder
    },
    
    render(): React.ReactNode {
      if (Result.isInitial(result)) {
        return initialHandler()
      }
      
      if (Result.isWaiting(result)) {
        return waitingHandler()
      }
      
      if (Result.isSuccess(result)) {
        return successHandler(result.value)
      }
      
      if (Result.isFailure(result)) {
        const error = result.cause
        
        // Check for tagged errors
        if (error && typeof error === "object" && "_tag" in error) {
          const handler = taggedErrorHandlers.get((error as any)._tag)
          if (handler) {
            return handler(error)
          }
        }
        
        return errorHandler(error)
      }
      
      return null
    },
  }
  
  return builder
}
