/**
 * @module effect-trpc/tests/mock-websocket
 *
 * Tests for the MockWebSocket test utility.
 * Verifies that the mock correctly implements the W3C WebSocket API.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { MockWebSocket, installMockWebSocket } from "./test-utils/index.js"

// Helper to wait for async operations
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe("MockWebSocket", () => {
  describe("static constants", () => {
    it("has correct ready state constants", () => {
      expect(MockWebSocket.CONNECTING).toBe(0)
      expect(MockWebSocket.OPEN).toBe(1)
      expect(MockWebSocket.CLOSING).toBe(2)
      expect(MockWebSocket.CLOSED).toBe(3)
    })
  })

  describe("instance constants", () => {
    it("has correct ready state constants on instance", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      expect(ws.CONNECTING).toBe(0)
      expect(ws.OPEN).toBe(1)
      expect(ws.CLOSING).toBe(2)
      expect(ws.CLOSED).toBe(3)
    })
  })

  describe("connection lifecycle", () => {
    it("starts in CONNECTING state", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING)
    })

    it("auto-connects and transitions to OPEN", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING)
      
      await tick()
      
      expect(ws.readyState).toBe(MockWebSocket.OPEN)
    })

    it("fires open event when connected", async () => {
      const onOpen = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onopen = onOpen
      
      await tick()
      
      expect(onOpen).toHaveBeenCalledTimes(1)
      expect(onOpen.mock.calls[0][0]).toBeInstanceOf(Event)
    })

    it("transitions through CLOSING to CLOSED on close()", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.close()
      expect(ws.readyState).toBe(MockWebSocket.CLOSING)
      
      await tick()
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    })

    it("fires close event with correct code and reason", async () => {
      const onClose = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onclose = onClose
      
      await tick()
      ws.close(1000, "Normal closure")
      await tick()
      
      expect(onClose).toHaveBeenCalledTimes(1)
      const event = onClose.mock.calls[0][0] as CloseEvent
      expect(event.code).toBe(1000)
      expect(event.reason).toBe("Normal closure")
      expect(event.wasClean).toBe(true)
    })
  })

  describe("properties", () => {
    it("stores url", () => {
      const ws = new MockWebSocket("ws://localhost:8080/path")
      expect(ws.url).toBe("ws://localhost:8080/path")
    })

    it("handles URL object", () => {
      const ws = new MockWebSocket(new URL("ws://localhost:8080/path"))
      expect(ws.url).toBe("ws://localhost:8080/path")
    })

    it("stores protocol from string", () => {
      const ws = new MockWebSocket("ws://localhost:8080", "my-protocol")
      expect(ws.protocol).toBe("my-protocol")
    })

    it("stores first protocol from array", () => {
      const ws = new MockWebSocket("ws://localhost:8080", ["proto1", "proto2"])
      expect(ws.protocol).toBe("proto1")
    })

    it("has default binaryType of blob", () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      expect(ws.binaryType).toBe("blob")
    })

    it("allows setting binaryType", () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.binaryType = "arraybuffer"
      expect(ws.binaryType).toBe("arraybuffer")
    })

    it("has empty extensions by default", () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      expect(ws.extensions).toBe("")
    })

    it("starts with bufferedAmount of 0", () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      expect(ws.bufferedAmount).toBe(0)
    })
  })

  describe("send()", () => {
    it("throws when in CONNECTING state", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      
      expect(() => ws.send("test")).toThrow("Still in CONNECTING state")
    })

    it("sends string data when OPEN", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.send("hello")
      expect(ws.__getSentMessages()).toEqual(["hello"])
    })

    it("sends ArrayBuffer data", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      const buffer = new ArrayBuffer(4)
      ws.send(buffer)
      expect(ws.__getSentMessages()).toEqual([buffer])
    })

    it("tracks bufferedAmount", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.send("hello") // 5 bytes
      expect(ws.bufferedAmount).toBe(5)
      
      await tick()
      expect(ws.bufferedAmount).toBe(0)
    })

    it("silently ignores sends when CLOSING", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.close()
      expect(ws.readyState).toBe(MockWebSocket.CLOSING)
      
      ws.send("ignored")
      expect(ws.__getSentMessages()).toEqual([])
    })
  })

  describe("close()", () => {
    it("validates close code 1000", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      expect(() => ws.close(1000)).not.toThrow()
    })

    it("throws for invalid close codes", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.__simulateOpen()
      
      expect(() => ws.close(1001)).toThrow()
    })

    it("allows codes 3000-4999", async () => {
      const ws1 = new MockWebSocket("ws://localhost:8080")
      await tick()
      expect(() => ws1.close(3000)).not.toThrow()
      
      const ws2 = new MockWebSocket("ws://localhost:8080")
      await tick()
      expect(() => ws2.close(4999)).not.toThrow()
    })

    it("is idempotent when already closed", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.close()
      await tick()
      
      ws.close()
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    })
  })

  describe("event listeners", () => {
    it("supports addEventListener", async () => {
      const listener = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.addEventListener("open", listener)
      
      await tick()
      
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("supports removeEventListener", () => {
      const listener = vi.fn()
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      ws.addEventListener("open", listener)
      ws.removeEventListener("open", listener)
      
      ws.__simulateOpen()
      
      expect(listener).not.toHaveBeenCalled()
    })

    it("calls both on* and addEventListener handlers", async () => {
      const onOpen = vi.fn()
      const listener = vi.fn()
      
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onopen = onOpen
      ws.addEventListener("open", listener)
      
      await tick()
      
      expect(onOpen).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("supports dispatchEvent", () => {
      const listener = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      // Use a generic addEventListener for custom events
      ;(ws as any).addEventListener("custom", listener)
      
      ws.dispatchEvent(new Event("custom"))
      
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe("test helpers", () => {
    it("__simulateMessage fires message event", async () => {
      const onMessage = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onmessage = onMessage
      await tick()
      
      ws.__simulateMessage('{"test": "data"}')
      
      expect(onMessage).toHaveBeenCalledTimes(1)
      const event = onMessage.mock.calls[0][0] as MessageEvent
      expect(event.data).toBe('{"test": "data"}')
    })

    it("__simulateMessage ignores when not OPEN", () => {
      const onMessage = vi.fn()
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      ws.onmessage = onMessage
      
      ws.__simulateMessage("ignored")
      
      expect(onMessage).not.toHaveBeenCalled()
    })

    it("__simulateError fires error event", () => {
      const onError = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onerror = onError
      
      const error = new Error("test error")
      ws.__simulateError(error)
      
      expect(onError).toHaveBeenCalledTimes(1)
    })

    it("__simulateServerClose transitions to CLOSED", async () => {
      const onClose = vi.fn()
      const ws = new MockWebSocket("ws://localhost:8080")
      ws.onclose = onClose
      await tick()
      
      ws.__simulateServerClose(1001, "Going away", false)
      
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
      expect(onClose).toHaveBeenCalledTimes(1)
      const event = onClose.mock.calls[0][0] as CloseEvent
      expect(event.code).toBe(1001)
      expect(event.reason).toBe("Going away")
      expect(event.wasClean).toBe(false)
    })

    it("__simulateOpen transitions to OPEN", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING)
      
      ws.__simulateOpen()
      
      expect(ws.readyState).toBe(MockWebSocket.OPEN)
    })

    it("__getSentMessages returns copy of sent messages", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.send("msg1")
      ws.send("msg2")
      
      const messages = ws.__getSentMessages()
      expect(messages).toEqual(["msg1", "msg2"])
      
      ws.send("msg3")
      expect(messages).toEqual(["msg1", "msg2"])
    })

    it("__clearSentMessages clears history", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.send("msg1")
      ws.__clearSentMessages()
      
      expect(ws.__getSentMessages()).toEqual([])
    })

    it("__getLastSentMessage returns last message", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      expect(ws.__getLastSentMessage()).toBeUndefined()
      
      ws.send("msg1")
      ws.send("msg2")
      
      expect(ws.__getLastSentMessage()).toBe("msg2")
    })

    it("__getSentMessagesAsJson parses JSON messages", async () => {
      const ws = new MockWebSocket("ws://localhost:8080")
      await tick()
      
      ws.send('{"type": "subscribe", "id": 1}')
      ws.send('{"type": "unsubscribe", "id": 2}')
      
      const messages = ws.__getSentMessagesAsJson<{ type: string; id: number }>()
      expect(messages).toEqual([
        { type: "subscribe", id: 1 },
        { type: "unsubscribe", id: 2 },
      ])
    })
  })

  describe("createWithOptions", () => {
    it("creates with autoConnect disabled", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { autoConnect: false })
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING)
    })

    it("creates with custom protocols", () => {
      const ws = MockWebSocket.createWithOptions("ws://localhost:8080", { 
        protocols: ["my-protocol"],
        autoConnect: false 
      })
      expect(ws.protocol).toBe("my-protocol")
    })
  })
})

describe("installMockWebSocket", () => {
  let cleanup: (() => void) | undefined

  afterEach(() => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }
  })

  it("installs MockWebSocket globally", () => {
    cleanup = installMockWebSocket()
    
    expect(globalThis.WebSocket).toBe(MockWebSocket)
  })

  it("cleanup restores original WebSocket", () => {
    const originalWebSocket = globalThis.WebSocket
    cleanup = installMockWebSocket()
    
    expect(globalThis.WebSocket).toBe(MockWebSocket)
    
    cleanup()
    cleanup = undefined
    
    expect(globalThis.WebSocket).toBe(originalWebSocket)
  })
})
