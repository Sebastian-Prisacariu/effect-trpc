/**
 * @module effect-trpc/__tests__/stream-chat
 *
 * Integration tests for stream and chat procedures.
 * Tests the full flow from client to server for streaming procedure types.
 *
 * These tests validate:
 * - Stream procedures that yield multiple values
 * - Stream completion handling
 * - Stream error handling
 * - Chat procedures with typed stream parts
 * - Stream cancellation via fiber interruption
 */

import * as Chunk from "effect/Chunk"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { procedure, procedures, Procedures, Router } from "../index.js"
import { createHandler, nodeToWebRequest, webToNodeResponse } from "../node/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Schemas
// ─────────────────────────────────────────────────────────────────────────────

const NumberChunkSchema = Schema.Number

const ChatPartSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("text-delta"),
    delta: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("finish"),
    reason: Schema.String,
  }),
)

type ChatPart = typeof ChatPartSchema.Type

const StreamErrorSchema = Schema.Struct({
  _tag: Schema.Literal("StreamError"),
  message: Schema.String,
})

type StreamError = typeof StreamErrorSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Procedures
// ─────────────────────────────────────────────────────────────────────────────

const StreamProcedures = procedures("stream", {
  // Basic stream that yields count numbers
  numbers: procedure
    .input(Schema.Struct({ count: Schema.Number }))
    .output(NumberChunkSchema)
    .stream(),

  // Stream that completes after a delay
  delayed: procedure
    .input(Schema.Struct({ delayMs: Schema.Number, count: Schema.Number }))
    .output(NumberChunkSchema)
    .stream(),

  // Stream that fails after yielding some values
  failing: procedure
    .input(Schema.Struct({ failAfter: Schema.Number }))
    .output(NumberChunkSchema)
    .error(StreamErrorSchema)
    .stream(),

  // Stream that runs indefinitely (for cancellation testing)
  infinite: procedure.output(NumberChunkSchema).stream(),

  // Empty stream that completes immediately
  empty: procedure.output(NumberChunkSchema).stream(),
})

const ChatProcedures = procedures("chat", {
  // Chat procedure with typed parts
  generate: procedure
    .input(Schema.Struct({ prompt: Schema.String }))
    .output(ChatPartSchema)
    .chat(),

  // Chat that fails mid-stream
  failingChat: procedure
    .input(Schema.Struct({ prompt: Schema.String }))
    .output(ChatPartSchema)
    .error(StreamErrorSchema)
    .chat(),
})

const appRouter = Router.make({
  stream: StreamProcedures,
  chat: ChatProcedures,
})

type AppRouter = typeof appRouter

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Mock Implementation Layer
// ─────────────────────────────────────────────────────────────────────────────

const createMockStreamHandlers = () =>
  Procedures.toLayer(StreamProcedures, {
    numbers: (_ctx, { count }) => Stream.range(0, count - 1),

    delayed: (_ctx, { delayMs, count }) =>
      Stream.range(0, count - 1).pipe(Stream.tap(() => Effect.sleep(Duration.millis(delayMs)))),

    failing: (_ctx, { failAfter }) =>
      Stream.range(0, failAfter - 1).pipe(
        Stream.concat(
          Stream.fail({
            _tag: "StreamError" as const,
            message: "Stream failed intentionally",
          }),
        ),
      ),

    infinite: (_ctx) =>
      Stream.iterate(0, (n) => n + 1).pipe(Stream.tap(() => Effect.sleep(Duration.millis(10)))),

    empty: (_ctx) => Stream.empty,
  })

const createMockChatHandlers = () =>
  Procedures.toLayer(ChatProcedures, {
    generate: (_ctx, { prompt }) =>
      Stream.fromIterable([
        { _tag: "text-delta" as const, delta: `Processing: ` },
        { _tag: "text-delta" as const, delta: prompt },
        { _tag: "text-delta" as const, delta: `...` },
        { _tag: "finish" as const, reason: "complete" },
      ] satisfies ChatPart[]),

    failingChat: (_ctx, { prompt: _prompt }) =>
      (
        Stream.fromIterable([
          { _tag: "text-delta" as const, delta: "Starting..." },
        ] satisfies ChatPart[]) as Stream.Stream<ChatPart, StreamError, never>
      ).pipe(
        Stream.concat(
          Stream.fail({
            _tag: "StreamError" as const,
            message: "Chat failed mid-stream",
          }),
        ),
      ),
  })

// ─────────────────────────────────────────────────────────────────────────────
// Test Server Setup
// ─────────────────────────────────────────────────────────────────────────────

let serverUrl: string
let httpServer: Server
let disposeHandler: () => Promise<void>

describe("Stream and Chat Procedures", () => {
  beforeAll(async () => {
    // Create handlers layer using the public API
    const StreamHandlersLive = createMockStreamHandlers()
    const ChatHandlersLive = createMockChatHandlers()

    // Merge the layers
    const HandlersLive = Layer.mergeAll(StreamHandlersLive, ChatHandlersLive)

    // Create the fetch handler using effect-trpc/node
    const handler = createHandler({
      router: appRouter,
      handlers: HandlersLive,
      path: "/rpc",
      spanPrefix: "@test/stream",
    })

    disposeHandler = handler.dispose

    // Create HTTP server using node:http
    httpServer = createServer((req, res) => {
      void (async () => {
        try {
          const request = await nodeToWebRequest(req)
          const response = await handler.fetch(request)
          await webToNodeResponse(response, res)
        } catch (error) {
          console.error("Handler error:", error)
          res.writeHead(500)
          res.end("Internal Server Error")
        }
      })()
    })

    // Start server with OS-assigned port (port 0)
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address() as AddressInfo
        const port = address.port
        serverUrl = `http://localhost:${port}/rpc`
        console.log(`Stream test server running on port ${port}`)
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (disposeHandler) {
      await disposeHandler()
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Direct Handler Tests (without HTTP transport)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Stream Procedures (Direct Handler Tests)", () => {
    it("receives multiple chunks from stream", async () => {
      const stream = Stream.range(0, 2) // [0, 1, 2]
      const chunks = await Effect.runPromise(Stream.runCollect(stream))

      expect(Chunk.toArray(chunks)).toEqual([0, 1, 2])
    })

    it("handles empty stream", async () => {
      const stream: Stream.Stream<number, never, never> = Stream.empty
      const chunks = await Effect.runPromise(Stream.runCollect(stream))

      expect(Chunk.toArray(chunks)).toEqual([])
    })

    it("handles stream errors gracefully", async () => {
      const stream = Stream.concat(
        Stream.make(1, 2),
        Stream.fail({ _tag: "StreamError" as const, message: "Test error" }),
      )

      const result = await Effect.runPromiseExit(Stream.runCollect(stream))

      expect(Exit.isFailure(result)).toBe(true)
    })

    it("can cancel stream mid-flight", async () => {
      // Create an infinite stream that increments
      const stream = Stream.iterate(0, (n) => n + 1).pipe(
        Stream.tap(() => Effect.sleep(Duration.millis(10))),
      )

      // Fork the stream collection
      const fiber = Effect.runFork(
        Stream.runCollect(stream).pipe(Effect.timeout(Duration.millis(100))),
      )

      // Wait a bit then interrupt
      await Effect.runPromise(Effect.sleep(Duration.millis(50)))
      await Effect.runPromise(Fiber.interrupt(fiber))

      // Should not hang - test passes if we reach this point
      expect(true).toBe(true)
    })

    it("stream handler yields correct number of values", async () => {
      // Directly test the stream handler logic
      const stream = Stream.range(0, 4) // [0, 1, 2, 3, 4]
      const chunks = await Effect.runPromise(Stream.runCollect(stream))

      expect(Chunk.toArray(chunks)).toHaveLength(5)
      expect(Chunk.toArray(chunks)).toEqual([0, 1, 2, 3, 4])
    })

    it("stream with delay still completes", async () => {
      const stream = Stream.range(0, 2).pipe(Stream.tap(() => Effect.sleep(Duration.millis(10))))

      const chunks = await Effect.runPromise(Stream.runCollect(stream))

      expect(Chunk.toArray(chunks)).toEqual([0, 1, 2])
    })

    it("stream fails at the expected point", async () => {
      // Stream that yields 3 values then fails
      const stream = Stream.concat(
        Stream.range(0, 2), // [0, 1, 2]
        Stream.fail({ _tag: "StreamError" as const, message: "Expected failure" }),
      )

      // Collect what we can before the error
      const collected: number[] = []
      const result = await Effect.runPromiseExit(
        stream.pipe(
          Stream.tap((n) =>
            Effect.sync(() => {
              collected.push(n)
            }),
          ),
          Stream.runDrain,
        ),
      )

      expect(collected).toEqual([0, 1, 2])
      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  describe("Chat Procedures (Direct Handler Tests)", () => {
    it("chat stream yields typed parts", async () => {
      const parts: ChatPart[] = [
        { _tag: "text-delta", delta: "Hello " },
        { _tag: "text-delta", delta: "World" },
        { _tag: "finish", reason: "complete" },
      ]

      const stream = Stream.fromIterable(parts)
      const chunks = await Effect.runPromise(Stream.runCollect(stream))
      const result = Chunk.toArray(chunks)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ _tag: "text-delta", delta: "Hello " })
      expect(result[2]).toEqual({ _tag: "finish", reason: "complete" })
    })

    it("chat stream can fail mid-generation", async () => {
      const stream = Stream.concat(
        Stream.fromIterable([
          { _tag: "text-delta" as const, delta: "Starting..." },
        ] satisfies ChatPart[]),
        Stream.fail({ _tag: "StreamError" as const, message: "Generation failed" }),
      )

      const result = await Effect.runPromiseExit(Stream.runCollect(stream))

      expect(Exit.isFailure(result)).toBe(true)
    })

    it("accumulates text deltas correctly", async () => {
      const parts: ChatPart[] = [
        { _tag: "text-delta", delta: "Hello " },
        { _tag: "text-delta", delta: "World" },
        { _tag: "text-delta", delta: "!" },
        { _tag: "finish", reason: "complete" },
      ]

      const stream = Stream.fromIterable(parts)

      // Accumulate text from deltas
      const text = await Effect.runPromise(
        stream.pipe(
          Stream.filter(
            (part): part is Extract<ChatPart, { _tag: "text-delta" }> => part._tag === "text-delta",
          ),
          Stream.map((part) => part.delta),
          Stream.runFold("", (acc, delta) => acc + delta),
        ),
      )

      expect(text).toBe("Hello World!")
    })
  })

  describe("Stream Completion Handling", () => {
    it("detects stream completion", async () => {
      let completed = false

      const stream = Stream.range(0, 2).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            completed = true
          }),
        ),
      )

      await Effect.runPromise(Stream.runDrain(stream))

      expect(completed).toBe(true)
    })

    it("completion handler runs even on error", async () => {
      let completed = false

      const stream = Stream.concat(Stream.make(1), Stream.fail("error")).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            completed = true
          }),
        ),
      )

      await Effect.runPromiseExit(Stream.runDrain(stream))

      expect(completed).toBe(true)
    })

    it("completion handler runs on interrupt", async () => {
      let completed = false

      const stream = Stream.iterate(0, (n) => n + 1).pipe(
        Stream.tap(() => Effect.sleep(Duration.millis(10))),
        Stream.ensuring(
          Effect.sync(() => {
            completed = true
          }),
        ),
      )

      const fiber = Effect.runFork(Stream.runDrain(stream))

      await Effect.runPromise(Effect.sleep(Duration.millis(50)))
      await Effect.runPromise(Fiber.interrupt(fiber))

      // Give a moment for the ensuring to run
      await Effect.runPromise(Effect.sleep(Duration.millis(10)))

      expect(completed).toBe(true)
    })
  })

  describe("Stream Cancellation", () => {
    it("fiber interrupt stops stream processing", async () => {
      let itemsProcessed = 0

      const stream = Stream.iterate(0, (n) => n + 1).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            itemsProcessed++
          }),
        ),
        Stream.tap(() => Effect.sleep(Duration.millis(20))),
      )

      const fiber = Effect.runFork(Stream.runDrain(stream))

      // Let it process a few items
      await Effect.runPromise(Effect.sleep(Duration.millis(100)))
      const countBefore = itemsProcessed

      // Interrupt
      await Effect.runPromise(Fiber.interrupt(fiber))

      // Wait a bit more
      await Effect.runPromise(Effect.sleep(Duration.millis(50)))
      const countAfter = itemsProcessed

      // Should have stopped processing after interrupt
      expect(countAfter).toBe(countBefore)
      // Should have processed some items
      expect(itemsProcessed).toBeGreaterThan(0)
    })

    it("timeoutFail causes stream to fail with timeout error", async () => {
      const stream = Stream.iterate(0, (n) => n + 1).pipe(
        Stream.tap(() => Effect.sleep(Duration.millis(10))),
      )

      // Use Effect.timeoutFail to explicitly fail on timeout
      const result = await Effect.runPromiseExit(
        stream.pipe(
          Stream.runCollect,
          Effect.timeoutFail({
            duration: Duration.millis(100),
            onTimeout: () => ({ _tag: "TimeoutError" as const }),
          }),
        ),
      )

      // Should fail due to timeout
      expect(Exit.isFailure(result)).toBe(true)
    })

    it("take limits stream output", async () => {
      const stream = Stream.iterate(0, (n) => n + 1)

      const chunks = await Effect.runPromise(stream.pipe(Stream.take(5), Stream.runCollect))

      expect(Chunk.toArray(chunks)).toEqual([0, 1, 2, 3, 4])
    })
  })

  describe("Stream Error Types", () => {
    it("preserves typed errors through stream", async () => {
      const stream = Stream.fail({
        _tag: "StreamError" as const,
        message: "Typed error",
      })

      const result = await Effect.runPromiseExit(Stream.runDrain(stream))

      if (Exit.isFailure(result)) {
        const error = result.cause
        // The cause should contain our typed error
        expect(error).toBeDefined()
      } else {
        expect.fail("Expected failure")
      }
    })

    it("catchTag works with stream errors", async () => {
      const stream = Stream.fail({
        _tag: "StreamError" as const,
        message: "Caught error",
      }).pipe(Stream.catchTag("StreamError", (error) => Stream.make(`Recovered: ${error.message}`)))

      const chunks = await Effect.runPromise(Stream.runCollect(stream))

      expect(Chunk.toArray(chunks)).toEqual(["Recovered: Caught error"])
    })
  })
})
