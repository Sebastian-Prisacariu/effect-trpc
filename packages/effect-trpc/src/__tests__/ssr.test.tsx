// @vitest-environment jsdom
/**
 * Tests for Server-Side Rendering (SSR) support.
 *
 * These tests verify that React hooks behave correctly during SSR and hydration:
 * - Hooks should not trigger fetches during server render
 * - Hooks should not crash during SSR
 * - Hydration should work correctly
 * - Client-side initialization works after hydration
 *
 * IMPORTANT: The current implementation applies `initialData` in useEffect,
 * which means it's NOT available during SSR. Server renders show loading state.
 * For true SSR with data, users should fetch data server-side and pass it via
 * props, or use React Server Components with the server client.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as React from "react"
import { renderHook, act, waitFor } from "@testing-library/react"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"

import { procedure, procedures, Router } from "../index.js"
import { createTRPCReact, Result } from "../react/index.js"
import { useNetworkStatus } from "../react/hooks/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// React DOM Server/Client imports with type safety
// Note: These are available via jsdom environment and @testing-library/react
// ─────────────────────────────────────────────────────────────────────────────

// Dynamic imports for react-dom/server and react-dom/client
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const ReactDOMServer: {
  renderToString: (element: React.ReactElement) => string
} = require("react-dom/server")
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const ReactDOMClient: {
  hydrateRoot: (container: Element, element: React.ReactElement) => { unmount: () => void }
  createRoot: (container: Element) => {
    render: (element: React.ReactElement) => void
    unmount: () => void
  }
} = require("react-dom/client")

const { renderToString } = ReactDOMServer
const { hydrateRoot, createRoot } = ReactDOMClient

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup: Mock Router and Procedures
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})
type User = typeof UserSchema.Type

const UserListOutput = Schema.Array(UserSchema)

const testProcedures = procedures("user", {
  list: procedure.output(UserListOutput).query(),
  byId: procedure.input(Schema.Number).output(UserSchema).query(),
})

const testRouter = Router.make({
  user: testProcedures,
})

type TestRouter = Effect.Effect.Success<typeof testRouter>

// ─────────────────────────────────────────────────────────────────────────────
// Mock HTTP Client with fetch tracking
// ─────────────────────────────────────────────────────────────────────────────

interface MockServerState {
  fetchCount: number
  responses: Map<string, unknown>
  lastRequest: { url: string; body: unknown } | null
}

const createMockServer = (): MockServerState & { reset: () => void } => {
  const state: MockServerState = {
    fetchCount: 0,
    responses: new Map([
      [
        "user.list",
        [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      ],
      ["user.byId", { id: 1, name: "Alice" }],
    ]),
    lastRequest: null,
  }

  return {
    ...state,
    get fetchCount() {
      return state.fetchCount
    },
    get responses() {
      return state.responses
    },
    get lastRequest() {
      return state.lastRequest
    },
    reset: () => {
      state.fetchCount = 0
      state.lastRequest = null
    },
  }
}

const mockServer = createMockServer()

/**
 * Create a mock HttpClient that tracks requests and returns canned responses.
 * Uses NDJSON format matching the actual RPC protocol.
 */
const createMockHttpClient = (server: typeof mockServer) => {
  const mockClient = HttpClient.make((request) =>
    Effect.gen(function* () {
      server.fetchCount++

      // Parse the request body to extract the procedure path
      let body: unknown = undefined
      if (request.body._tag === "Uint8Array") {
        const text = new TextDecoder().decode(request.body.body)
        // NDJSON format: each line is a separate JSON object
        const lines = text.trim().split("\n")
        body = lines.map((line) => JSON.parse(line))
      }

      server.lastRequest = { url: request.url, body }

      // Extract procedure path from the NDJSON request
      // The request format is: [{ _tag: "Request", request: { _tag: "user.list", ... } }]
      let procedurePath = "unknown"
      if (Array.isArray(body) && body.length > 0) {
        const firstMsg = body[0] as { request?: { _tag?: string } }
        if (firstMsg.request?._tag) {
          procedurePath = firstMsg.request._tag
        }
      }

      // Get the response data
      const responseData = server.responses.get(procedurePath) ?? { error: "not found" }

      // Format as NDJSON response
      const responseNdjson = JSON.stringify({ _tag: "Success", value: responseData }) + "\n"

      // Create a mock Response
      const webResponse = new Response(responseNdjson, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
        },
      })

      return HttpClientResponse.fromWeb(request, webResponse)
    }),
  )

  return Layer.succeed(HttpClient.HttpClient, mockClient)
}

// ─────────────────────────────────────────────────────────────────────────────
// Create test client
// ─────────────────────────────────────────────────────────────────────────────

const createTestClient = () =>
  createTRPCReact<TestRouter>({
    url: "/api/trpc",
    httpClient: createMockHttpClient(mockServer),
  })

// ─────────────────────────────────────────────────────────────────────────────
// Test Components
// ─────────────────────────────────────────────────────────────────────────────

interface UserListProps {
  initialData?: readonly User[]
}

const createUserListComponent = (trpc: ReturnType<typeof createTestClient>) => {
  return function UserList({ initialData }: UserListProps) {
    const { data, isLoading, isSuccess } = trpc.procedures.user.list.useQuery(
      undefined,
      initialData !== undefined ? { initialData } : undefined,
    )

    if (isLoading) {
      return <div data-testid="loading">Loading...</div>
    }

    if (isSuccess && data) {
      return (
        <ul data-testid="user-list">
          {data.map((user) => (
            <li key={user.id} data-testid={`user-${user.id}`}>
              {user.name}
            </li>
          ))}
        </ul>
      )
    }

    return <div data-testid="empty">No users</div>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to manage hydration roots
// ─────────────────────────────────────────────────────────────────────────────

class HydrationHelper {
  private root: { unmount: () => void } | null = null
  private container: HTMLElement | null = null

  async hydrateInto(serverHtml: string, element: React.ReactElement): Promise<HTMLElement> {
    this.container = document.createElement("div")
    this.container.innerHTML = serverHtml
    document.body.appendChild(this.container)

    await act(async () => {
      this.root = hydrateRoot(this.container!, element)
    })

    return this.container
  }

  cleanup() {
    if (this.root) {
      this.root.unmount()
      this.root = null
    }
    if (this.container && this.container.parentNode) {
      document.body.removeChild(this.container)
      this.container = null
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("SSR Support", () => {
  let trpc: ReturnType<typeof createTestClient>
  let UserList: ReturnType<typeof createUserListComponent>

  beforeEach(() => {
    mockServer.reset()
    trpc = createTestClient()
    UserList = createUserListComponent(trpc)
  })

  afterEach(async () => {
    await trpc.dispose()
  })

  describe("Server-side rendering", () => {
    it("renders loading state on server without fetching", () => {
      // Render on server
      const html = renderToString(
        <trpc.Provider>
          <UserList />
        </trpc.Provider>,
      )

      // Should render loading state
      expect(html).toContain("Loading...")
      expect(html).toContain('data-testid="loading"')

      // Should NOT have triggered any fetch during SSR
      // Note: React's renderToString doesn't run useEffect/useLayoutEffect
      expect(mockServer.fetchCount).toBe(0)
    })

    it("renders loading state even with initialData (initialData is client-side only)", () => {
      // IMPORTANT: In the current implementation, initialData is applied in useEffect
      // which doesn't run during SSR. This test documents this behavior.
      const initialData: readonly User[] = [
        { id: 1, name: "Server Alice" },
        { id: 2, name: "Server Bob" },
      ]

      // Render on server with initial data
      const html = renderToString(
        <trpc.Provider>
          <UserList initialData={initialData} />
        </trpc.Provider>,
      )

      // Should render loading state because initialData is applied in useEffect
      // which doesn't run on server
      expect(html).toContain("Loading...")
      expect(html).not.toContain("Server Alice")

      // Should NOT have triggered any fetch
      expect(mockServer.fetchCount).toBe(0)
    })

    it("handles multiple queries during SSR without fetching", () => {
      const MultiQueryComponent = () => {
        const query1 = trpc.procedures.user.list.useQuery(undefined)
        const query2 = trpc.procedures.user.byId.useQuery(1)

        return (
          <div>
            <div data-testid="q1">{query1.isLoading ? "Loading 1" : "Done 1"}</div>
            <div data-testid="q2">{query2.isLoading ? "Loading 2" : "Done 2"}</div>
          </div>
        )
      }

      const html = renderToString(
        <trpc.Provider>
          <MultiQueryComponent />
        </trpc.Provider>,
      )

      // Both should be in loading state
      expect(html).toContain("Loading 1")
      expect(html).toContain("Loading 2")

      // No fetches during SSR
      expect(mockServer.fetchCount).toBe(0)
    })

    it("does not crash with complex component tree during SSR", () => {
      const NestedComponent = () => {
        const query = trpc.procedures.user.list.useQuery(undefined)
        return (
          <div>
            <span>Nested: {query.isLoading ? "loading" : "done"}</span>
          </div>
        )
      }

      const ComplexComponent = () => {
        const query1 = trpc.procedures.user.list.useQuery(undefined)
        const query2 = trpc.procedures.user.byId.useQuery(1)

        return (
          <div>
            <header>Header: {query1.isLoading ? "loading" : "done"}</header>
            <main>
              <NestedComponent />
              <NestedComponent />
            </main>
            <footer>Footer: {query2.isLoading ? "loading" : "done"}</footer>
          </div>
        )
      }

      // Should not throw during complex SSR
      expect(() => {
        renderToString(
          <trpc.Provider>
            <ComplexComponent />
          </trpc.Provider>,
        )
      }).not.toThrow()

      // No fetches during SSR
      expect(mockServer.fetchCount).toBe(0)
    })
  })

  describe("Hydration", () => {
    let helper: HydrationHelper

    beforeEach(() => {
      helper = new HydrationHelper()
    })

    afterEach(() => {
      helper.cleanup()
    })

    it("transitions from loading to another state after hydration", async () => {
      // Step 1: Render on "server"
      const serverHtml = renderToString(
        <trpc.Provider>
          <UserList />
        </trpc.Provider>,
      )

      expect(serverHtml).toContain("Loading...")
      expect(mockServer.fetchCount).toBe(0)

      // Step 2: Hydrate on "client"
      const container = await helper.hydrateInto(
        serverHtml,
        <trpc.Provider>
          <UserList />
        </trpc.Provider>,
      )

      // After hydration, useEffect runs and state should eventually change
      // from "loading" to either "no users" (empty) or the fetched data
      // The key point is that hydration doesn't crash and the component
      // continues to work on the client side
      await waitFor(
        () => {
          // Should transition out of loading state
          expect(container.textContent).not.toContain("Loading...")
        },
        { timeout: 2000 },
      )
    })

    it("applies initialData client-side after hydration (with refetchOnMount=false)", async () => {
      const initialData: readonly User[] = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]

      // Create a client that doesn't refetch on mount when we have initialData
      const noRefetchTrpc = createTRPCReact<TestRouter>({
        url: "/api/trpc",
        httpClient: createMockHttpClient(mockServer),
        defaultQueryOptions: {
          refetchOnMount: false, // Don't refetch since we have initialData
        },
      })

      const NoRefetchUserList = createUserListComponent(noRefetchTrpc)

      // Step 1: Render on "server" (shows loading)
      const serverHtml = renderToString(
        <noRefetchTrpc.Provider>
          <NoRefetchUserList initialData={initialData} />
        </noRefetchTrpc.Provider>,
      )

      expect(serverHtml).toContain("Loading...")
      expect(mockServer.fetchCount).toBe(0)

      // Step 2: Hydrate on "client"
      const container = await helper.hydrateInto(
        serverHtml,
        <noRefetchTrpc.Provider>
          <NoRefetchUserList initialData={initialData} />
        </noRefetchTrpc.Provider>,
      )

      // Wait for initialData to be applied (happens in useEffect)
      await waitFor(
        () => {
          expect(container.textContent).toContain("Alice")
          expect(container.textContent).toContain("Bob")
        },
        { timeout: 2000 },
      )

      // No fetch should have happened because we had initialData and refetchOnMount=false
      expect(mockServer.fetchCount).toBe(0)

      await noRefetchTrpc.dispose()
    })

    it("prevents fetch when initialData is provided and staleTime is set", async () => {
      const initialData: readonly User[] = [{ id: 1, name: "Fresh Data" }]

      // Fresh client for this test
      const freshTrpc = createTRPCReact<TestRouter>({
        url: "/api/trpc",
        httpClient: createMockHttpClient(mockServer),
        defaultQueryOptions: {
          // Data is fresh for 5 minutes - should not refetch
          staleTime: 5 * 60 * 1000,
          // Don't refetch on mount since we have initialData
          refetchOnMount: false,
        },
      })

      const FreshUserList = createUserListComponent(freshTrpc)

      // Server render
      const serverHtml = renderToString(
        <freshTrpc.Provider>
          <FreshUserList initialData={initialData} />
        </freshTrpc.Provider>,
      )

      expect(mockServer.fetchCount).toBe(0)

      // Hydrate
      const container = await helper.hydrateInto(
        serverHtml,
        <freshTrpc.Provider>
          <FreshUserList initialData={initialData} />
        </freshTrpc.Provider>,
      )

      // Wait for initialData to be applied
      await waitFor(() => {
        expect(container.textContent).toContain("Fresh Data")
      })

      // Wait a bit more to ensure no fetch is triggered
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })

      // Should NOT have fetched because refetchOnMount is false and data is fresh
      expect(mockServer.fetchCount).toBe(0)

      await freshTrpc.dispose()
    })
  })

  describe("useNetworkStatus SSR safety", () => {
    it("returns server-safe values during SSR", () => {
      const NetworkComponent = () => {
        const status = useNetworkStatus()
        return (
          <div>
            <span data-testid="online">{status.isOnline ? "online" : "offline"}</span>
            <span data-testid="hydrated">{status.isHydrated ? "hydrated" : "not-hydrated"}</span>
          </div>
        )
      }

      // Server render
      const html = renderToString(<NetworkComponent />)

      // Should show server-safe defaults
      // isOnline defaults to true (safe for SSR)
      expect(html).toContain("online")
      // isHydrated should be false on server
      expect(html).toContain("not-hydrated")
    })

    it("updates isHydrated after client mount", async () => {
      const { result } = renderHook(() => useNetworkStatus())

      // After mount, isHydrated should become true
      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })
    })
  })

  describe("Query hooks SSR safety", () => {
    it("renders query in loading state during SSR", () => {
      const QueryComponent = () => {
        const query = trpc.procedures.user.list.useQuery(undefined)
        return (
          <div data-testid="query-state">
            {query.isLoading ? "loading" : query.isSuccess ? "success" : "idle"}
          </div>
        )
      }

      const html = renderToString(
        <trpc.Provider>
          <QueryComponent />
        </trpc.Provider>,
      )

      // Should render loading state without crashing
      expect(html).toContain("loading")
      expect(mockServer.fetchCount).toBe(0)
    })
  })

  describe("Query with enabled=false", () => {
    let helper: HydrationHelper

    beforeEach(() => {
      helper = new HydrationHelper()
    })

    afterEach(() => {
      helper.cleanup()
    })

    it("does not fetch during SSR when enabled=false", () => {
      const DisabledQueryComponent = () => {
        const { data, isLoading } = trpc.procedures.user.list.useQuery(undefined, {
          enabled: false,
        })

        return (
          <div data-testid="status">{isLoading ? "loading" : data ? "has-data" : "no-data"}</div>
        )
      }

      const html = renderToString(
        <trpc.Provider>
          <DisabledQueryComponent />
        </trpc.Provider>,
      )

      // Should be in loading state (initial)
      expect(html).toContain("loading")
      expect(mockServer.fetchCount).toBe(0)
    })

    it("does not fetch after hydration when enabled=false", async () => {
      const DisabledQueryComponent = () => {
        const { data, isLoading } = trpc.procedures.user.list.useQuery(undefined, {
          enabled: false,
        })

        return (
          <div data-testid="status">{isLoading ? "loading" : data ? "has-data" : "no-data"}</div>
        )
      }

      // Server render
      const serverHtml = renderToString(
        <trpc.Provider>
          <DisabledQueryComponent />
        </trpc.Provider>,
      )

      // Hydrate
      await helper.hydrateInto(
        serverHtml,
        <trpc.Provider>
          <DisabledQueryComponent />
        </trpc.Provider>,
      )

      // Wait a bit
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })

      // Should NOT have fetched because enabled=false
      expect(mockServer.fetchCount).toBe(0)
    })
  })

  describe("Multiple providers isolation", () => {
    it("maintains isolated state between providers during SSR", () => {
      const trpc1 = createTRPCReact<TestRouter>({
        url: "/api/trpc",
        httpClient: createMockHttpClient(mockServer),
      })

      const trpc2 = createTRPCReact<TestRouter>({
        url: "/api/trpc",
        httpClient: createMockHttpClient(mockServer),
      })

      const UserList1 = createUserListComponent(trpc1)
      const UserList2 = createUserListComponent(trpc2)

      // Both should render loading state during SSR (initialData is client-side only)
      const html = renderToString(
        <div>
          <trpc1.Provider>
            <UserList1 initialData={[{ id: 1, name: "Provider 1" }]} />
          </trpc1.Provider>
          <trpc2.Provider>
            <UserList2 initialData={[{ id: 2, name: "Provider 2" }]} />
          </trpc2.Provider>
        </div>,
      )

      // Both should render loading state (initialData is not applied during SSR)
      expect(html).toContain("Loading...")

      // No fetches during SSR
      expect(mockServer.fetchCount).toBe(0)

      // Cleanup
      void trpc1.dispose()
      void trpc2.dispose()
    })
  })

  describe("Error boundaries during SSR", () => {
    it("handles errors gracefully during SSR", () => {
      // This tests that if a hook throws during SSR, it doesn't crash the server
      // Our hooks should NOT throw during SSR - they should return initial state

      const ErrorProneComponent = () => {
        // This should not throw during SSR
        const { data, isLoading, error } = trpc.procedures.user.list.useQuery(undefined)

        return (
          <div>
            {isLoading && <span>Loading</span>}
            {error && <span>Error: {String(error)}</span>}
            {data && <span>Data: {JSON.stringify(data)}</span>}
          </div>
        )
      }

      // Should not throw
      expect(() => {
        renderToString(
          <trpc.Provider>
            <ErrorProneComponent />
          </trpc.Provider>,
        )
      }).not.toThrow()
    })
  })

  describe("Result type helper SSR safety", () => {
    it("Result.isInitial returns true during SSR (no data yet)", () => {
      const ResultComponent = () => {
        const query = trpc.procedures.user.list.useQuery(undefined)

        // During SSR, result is in initial state
        const isInitial = Result.isInitial(query.result)
        const isSuccess = Result.isSuccess(query.result)
        const isFailure = Result.isFailure(query.result)

        return (
          <div>
            <span data-testid="is-initial">{isInitial ? "yes" : "no"}</span>
            <span data-testid="is-success">{isSuccess ? "yes" : "no"}</span>
            <span data-testid="is-failure">{isFailure ? "yes" : "no"}</span>
          </div>
        )
      }

      const html = renderToString(
        <trpc.Provider>
          <ResultComponent />
        </trpc.Provider>,
      )

      // During SSR, result should be in initial state
      expect(html).toContain('data-testid="is-initial">yes')
      expect(html).toContain('data-testid="is-success">no')
      expect(html).toContain('data-testid="is-failure">no')
    })
  })
})

describe("SSR with Suspense (advanced)", () => {
  // Note: Full Suspense SSR testing requires renderToPipeableStream which
  // is more complex to set up in vitest. These tests verify basic behavior.

  let trpc: ReturnType<typeof createTestClient>

  beforeEach(() => {
    mockServer.reset()
    trpc = createTestClient()
  })

  afterEach(async () => {
    await trpc.dispose()
  })

  it("useSuspenseQuery throws promise during SSR (expected behavior)", () => {
    // Suspense queries throw promises to signal loading
    // During SSR with renderToString, this would cause issues
    // Users should use renderToPipeableStream for Suspense SSR

    const SuspenseComponent = () => {
      // This would throw a promise during SSR
      const { data } = trpc.procedures.user.list.useSuspenseQuery(undefined)
      return <div>{data.map((u) => u.name).join(", ")}</div>
    }

    // Note: We expect this to throw because Suspense throws promises
    // In a real app, you'd wrap with Suspense boundary or use streaming SSR
    expect(() => {
      renderToString(
        <trpc.Provider>
          <SuspenseComponent />
        </trpc.Provider>,
      )
    }).toThrow()
  })

  it("works with Suspense boundary during SSR", () => {
    const SuspenseComponent = () => {
      const { data } = trpc.procedures.user.list.useSuspenseQuery(undefined)
      return <div data-testid="content">{data.map((u) => u.name).join(", ")}</div>
    }

    // With a Suspense boundary, the fallback should render
    const html = renderToString(
      <trpc.Provider>
        <React.Suspense fallback={<div data-testid="fallback">Loading...</div>}>
          <SuspenseComponent />
        </React.Suspense>
      </trpc.Provider>,
    )

    // The fallback should render (Suspense catches the thrown promise)
    expect(html).toContain("Loading...")
    expect(html).toContain('data-testid="fallback"')
  })
})

describe("SSR Documentation Tests", () => {
  // These tests document expected behavior for SSR

  let trpc: ReturnType<typeof createTestClient>

  beforeEach(() => {
    mockServer.reset()
    trpc = createTestClient()
  })

  afterEach(async () => {
    await trpc.dispose()
  })

  it("documents that useEffect does not run during SSR", () => {
    let effectRan = false

    const EffectComponent = () => {
      React.useEffect(() => {
        effectRan = true
      }, [])
      return <div>Effect component</div>
    }

    renderToString(<EffectComponent />)

    // useEffect does NOT run during SSR
    expect(effectRan).toBe(false)
  })

  it("documents that initialData is applied in useEffect (client-side only)", () => {
    // This test documents that initialData won't be visible during SSR
    // because it's applied in useEffect which doesn't run on server

    const DataComponent = () => {
      const [data, setData] = React.useState<string | null>(null)

      // This simulates how initialData works in our useQuery hook
      React.useEffect(() => {
        setData("Applied in useEffect")
      }, [])

      return <div>{data ?? "No data (SSR)"}</div>
    }

    const html = renderToString(<DataComponent />)

    // During SSR, data is null because useEffect hasn't run
    expect(html).toContain("No data (SSR)")
    expect(html).not.toContain("Applied in useEffect")
  })

  it("documents recommended SSR pattern: fetch server-side, pass via props", () => {
    // This shows the recommended pattern for SSR with data

    interface Props {
      users: readonly User[]
    }

    // Component receives data as props (not via hooks)
    const ServerRenderedUserList = ({ users }: Props) => {
      return (
        <ul>
          {users.map((user) => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      )
    }

    // Server fetches data and passes as props
    const serverData: readonly User[] = [
      { id: 1, name: "Server-Fetched Alice" },
      { id: 2, name: "Server-Fetched Bob" },
    ]

    const html = renderToString(<ServerRenderedUserList users={serverData} />)

    // Data is available during SSR because it's passed as props
    expect(html).toContain("Server-Fetched Alice")
    expect(html).toContain("Server-Fetched Bob")
  })
})
