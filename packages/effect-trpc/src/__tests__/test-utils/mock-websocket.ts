/**
 * @module effect-trpc/tests/test-utils/mock-websocket
 *
 * Complete WebSocket mock for testing browser-like WebSocket behavior.
 * Implements the full W3C WebSocket API including:
 * - Static ready state constants
 * - readyState property with proper state transitions
 * - bufferedAmount tracking
 * - protocol, extensions, binaryType properties
 * - Event listeners (addEventListener, removeEventListener, on* properties)
 * - Helper methods for simulating server behavior in tests
 */

export type WebSocketEventMap = {
  open: Event
  close: CloseEvent
  message: MessageEvent
  error: Event
}

export type WebSocketReadyState = 0 | 1 | 2 | 3

/**
 * Complete MockWebSocket implementation following W3C WebSocket API.
 * Use this for testing browser-like WebSocket behavior without a real server.
 */
export class MockWebSocket {
  // Static ready state constants (W3C WebSocket API)
  static readonly CONNECTING = 0 as const
  static readonly OPEN = 1 as const
  static readonly CLOSING = 2 as const
  static readonly CLOSED = 3 as const

  // Instance ready state constants (for compatibility)
  readonly CONNECTING = 0 as const
  readonly OPEN = 1 as const
  readonly CLOSING = 2 as const
  readonly CLOSED = 3 as const

  // Core properties
  readyState: WebSocketReadyState = MockWebSocket.CONNECTING
  bufferedAmount: number = 0
  protocol: string = ""
  extensions: string = ""
  binaryType: BinaryType = "blob"
  url: string

  // Event handler properties (on* style)
  onopen: ((this: MockWebSocket, ev: Event) => any) | null = null
  onclose: ((this: MockWebSocket, ev: CloseEvent) => any) | null = null
  onmessage: ((this: MockWebSocket, ev: MessageEvent) => any) | null = null
  onerror: ((this: MockWebSocket, ev: Event) => any) | null = null

  // Internal listener storage
  private _listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  
  // Track sent messages for test assertions
  private _sentMessages: Array<string | ArrayBuffer | Blob> = []
  
  // Configuration
  private _autoConnect: boolean
  private _connectDelayMs: number

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = typeof url === "string" ? url : url.toString()
    
    // Handle protocols
    if (protocols) {
      this.protocol = Array.isArray(protocols) ? protocols[0] ?? "" : protocols
    }

    // Default configuration - auto connect after microtask
    this._autoConnect = true
    this._connectDelayMs = 0

    // Schedule connection (simulates async WebSocket handshake)
    if (this._autoConnect) {
      this._scheduleConnect()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // W3C WebSocket API Methods
  // ─────────────────────────────────────────────────────────────────────────────

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (this.readyState === MockWebSocket.CONNECTING) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        "InvalidStateError"
      )
    }
    
    if (this.readyState !== MockWebSocket.OPEN) {
      // WebSocket spec says to silently ignore sends when not OPEN
      // but track bufferedAmount for testing
      return
    }

    // Track buffered amount
    const byteLength = this._getByteLength(data)
    this.bufferedAmount += byteLength
    
    // Store for test assertions
    this._sentMessages.push(data as string | ArrayBuffer | Blob)

    // Simulate async send (buffer is cleared after "send")
    queueMicrotask(() => {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - byteLength)
    })
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) {
      return
    }

    // Validate code if provided
    if (code !== undefined) {
      if (code !== 1000 && (code < 3000 || code > 4999)) {
        throw new DOMException(
          `Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
          "InvalidAccessError"
        )
      }
    }

    // Validate reason length
    if (reason !== undefined) {
      const encoder = new TextEncoder()
      if (encoder.encode(reason).length > 123) {
        throw new DOMException(
          "Failed to execute 'close' on 'WebSocket': The message must not be greater than 123 bytes.",
          "SyntaxError"
        )
      }
    }

    this.readyState = MockWebSocket.CLOSING

    // Simulate async close
    queueMicrotask(() => {
      this.readyState = MockWebSocket.CLOSED
      this._emit("close", this._createCloseEvent(code ?? 1000, reason ?? "", true))
    })
  }

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: MockWebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set())
    }
    this._listeners.get(type)!.add(listener)
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: MockWebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {
    this._listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    this._emit(event.type, event)
    return !event.defaultPrevented
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Helper Methods (prefixed with __ to avoid conflicts)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Simulate receiving a message from the server.
   */
  __simulateMessage(data: string | ArrayBuffer | Blob): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      return // Silently ignore if not open
    }
    this._emit("message", this._createMessageEvent(data))
  }

  /**
   * Simulate a connection error from the server.
   */
  __simulateError(error?: Error): void {
    const event = new Event("error")
    ;(event as any).error = error
    this._emit("error", event)
  }

  /**
   * Simulate the server closing the connection.
   */
  __simulateServerClose(code: number = 1000, reason: string = "", wasClean: boolean = true): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return
    }
    this.readyState = MockWebSocket.CLOSED
    this._emit("close", this._createCloseEvent(code, reason, wasClean))
  }

  /**
   * Manually trigger the open event (for manual connection control).
   */
  __simulateOpen(): void {
    if (this.readyState !== MockWebSocket.CONNECTING) {
      return
    }
    this.readyState = MockWebSocket.OPEN
    this._emit("open", new Event("open"))
  }

  /**
   * Get all messages sent via send().
   */
  __getSentMessages(): ReadonlyArray<string | ArrayBuffer | Blob> {
    return [...this._sentMessages]
  }

  /**
   * Clear sent messages history.
   */
  __clearSentMessages(): void {
    this._sentMessages = []
  }

  /**
   * Get the last sent message.
   */
  __getLastSentMessage(): string | ArrayBuffer | Blob | undefined {
    return this._sentMessages[this._sentMessages.length - 1]
  }

  /**
   * Get sent messages as parsed JSON objects.
   */
  __getSentMessagesAsJson<T = unknown>(): T[] {
    return this._sentMessages
      .filter((m): m is string => typeof m === "string")
      .map((m) => JSON.parse(m) as T)
  }

  /**
   * Configure auto-connect behavior (call before constructor or use factory).
   */
  static createWithOptions(
    url: string | URL,
    options: {
      protocols?: string | string[]
      autoConnect?: boolean
      connectDelayMs?: number
    } = {}
  ): MockWebSocket {
    const ws = new MockWebSocket(url, options.protocols)
    ws._autoConnect = options.autoConnect ?? true
    ws._connectDelayMs = options.connectDelayMs ?? 0
    
    if (!ws._autoConnect) {
      // Reset to CONNECTING if auto-connect was disabled after construction
      ws.readyState = MockWebSocket.CONNECTING
    }
    
    return ws
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private _scheduleConnect(): void {
    const connect = () => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN
        this._emit("open", new Event("open"))
      }
    }

    if (this._connectDelayMs > 0) {
      setTimeout(connect, this._connectDelayMs)
    } else {
      queueMicrotask(connect)
    }
  }

  private _emit(type: string, event: Event): void {
    // Call on* handler first
    const handler = (this as any)[`on${type}`]
    if (typeof handler === "function") {
      try {
        handler.call(this, event)
      } catch (e) {
        console.error(`Error in on${type} handler:`, e)
      }
    }

    // Then call addEventListener listeners
    const listeners = this._listeners.get(type)
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          if (typeof listener === "function") {
            listener.call(this, event)
          } else {
            listener.handleEvent(event)
          }
        } catch (e) {
          console.error(`Error in ${type} listener:`, e)
        }
      })
    }
  }

  private _createMessageEvent(data: string | ArrayBuffer | Blob): MessageEvent {
    return new MessageEvent("message", {
      data,
      origin: new URL(this.url).origin,
      lastEventId: "",
      source: null,
      ports: [],
    })
  }

  private _createCloseEvent(code: number, reason: string, wasClean: boolean): CloseEvent {
    return new CloseEvent("close", {
      code,
      reason,
      wasClean,
    })
  }

  private _getByteLength(data: string | ArrayBuffer | Blob | ArrayBufferView): number {
    if (typeof data === "string") {
      return new TextEncoder().encode(data).length
    }
    if (data instanceof ArrayBuffer) {
      return data.byteLength
    }
    if (data instanceof Blob) {
      return data.size
    }
    if (ArrayBuffer.isView(data)) {
      return data.byteLength
    }
    return 0
  }
}

/**
 * Install MockWebSocket as the global WebSocket for testing.
 * Returns a cleanup function to restore the original.
 */
export function installMockWebSocket(): () => void {
  const originalWebSocket = globalThis.WebSocket
  const originalWindowWebSocket = typeof window !== "undefined" ? window.WebSocket : undefined
  const originalGlobalWebSocket = typeof global !== "undefined" ? (global as any).WebSocket : undefined

  // Install mock
  ;(globalThis as any).WebSocket = MockWebSocket
  if (typeof window !== "undefined") {
    ;(window as any).WebSocket = MockWebSocket
  }
  if (typeof global !== "undefined") {
    ;(global as any).WebSocket = MockWebSocket
  }

  // Return cleanup function
  return () => {
    ;(globalThis as any).WebSocket = originalWebSocket
    if (typeof window !== "undefined" && originalWindowWebSocket !== undefined) {
      ;(window as any).WebSocket = originalWindowWebSocket
    }
    if (typeof global !== "undefined" && originalGlobalWebSocket !== undefined) {
      ;(global as any).WebSocket = originalGlobalWebSocket
    }
  }
}

/**
 * Create a MockWebSocket that wraps a real Node.js WebSocket for integration tests.
 * This allows intercepting messages while maintaining real connection behavior.
 * 
 * Note: This function creates a class that extends the Node.js ws WebSocket
 * and adds browser-compatible properties and test helpers.
 */
export function createWrappedMockWebSocket(
  NodeWebSocket: new (url: string, protocols?: string | string[]) => any
): new (url: string, protocols?: string | string[]) => any {
  class WrappedMockWebSocket extends NodeWebSocket {
    // Add standard WebSocket API properties as static members
    static readonly CONNECTING = 0 as const
    static readonly OPEN = 1 as const
    static readonly CLOSING = 2 as const
    static readonly CLOSED = 3 as const

    // Track additional properties not in Node ws
    private _bufferedAmount: number = 0
    private _protocol: string = ""
    private _sentMessages: Array<string | ArrayBuffer> = []

    get bufferedAmount(): number {
      return this._bufferedAmount
    }

    get protocol(): string {
      return this._protocol
    }

    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols)
      
      if (protocols) {
        this._protocol = Array.isArray(protocols) ? protocols[0] ?? "" : protocols
      }

      // Set up event forwarding for browser-style handlers
      // Using bracket notation for indexed properties
      ;(this as any)["on"]("close", (code: number, reason: Buffer) => {
        if ((this as any).onclose) {
          ;(this as any).onclose({ code, reason: reason?.toString() ?? "" })
        }
      })

      ;(this as any)["on"]("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        if ((this as any).onmessage) {
          const str = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : data instanceof ArrayBuffer
              ? new TextDecoder().decode(data)
              : Array.isArray(data)
                ? Buffer.concat(data).toString("utf8")
                : String(data)
          ;(this as any).onmessage({ data: str })
        }
      })

      ;(this as any)["on"]("error", (error: Error) => {
        if ((this as any).onerror) {
          ;(this as any).onerror({ error })
        }
      })

      ;(this as any)["on"]("open", () => {
        if ((this as any).onopen) {
          ;(this as any).onopen({})
        }
      })
    }

    send(data: any, cb?: (err?: Error) => void): void
    send(data: any, options: any, cb?: (err?: Error) => void): void
    send(data: any, optionsOrCb?: any, cb?: (err?: Error) => void): void {
      // Track buffered amount
      const byteLength =
        typeof data === "string"
          ? Buffer.byteLength(data, "utf8")
          : data instanceof ArrayBuffer
            ? data.byteLength
            : Buffer.isBuffer(data)
              ? data.length
              : 0

      this._bufferedAmount += byteLength
      this._sentMessages.push(data)

      const callback = typeof optionsOrCb === "function" ? optionsOrCb : cb
      const options = typeof optionsOrCb === "object" ? optionsOrCb : undefined

      const wrappedCallback = (err?: Error) => {
        this._bufferedAmount = Math.max(0, this._bufferedAmount - byteLength)
        callback?.(err)
      }

      if (options) {
        ;(this as any)["send"].call(this, data, options, wrappedCallback)
      } else {
        // Call parent send using prototype chain
        NodeWebSocket.prototype.send.call(this, data, wrappedCallback)
      }
    }

    __getSentMessages(): ReadonlyArray<string | ArrayBuffer> {
      return [...this._sentMessages]
    }

    __clearSentMessages(): void {
      this._sentMessages = []
    }

    __getSentMessagesAsJson<T = unknown>(): T[] {
      return this._sentMessages
        .filter((m): m is string => typeof m === "string")
        .map((m) => JSON.parse(m) as T)
    }
  }

  return WrappedMockWebSocket as any
}
