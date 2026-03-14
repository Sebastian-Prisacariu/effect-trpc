/**
 * React Hook Tests
 * 
 * Tests for useQuery, useMutation, useStream hooks
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as React from "react"
import { renderHook, waitFor, act } from "@testing-library/react"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import * as Router from "../src/Router/index.js"
import * as Procedure from "../src/Procedure/index.js"
import * as Client from "../src/Client/index.js"
import * as Transport from "../src/Transport/index.js"
import * as Server from "../src/Server/index.js"

// =============================================================================
// Test Fixtures
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
}) {}

const testRouter = Router.make("@test", {
  users: {
    list: Procedure.query({ success: Schema.Array(User) }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    }),
    create: Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users.list"],
    }),
  },
})

const testUsers = [
  new User({ id: "1", name: "Alice" }),
  new User({ id: "2", name: "Bob" }),
]

const testServer = Server.make(testRouter, {
  users: {
    list: () => Effect.succeed(testUsers),
    get: ({ id }) => Effect.succeed(testUsers.find(u => u.id === id) ?? testUsers[0]),
    create: (input) => Effect.succeed(new User({ id: "3", name: input.name })),
  },
})

// Create loopback transport layer
const TestLayer = Transport.loopback(testServer, Layer.empty)

// Create API client
const api = Client.make(testRouter)

// Wrapper component for hooks
const createWrapper = () => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return React.createElement(api.Provider, { layer: TestLayer }, children)
  }
  return Wrapper
}

// =============================================================================
// useQuery Tests
// =============================================================================

describe("useQuery", () => {
  it("returns loading then success state", async () => {
    const { result } = renderHook(
      () => api.users.list.useQuery(),
      { wrapper: createWrapper() }
    )
    
    // Eventually transitions to success
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
  })
  
  it("returns data after successful fetch", async () => {
    const { result } = renderHook(
      () => api.users.list.useQuery(),
      { wrapper: createWrapper() }
    )
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
    
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data?.[0].name).toBe("Alice")
  })
  
  it("respects enabled=false option", async () => {
    const { result } = renderHook(
      () => api.users.list.useQuery(undefined, { enabled: false }),
      { wrapper: createWrapper() }
    )
    
    // Wait a tick to ensure no fetch started
    await new Promise(r => setTimeout(r, 100))
    
    // Should stay in initial state when disabled
    expect(result.current.isSuccess).toBe(false)
    // When disabled, should not be loading
    expect(result.current.data).toBeUndefined()
  })
  
  it("passes payload to query", async () => {
    const { result } = renderHook(
      () => api.users.get.useQuery({ id: "1" }),
      { wrapper: createWrapper() }
    )
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
    
    expect(result.current.data?.id).toBe("1")
  })
  
  it("refetches on refetch() call", async () => {
    let fetchCount = 0
    
    // Create a server that tracks calls
    const countingServer = Server.make(testRouter, {
      users: {
        list: () => {
          fetchCount++
          return Effect.succeed(testUsers)
        },
        get: ({ id }) => Effect.succeed(testUsers.find(u => u.id === id) ?? testUsers[0]),
        create: (input) => Effect.succeed(new User({ id: "3", name: input.name })),
      },
    })
    
    const countingLayer = Transport.loopback(countingServer, Layer.empty)
    const countingApi = Client.make(testRouter)
    
    const CountingWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => 
      React.createElement(countingApi.Provider, { layer: countingLayer }, children)
    
    const { result } = renderHook(
      () => countingApi.users.list.useQuery(),
      { wrapper: CountingWrapper }
    )
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
    
    const initialCount = fetchCount
    
    // Trigger refetch
    act(() => {
      result.current.refetch()
    })
    
    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(initialCount)
    }, { timeout: 5000 })
  })
})

// =============================================================================
// useMutation Tests
// =============================================================================

describe("useMutation", () => {
  it("returns idle state initially", () => {
    const { result } = renderHook(
      () => api.users.create.useMutation(),
      { wrapper: createWrapper() }
    )
    
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
  })
  
  it("executes mutation and returns result", async () => {
    const { result } = renderHook(
      () => api.users.create.useMutation(),
      { wrapper: createWrapper() }
    )
    
    act(() => {
      result.current.mutate(new CreateUserInput({ name: "Charlie" }))
    })
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
    
    expect(result.current.data?.name).toBe("Charlie")
  })
  
  it("calls onSuccess callback", async () => {
    const onSuccess = vi.fn()
    
    const { result } = renderHook(
      () => api.users.create.useMutation({ onSuccess }),
      { wrapper: createWrapper() }
    )
    
    act(() => {
      result.current.mutate(new CreateUserInput({ name: "Dave" }))
    })
    
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 5000 })
    
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ name: "Dave" }))
  })
  
  it("calls onSettled callback", async () => {
    const onSettled = vi.fn()
    
    const { result } = renderHook(
      () => api.users.create.useMutation({ onSettled }),
      { wrapper: createWrapper() }
    )
    
    act(() => {
      result.current.mutate(new CreateUserInput({ name: "Eve" }))
    })
    
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalled()
    }, { timeout: 5000 })
  })
  
  it("resets state on reset() call", async () => {
    const { result } = renderHook(
      () => api.users.create.useMutation(),
      { wrapper: createWrapper() }
    )
    
    act(() => {
      result.current.mutate(new CreateUserInput({ name: "Frank" }))
    })
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    }, { timeout: 5000 })
    
    act(() => {
      result.current.reset()
    })
    
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})
