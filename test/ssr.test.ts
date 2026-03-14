/**
 * SSR Module Tests
 * 
 * Tests for dehydrate, prefetch, prefetchEffect, and Hydrate
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import * as SSR from "../src/SSR/index.js"
import * as Router from "../src/Router/index.js"
import * as Procedure from "../src/Procedure/index.js"
import * as Server from "../src/Server/index.js"
import * as Transport from "../src/Transport/index.js"
import * as Client from "../src/Client/index.js"

// =============================================================================
// Test Fixtures
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Config extends Schema.Class<Config>("Config")({
  version: Schema.String,
  features: Schema.Array(Schema.String),
}) {}

const testUsers = [
  new User({ id: "1", name: "Alice" }),
  new User({ id: "2", name: "Bob" }),
]

const testConfig = new Config({
  version: "1.0.0",
  features: ["dark-mode", "notifications"],
})

// =============================================================================
// dehydrate Tests
// =============================================================================

describe("SSR.dehydrate", () => {
  it("serializes query results into DehydratedState", () => {
    const state = SSR.dehydrate({
      "users.list": testUsers,
      "config.get": testConfig,
    })
    
    expect(state.queries["users.list"]).toEqual(testUsers)
    expect(state.queries["config.get"]).toEqual(testConfig)
  })
  
  it("includes timestamp", () => {
    const before = Date.now()
    const state = SSR.dehydrate({ "test": "data" })
    const after = Date.now()
    
    expect(state.timestamp).toBeGreaterThanOrEqual(before)
    expect(state.timestamp).toBeLessThanOrEqual(after)
  })
  
  it("handles empty queries", () => {
    const state = SSR.dehydrate({})
    
    expect(state.queries).toEqual({})
    expect(state.timestamp).toBeDefined()
  })
  
  it("handles complex nested data", () => {
    const complexData = {
      users: testUsers,
      meta: {
        total: 2,
        page: 1,
        nested: {
          deep: {
            value: "test",
          },
        },
      },
    }
    
    const state = SSR.dehydrate({ "complex.query": complexData })
    
    expect(state.queries["complex.query"]).toEqual(complexData)
  })
})

// =============================================================================
// prefetch Tests
// =============================================================================

describe("SSR.prefetch", () => {
  it("collects query results", async () => {
    const { data, dehydratedState } = await SSR.prefetch(async (collect) => {
      const users = testUsers
      collect("users.list", users)
      
      const config = testConfig
      collect("config.get", config)
      
      return { users, config }
    })
    
    expect(data.users).toEqual(testUsers)
    expect(data.config).toEqual(testConfig)
    expect(dehydratedState.queries["users.list"]).toEqual(testUsers)
    expect(dehydratedState.queries["config.get"]).toEqual(testConfig)
  })
  
  it("returns empty state when nothing collected", async () => {
    const { data, dehydratedState } = await SSR.prefetch(async () => {
      return { empty: true }
    })
    
    expect(data.empty).toBe(true)
    expect(Object.keys(dehydratedState.queries)).toHaveLength(0)
  })
  
  it("handles async data fetching", async () => {
    const { data, dehydratedState } = await SSR.prefetch(async (collect) => {
      // Simulate async fetch
      const users = await Promise.resolve(testUsers)
      collect("users.list", users)
      
      return { users }
    })
    
    expect(data.users).toEqual(testUsers)
    expect(dehydratedState.queries["users.list"]).toEqual(testUsers)
  })
})

// =============================================================================
// prefetchEffect Tests
// =============================================================================

describe("SSR.prefetchEffect", () => {
  it("runs Effect and returns dehydrated state", async () => {
    const effect = Effect.succeed({
      "users.list": testUsers,
      "config.get": testConfig,
    })
    
    const { data, dehydratedState } = await SSR.prefetchEffect(effect)
    
    expect(data["users.list"]).toEqual(testUsers)
    expect(data["config.get"]).toEqual(testConfig)
    expect(dehydratedState.queries["users.list"]).toEqual(testUsers)
  })
  
  it("handles Effect.all composition", async () => {
    const effect = Effect.all({
      "users.list": Effect.succeed(testUsers),
      "config.get": Effect.succeed(testConfig),
    })
    
    const { data, dehydratedState } = await SSR.prefetchEffect(effect)
    
    expect(data["users.list"]).toEqual(testUsers)
    expect(dehydratedState.queries["users.list"]).toEqual(testUsers)
  })
})

// =============================================================================
// useHydratedData Tests
// =============================================================================

describe("SSR.useHydratedData", () => {
  it("is exported and callable", () => {
    // Just verify the function exists
    expect(typeof SSR.useHydratedData).toBe("function")
  })
})

// =============================================================================
// Integration: Full SSR Flow
// =============================================================================

describe("SSR Integration", () => {
  const testRouter = Router.make("@ssr", {
    users: {
      list: Procedure.query({ success: Schema.Array(User) }),
    },
    config: {
      get: Procedure.query({ success: Config }),
    },
  })
  
  const testServer = Server.make(testRouter, {
    users: {
      list: () => Effect.succeed(testUsers),
    },
    config: {
      get: () => Effect.succeed(testConfig),
    },
  })
  
  const testLayer = Transport.loopback(testServer, Layer.empty)
  
  it("server-side prefetch produces valid dehydrated state", async () => {
    const api = Client.make(testRouter)
    const boundApi = api.provide(testLayer)
    
    const { data, dehydratedState } = await SSR.prefetch(async (collect) => {
      const users = await boundApi.users.list.runPromise()
      collect("users.list", users)
      
      const config = await boundApi.config.get.runPromise()
      collect("config.get", config)
      
      return { users, config }
    })
    
    // Verify data
    expect(data.users).toHaveLength(2)
    expect(data.config.version).toBe("1.0.0")
    
    // Verify dehydrated state
    expect(dehydratedState.queries["users.list"]).toEqual(data.users)
    expect(dehydratedState.queries["config.get"]).toEqual(data.config)
    expect(dehydratedState.timestamp).toBeCloseTo(Date.now(), -2)
  })
  
  it("dehydrate/hydrate roundtrip preserves data", () => {
    const original = {
      "users.list": testUsers,
      "config.get": testConfig,
    }
    
    const dehydrated = SSR.dehydrate(original)
    
    // Simulate serialization/deserialization (what happens between server/client)
    const serialized = JSON.stringify(dehydrated)
    const deserialized = JSON.parse(serialized) as SSR.DehydratedState
    
    expect(deserialized.queries["users.list"]).toEqual(testUsers)
    expect(deserialized.queries["config.get"]).toEqual(testConfig)
    expect(deserialized.timestamp).toBe(dehydrated.timestamp)
  })
})
