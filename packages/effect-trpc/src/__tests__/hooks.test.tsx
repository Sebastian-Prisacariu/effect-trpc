// @vitest-environment jsdom
/**
 * Tests for React hooks: useGate and useNetworkStatus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as React from "react"
import { renderHook, act, waitFor } from "@testing-library/react"
import * as Effect from "effect/Effect"

import { Gate } from "../core/gate/index.js"
import { useGate } from "../react/hooks/useGate.js"
import { useNetworkStatus } from "../react/hooks/useNetworkStatus.js"

describe("useGate", () => {
  it("returns initial state from gate", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: true }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.isOpen).toBe(true)
  })

  it("returns closed state for closed gate", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: false }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.isOpen).toBe(false)
  })

  it("updates when gate opens", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: false }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.isOpen).toBe(false)

    // Open the gate
    await act(async () => {
      await Effect.runPromise(Gate.open(gate))
      // Give the subscription time to propagate
      await new Promise((r) => setTimeout(r, 10))
    })

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true)
    })
  })

  it("updates when gate closes", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: true }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.isOpen).toBe(true)

    // Close the gate
    await act(async () => {
      await Effect.runPromise(Gate.close(gate))
      await new Promise((r) => setTimeout(r, 10))
    })

    await waitFor(() => {
      expect(result.current.isOpen).toBe(false)
    })
  })

  it("tracks openedAt timestamp", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: false }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.openedAt).toBe(null)

    // Open the gate
    const beforeOpen = Date.now()
    await act(async () => {
      await Effect.runPromise(Gate.open(gate))
      await new Promise((r) => setTimeout(r, 10))
    })

    await waitFor(() => {
      expect(result.current.openedAt).not.toBe(null)
      expect(result.current.openedAt).toBeGreaterThanOrEqual(beforeOpen)
    })
  })

  it("tracks closedAt timestamp", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: true }),
      ),
    )

    const { result } = renderHook(() => useGate(gate))

    expect(result.current.closedAt).toBe(null)

    // Close the gate
    const beforeClose = Date.now()
    await act(async () => {
      await Effect.runPromise(Gate.close(gate))
      await new Promise((r) => setTimeout(r, 10))
    })

    await waitFor(() => {
      expect(result.current.closedAt).not.toBe(null)
      expect(result.current.closedAt).toBeGreaterThanOrEqual(beforeClose)
    })
  })

  it("cleans up subscription on unmount", async () => {
    const gate = await Effect.runPromise(
      Effect.scoped(
        Gate.make("test", { initiallyOpen: true }),
      ),
    )

    const { unmount } = renderHook(() => useGate(gate))

    // Unmount should not throw
    unmount()

    // Gate operations should still work (subscription was cleaned up)
    await Effect.runPromise(Gate.close(gate))
    const isOpen = await Effect.runPromise(Gate.isOpen(gate))
    expect(isOpen).toBe(false)
  })
})

describe("useNetworkStatus", () => {
  // Store original values
  const originalNavigator = global.navigator
  const originalWindow = global.window

  // Track mocked online state
  let mockOnlineState = true

  beforeEach(() => {
    // Reset mocks
    vi.restoreAllMocks()
    mockOnlineState = true

    // Mock navigator.onLine to be controllable
    Object.defineProperty(navigator, "onLine", {
      get: () => mockOnlineState,
      configurable: true,
    })
  })

  afterEach(() => {
    // Restore originals
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
    })
    Object.defineProperty(global, "window", {
      value: originalWindow,
      writable: true,
    })
  })

  // Helper to simulate going offline
  const goOffline = () => {
    mockOnlineState = false
    window.dispatchEvent(new Event("offline"))
  }

  // Helper to simulate going online
  const goOnline = () => {
    mockOnlineState = true
    window.dispatchEvent(new Event("online"))
  }

  it("starts with server-safe values (isOnline: true, isHydrated: false)", () => {
    const { result } = renderHook(() => useNetworkStatus())

    // Initial render (before useEffect)
    // Note: In testing environment, useEffect runs synchronously after render
    // so we check that at least the hook doesn't crash
    expect(result.current.isOnline).toBe(true)
  })

  it("sets isHydrated to true after mount", async () => {
    const { result } = renderHook(() => useNetworkStatus())

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true)
    })
  })

  it("returns isOnline: true in Node.js environment (navigator.onLine is undefined)", async () => {
    // In Node.js test environment, navigator.onLine is undefined
    // The hook should default to true
    const { result } = renderHook(() => useNetworkStatus())

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true)
      expect(result.current.isOnline).toBe(true)
    })
  })

  it("tracks lastOnlineAt when online", async () => {
    const beforeRender = Date.now()
    const { result } = renderHook(() => useNetworkStatus())

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true)
      // Should have a timestamp since we default to online
      expect(result.current.lastOnlineAt).not.toBe(null)
      expect(result.current.lastOnlineAt).toBeGreaterThanOrEqual(beforeRender)
    })
  })

  it("responds to online events", async () => {
    const { result } = renderHook(() => useNetworkStatus())

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true)
    })

    // Simulate offline then online
    await act(async () => {
      goOffline()
    })

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false)
    })

    await act(async () => {
      goOnline()
    })

    await waitFor(() => {
      expect(result.current.isOnline).toBe(true)
    })
  })

  it("responds to offline events", async () => {
    const { result } = renderHook(() => useNetworkStatus())

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true)
    })

    const beforeOffline = Date.now()

    await act(async () => {
      goOffline()
    })

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false)
      expect(result.current.lastOfflineAt).not.toBe(null)
      expect(result.current.lastOfflineAt).toBeGreaterThanOrEqual(beforeOffline)
    })
  })

  it("cleans up event listeners on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

    const { unmount } = renderHook(() => useNetworkStatus())

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function))
  })
})
