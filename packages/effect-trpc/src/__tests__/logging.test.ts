import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as LogLevel from "effect/LogLevel"
import { describe, expect, it } from "vitest"
import {
  TrpcLogger,
  TrpcLoggerDev,
  TrpcLoggerLive,
  TrpcLoggerSilent,
  generateRequestId,
  logMutation,
  logQuery,
  makeTrpcLoggerLayer,
  redactSensitiveData
} from "../shared/logging.js"

describe("TrpcLogger", () => {
  describe("redactSensitiveData", () => {
    const defaultRedactFields = ["password", "token", "secret", "apiKey"]
    const maxDepth = 3
    const maxStringLength = 100

    it("redacts sensitive fields", () => {
      const data = {
        username: "alice",
        password: "secret123",
        token: "abc123",
        normal: "value",
      }

      const result = redactSensitiveData(data, defaultRedactFields, maxDepth, maxStringLength)

      expect(result).toEqual({
        username: "alice",
        password: "[REDACTED]",
        token: "[REDACTED]",
        normal: "value",
      })
    })

    it("handles nested objects", () => {
      const data = {
        user: {
          name: "alice",
          credentials: {
            password: "secret",
          },
        },
      }

      const result = redactSensitiveData(data, defaultRedactFields, maxDepth, maxStringLength)

      expect(result).toEqual({
        user: {
          name: "alice",
          credentials: {
            password: "[REDACTED]",
          },
        },
      })
    })

    it("truncates long strings", () => {
      const data = {
        content: "a".repeat(150),
      }

      const result = redactSensitiveData(data, defaultRedactFields, maxDepth, maxStringLength) as { content: string }

      expect(result.content).toContain("... [truncated")
      expect(result.content.length).toBeLessThan(150)
    })

    it("respects max depth", () => {
      const data = {
        level1: {
          level2: {
            level3: {
              level4: "deep",
            },
          },
        },
      }

      const result = redactSensitiveData(data, defaultRedactFields, 2, maxStringLength)

      expect((result as any).level1.level2).toBe("[MAX_DEPTH]")
    })

    it("handles arrays", () => {
      const data = {
        items: ["token1", "token2"],  // Not a sensitive field name
        users: [{ name: "alice", password: "secret" }],
      }

      // Use depth 5 to ensure we traverse the nested structure
      const result = redactSensitiveData(data, defaultRedactFields, 5, maxStringLength)

      expect(result).toEqual({
        items: ["token1", "token2"],  // Not redacted - field name doesn't match
        users: [{ name: "alice", password: "[REDACTED]" }],
      })
    })

    it("redacts array field if name matches", () => {
      const data = {
        tokens: ["abc", "def"],  // Field name contains "token"
      }

      const result = redactSensitiveData(data, defaultRedactFields, 5, maxStringLength)

      expect(result).toEqual({
        tokens: "[REDACTED]",  // Entire field redacted because field name matches
      })
    })

    it("handles null and undefined", () => {
      expect(redactSensitiveData(null, defaultRedactFields, maxDepth, maxStringLength)).toBe(null)
      expect(redactSensitiveData(undefined, defaultRedactFields, maxDepth, maxStringLength)).toBe(undefined)
    })

    it("handles primitives", () => {
      expect(redactSensitiveData(42, defaultRedactFields, maxDepth, maxStringLength)).toBe(42)
      expect(redactSensitiveData(true, defaultRedactFields, maxDepth, maxStringLength)).toBe(true)
      expect(redactSensitiveData("hello", defaultRedactFields, maxDepth, maxStringLength)).toBe("hello")
    })
  })

  describe("generateRequestId", () => {
    it("generates unique IDs", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId())
      }
      expect(ids.size).toBe(100)
    })

    it("generates string IDs", () => {
      const id = generateRequestId()
      expect(typeof id).toBe("string")
      expect(id.length).toBeGreaterThan(0)
    })
  })

  describe("TrpcLoggerService", () => {
    it("logs query lifecycle", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        return yield* logger.logQuery(
          "user.get",
          { id: 1 },
          Effect.succeed({ name: "Alice" }),
        )
      }).pipe(
        Effect.provide(TrpcLoggerDev),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      const result = await Effect.runPromise(program)

      expect(result).toEqual({ name: "Alice" })
      expect(logs.length).toBe(2) // Start + Success
      expect(logs[0]).toContain("Query")
      expect(logs[0]).toContain("user.get")
      expect(logs[1]).toContain("Query")
      expect(logs[1]).toContain("user.get")
    })

    it("logs query errors", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        return yield* logger.logQuery(
          "user.get",
          { id: 1 },
          Effect.fail(new Error("Not found")),
        )
      }).pipe(
        Effect.provide(TrpcLoggerDev),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await expect(Effect.runPromise(program)).rejects.toThrow()
      expect(logs.length).toBe(2) // Start + Error
      expect(logs[1]).toContain("failed")
    })

    it("logs mutation lifecycle", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        return yield* logger.logMutation(
          "user.create",
          { name: "Bob" },
          Effect.succeed({ id: 1, name: "Bob" }),
        )
      }).pipe(
        Effect.provide(TrpcLoggerDev),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      const result = await Effect.runPromise(program)

      expect(result).toEqual({ id: 1, name: "Bob" })
      expect(logs.length).toBe(2)
      expect(logs[0]).toContain("Mutation")
    })

    it("respects log level configuration", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      // Silent logger should produce no logs
      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        return yield* logger.logQuery(
          "user.get",
          { id: 1 },
          Effect.succeed({ name: "Alice" }),
        )
      }).pipe(
        Effect.provide(TrpcLoggerSilent),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)
      expect(logs.length).toBe(0)
    })

    it("can disable specific categories", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const customLogger = makeTrpcLoggerLayer({
        disabledCategories: ["query"],
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        // This should not log
        yield* logger.logQuery("user.get", { id: 1 }, Effect.succeed({}))
        // This should log
        yield* logger.log({ _tag: "WebSocketConnect", clientId: "client1" })
      }).pipe(
        Effect.provide(customLogger),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)
      
      // Only the WebSocket event should be logged
      const queryLogs = logs.filter(l => l.includes("Query"))
      const wsLogs = logs.filter(l => l.includes("WebSocket"))
      
      expect(queryLogs.length).toBe(0)
      expect(wsLogs.length).toBe(1)
    })
  })

  describe("convenience functions", () => {
    it("logQuery works with TrpcLogger service", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const result = await Effect.runPromise(
        logQuery("test.proc", { input: 1 }, Effect.succeed("result")).pipe(
          Effect.provide(TrpcLoggerLive),
          Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
        ),
      )

      expect(result).toBe("result")
      expect(logs.length).toBeGreaterThan(0)
    })

    it("logMutation works with TrpcLogger service", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const result = await Effect.runPromise(
        logMutation("test.proc", { input: 1 }, Effect.succeed("result")).pipe(
          Effect.provide(TrpcLoggerLive),
          Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
        ),
      )

      expect(result).toBe("result")
      expect(logs.length).toBeGreaterThan(0)
    })
  })

  describe("WebSocket events", () => {
    it("logs WebSocket connect", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        yield* logger.logWebSocketConnect("client-123", "127.0.0.1")
      }).pipe(
        Effect.provide(TrpcLoggerLive),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain("WebSocket")
      expect(logs[0]).toContain("connected")
      expect(logs[0]).toContain("client-123")
    })

    it("logs WebSocket disconnect", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        yield* logger.logWebSocketDisconnect("client-123", 1000, "Normal closure", 5000)
      }).pipe(
        Effect.provide(TrpcLoggerLive),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain("disconnected")
    })

    it("logs WebSocket auth", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        yield* logger.logWebSocketAuth("client-123", true, "user-456", 50)
      }).pipe(
        Effect.provide(TrpcLoggerLive),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain("auth")
      expect(logs[0]).toContain("success")
    })
  })

  describe("stream events", () => {
    it("logs stream lifecycle", async () => {
      const logs: string[] = []
      const testLogger = Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message))
      })

      // Use custom layer that enables Debug level and all categories
      const testLoggerLayer = makeTrpcLoggerLayer({
        level: LogLevel.Debug,
        includeInput: true,
      })

      const program = Effect.gen(function* () {
        const logger = yield* TrpcLogger
        const requestId = "req-123"
        yield* logger.logStreamStart("chat.stream", { prompt: "Hello" }, requestId)
        yield* logger.logStreamData("chat.stream", 0, requestId)
        yield* logger.logStreamData("chat.stream", 1, requestId)
        yield* logger.logStreamComplete("chat.stream", 2, 1000, requestId)
      }).pipe(
        Effect.provide(testLoggerLayer),
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      )

      await Effect.runPromise(program)

      // StreamStart (Info), StreamData (Debug x2), StreamComplete (Info)
      expect(logs.length).toBe(4)
      expect(logs[0]).toContain("Stream")
      expect(logs[0]).toContain("started")
      expect(logs[3]).toContain("complete")
    })
  })
})
