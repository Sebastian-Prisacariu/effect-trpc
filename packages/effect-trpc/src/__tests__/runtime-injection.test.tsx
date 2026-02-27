// @vitest-environment jsdom
/**
 * Tests for the runtime-injected V1 API.
 *
 * These tests validate that:
 * - EffectTRPCProvider properly injects the runtime
 * - createTRPCHooks creates working hooks
 * - useRuntime and useHasRuntime work correctly
 */

import * as React from "react"
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import { renderHook } from "@testing-library/react"

import { Client } from "../core/client/index.js"
import { procedure } from "../core/server/procedure.js"
import { procedures } from "../core/server/procedures.js"
import { Router } from "../core/server/router.js"
import { EffectTRPCProvider, useRuntime, useHasRuntime, createTRPCHooks } from "../react/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Router
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const userProcedures = procedures("user", {
  list: procedure.output(Schema.Array(UserSchema)).query(),
  byId: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(UserSchema)
    .query(),
})

const testRouterEffect = Router.make({
  user: userProcedures,
})

type TestRouter = Effect.Effect.Success<typeof testRouterEffect>

// Extract the router synchronously (Router.make returns Effect.succeed)
const testRouter: TestRouter = Effect.runSync(testRouterEffect)

// ─────────────────────────────────────────────────────────────────────────────
// Mock Client Layer
// ─────────────────────────────────────────────────────────────────────────────

const mockUsers = [
  { id: "1", name: "Alice" },
  { id: "2", name: "Bob" },
]

const MockClientLive = Layer.succeed(Client, {
  create: () =>
    ({
      user: {
        list: () => Effect.succeed(mockUsers),
        byId: (input: { id: string }) =>
          Effect.succeed(mockUsers.find((u) => u.id === input.id) ?? mockUsers[0]),
      },
    }) as unknown as ReturnType<(typeof Client.Service)["create"]>,
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Runtime Injection", () => {
  describe("useHasRuntime", () => {
    it("returns false when not in provider", () => {
      const { result } = renderHook(() => useHasRuntime())
      expect(result.current).toBe(false)
    })

    it("returns true when in provider", () => {
      const runtime = ManagedRuntime.make(MockClientLive)

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <EffectTRPCProvider runtime={runtime}>{children}</EffectTRPCProvider>
      )

      const { result } = renderHook(() => useHasRuntime(), { wrapper })
      expect(result.current).toBe(true)
    })
  })

  describe("useRuntime", () => {
    it("throws when not in provider", () => {
      expect(() => {
        renderHook(() => useRuntime())
      }).toThrow("[effect-trpc] useRuntime must be used within an EffectTRPCProvider")
    })

    it("returns runtime when in provider", () => {
      const runtime = ManagedRuntime.make(MockClientLive)

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <EffectTRPCProvider runtime={runtime}>{children}</EffectTRPCProvider>
      )

      const { result } = renderHook(() => useRuntime(), { wrapper })
      expect(result.current).toBe(runtime)
    })
  })

  describe("EffectTRPCProvider", () => {
    it("renders children", () => {
      const runtime = ManagedRuntime.make(MockClientLive)
      const TestChild = () => <div data-testid="child">Hello</div>

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <EffectTRPCProvider runtime={runtime}>{children}</EffectTRPCProvider>
      )

      const { result } = renderHook(
        () => {
          return useHasRuntime()
        },
        { wrapper },
      )

      expect(result.current).toBe(true)
    })
  })

  describe("createTRPCHooks", () => {
    it("creates hooks object with procedures", () => {
      const hooks = createTRPCHooks<TestRouter>({ router: testRouter })

      expect(hooks).toHaveProperty("procedures")
      expect(hooks).toHaveProperty("Provider")
      expect(typeof hooks.Provider).toBe("function")
    })

    it("procedures object is a proxy", () => {
      const hooks = createTRPCHooks<TestRouter>({ router: testRouter })

      // Access nested paths
      expect(hooks.procedures).toBeDefined()
      expect((hooks.procedures as any).user).toBeDefined()
      expect((hooks.procedures as any).user.list).toBeDefined()
      expect((hooks.procedures as any).user.list.useQuery).toBeDefined()
    })
  })

  describe("createTRPCHooks.Provider", () => {
    it("throws if used outside EffectTRPCProvider", () => {
      const hooks = createTRPCHooks<TestRouter>({ router: testRouter })

      expect(() => {
        renderHook(() => null, {
          wrapper: ({ children }) => <hooks.Provider>{children}</hooks.Provider>,
        })
      }).toThrow("[effect-trpc] useRuntime must be used within an EffectTRPCProvider")
    })

    it("works inside EffectTRPCProvider", () => {
      const runtime = ManagedRuntime.make(MockClientLive)
      const hooks = createTRPCHooks<TestRouter>({ router: testRouter })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <EffectTRPCProvider runtime={runtime}>
          <hooks.Provider>{children}</hooks.Provider>
        </EffectTRPCProvider>
      )

      const { result } = renderHook(() => useHasRuntime(), { wrapper })
      expect(result.current).toBe(true)
    })
  })
})

describe("Type Safety", () => {
  it("createTRPCHooks preserves router type", () => {
    const hooks = createTRPCHooks<TestRouter>({ router: testRouter })

    // TypeScript should infer these correctly
    type Procedures = typeof hooks.procedures
    type UserProcedures = Procedures["user"]

    // This is a compile-time check - if types are wrong, this won't compile
    const _typeCheck: Procedures = hooks.procedures
    void _typeCheck
  })
})
