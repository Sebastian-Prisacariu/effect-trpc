/**
 * @module effect-trpc/react/subscription
 *
 * React hook for WebSocket subscriptions.
 */

import * as Cause from "effect/Cause"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as React from "react"

import { useEvent } from "./internal/hooks.js"
import {
  SubscriptionRegistryLive,
  makeWebSocketClientLayer,
  makeWebSocketConnectionLayer,
  WebSocketClient,
} from "../ws/client/index.js"
import type {
  SubscriptionRegistry,
  WebSocketConnection,
  WebSocketClientConfig,
  ClientState as WsClientState,
} from "../ws/client/index.js"
import type { SubscriptionId } from "../ws/types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Subscription State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State of a subscription, generic over error type.
 *
 * @since 0.1.0
 * @category models
 */
export type SubscriptionState<E = unknown> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Subscribing" }
  | { readonly _tag: "Active"; readonly subscribedAt: DateTimeType.Utc }
  | { readonly _tag: "Error"; readonly error: E }
  | { readonly _tag: "Complete" }
  | { readonly _tag: "Unsubscribed" }

/**
 * Constructors for subscription states.
 *
 * @since 0.1.0
 * @category constructors
 */
export const SubscriptionState = {
  Idle: { _tag: "Idle" } as SubscriptionState<never>,
  Subscribing: { _tag: "Subscribing" } as SubscriptionState<never>,
  Active: (subscribedAt: DateTimeType.Utc): SubscriptionState<never> => ({
    _tag: "Active",
    subscribedAt,
  }),
  Error: <E>(error: E): SubscriptionState<E> => ({
    _tag: "Error",
    error,
  }),
  Complete: { _tag: "Complete" } as SubscriptionState<never>,
  Unsubscribed: { _tag: "Unsubscribed" } as SubscriptionState<never>,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Connection State (re-export from ws/client for convenience)
// ─────────────────────────────────────────────────────────────────────────────

export { ClientState as ConnectionState } from "../ws/client/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Hook Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for useSubscription hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseSubscriptionOptions<A, E = unknown> {
  /** Whether to start the subscription immediately (default: true) */
  readonly enabled?: boolean
  /** Callback for each data item */
  readonly onData?: (data: A) => void
  /** Callback when subscription completes */
  readonly onComplete?: () => void
  /** Callback on error */
  readonly onError?: (error: E) => void
  /** Callback when subscription becomes active */
  readonly onSubscribed?: () => void
  /** Maximum history length (default: 100) */
  readonly historyLimit?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Return Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return type for useSubscription hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseSubscriptionReturn<A, E = unknown> {
  // Data
  /** Latest data received */
  readonly data: A | undefined
  /** History of received data */
  readonly history: ReadonlyArray<A>
  /** Current error, if any */
  readonly error: E | undefined

  // State
  /** Current subscription state */
  readonly state: SubscriptionState<E>
  /** Current WebSocket connection state */
  readonly connectionState: WsClientState
  /** Whether subscription is active (receiving data) */
  readonly isActive: boolean
  /** Whether currently subscribing */
  readonly isSubscribing: boolean
  /** Whether there's an error */
  readonly isError: boolean
  /** Whether the subscription completed normally */
  readonly isComplete: boolean
  /** Whether reconnecting */
  readonly isReconnecting: boolean

  // Actions
  /** Send data to the subscription (bidirectional) */
  readonly send: (data: unknown) => void
  /** Unsubscribe and clean up */
  readonly unsubscribe: () => void
  /** Resubscribe (after unsubscribe or error) */
  readonly resubscribe: () => void
  /** Clear the history array */
  readonly clearHistory: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context value for WebSocket provider.
 */
interface WebSocketContextValue {
  readonly connectionState: WsClientState
  readonly managedRuntime: ManagedRuntime.ManagedRuntime<
    WebSocketClient | SubscriptionRegistry | WebSocketConnection,
    never
  >
}

const WebSocketContext = React.createContext<WebSocketContextValue | null>(null)

/**
 * Hook to access WebSocket context.
 */
const useWebSocketContext = (): WebSocketContextValue => {
  const ctx = React.useContext(WebSocketContext)
  if (!ctx) {
    throw new Error("useSubscription must be used within a WebSocketProvider")
  }
  return ctx
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Props
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props for WebSocketProvider.
 *
 * @since 0.1.0
 * @category models
 */
export interface WebSocketProviderProps {
  /** WebSocket configuration */
  readonly config: WebSocketClientConfig
  /** Children */
  readonly children: React.ReactNode
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider component for WebSocket subscriptions.
 * Manages the WebSocket connection and provides it to child components.
 *
 * @since 0.1.0
 * @category hooks
 */
export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  config,
  children,
}) => {
  const [connectionState, setConnectionState] = React.useState<WsClientState>({
    _tag: "Disconnected",
  })

  // Create managed runtime with all required layers
  const managedRuntime = React.useMemo(() => {
    const connectionLayer = makeWebSocketConnectionLayer({ url: config.url })
    const registryLayer = SubscriptionRegistryLive
    const clientLayer = makeWebSocketClientLayer(config)

    // Compose layers: Registry + (Client that needs Connection)
    const fullLayer = Layer.mergeAll(
      registryLayer,
      connectionLayer,
      clientLayer.pipe(
        Layer.provide(connectionLayer),
        Layer.provide(registryLayer),
      ),
    )

    return ManagedRuntime.make(fullLayer.pipe(Layer.provide(Layer.scope)))
  }, [config])

  // Track connection state changes
  React.useEffect(() => {
    const stateWatcher = Effect.gen(function* () {
      const client = yield* WebSocketClient

      yield* Stream.runForEach(client.stateChanges, (state) =>
        Effect.sync(() => setConnectionState(state)),
      )
    })

    const fiber = managedRuntime.runFork(stateWatcher)

    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [managedRuntime])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      void managedRuntime.dispose()
    }
  }, [managedRuntime])

  const contextValue: WebSocketContextValue = React.useMemo(
    () => ({
      connectionState,
      managedRuntime,
    }),
    [connectionState, managedRuntime],
  )

  return React.createElement(
    WebSocketContext.Provider,
    { value: contextValue },
    children,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// useSubscription Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for subscribing to a WebSocket subscription procedure.
 *
 * @example
 * ```tsx
 * const { data, history, send, isActive } = useSubscription(
 *   "chat.messages",
 *   { roomId: "123" },
 *   {
 *     onData: (msg) => scrollToBottom(),
 *     historyLimit: 100,
 *   }
 * )
 *
 * // Send a message
 * send({ text: "Hello!" })
 * ```
 *
 * @since 0.1.0
 * @category hooks
 */
export function useSubscription<A, E = unknown>(
  path: string,
  input: unknown,
  options?: UseSubscriptionOptions<A, E>,
): UseSubscriptionReturn<A, E> {
  const {
    enabled = true,
    onData,
    onComplete,
    onError,
    onSubscribed,
    historyLimit = 100,
  } = options ?? {}

  const { managedRuntime, connectionState } = useWebSocketContext()

  // State
  const [state, setState] = React.useState<SubscriptionState<E>>(
    SubscriptionState.Idle,
  )
  const [data, setData] = React.useState<A | undefined>(undefined)
  const [history, setHistory] = React.useState<ReadonlyArray<A>>([])
  const [error, setError] = React.useState<E | undefined>(undefined)

  // Refs for cleanup
  const subscriptionIdRef = React.useRef<SubscriptionId | null>(null)
  const fiberRef = React.useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)

  // Stable input key for dependency tracking (prevents infinite re-renders with object inputs)
  const inputKey = React.useMemo(() => JSON.stringify(input), [input])
  // Ref to access current input value without causing callback recreation
  const inputRef = React.useRef(input)
  inputRef.current = input

  // Use useEvent for callbacks - ensures we always call the latest version
  // without recreating the subscription when callbacks change.
  // See: https://react.dev/reference/react/useEffectEvent
  const onDataEvent = useEvent((item: A) => {
    onData?.(item)
  })
  const onCompleteEvent = useEvent(() => {
    onComplete?.()
  })
  const onErrorEvent = useEvent((err: E) => {
    onError?.(err)
  })
  const onSubscribedEvent = useEvent(() => {
    onSubscribed?.()
  })

  // Clear history
  const clearHistory = React.useCallback(() => {
    setHistory([])
  }, [])

  // Unsubscribe
  const unsubscribe = React.useCallback(() => {
    if (fiberRef.current) {
      managedRuntime.runFork(Fiber.interrupt(fiberRef.current))
      fiberRef.current = null
    }

    if (subscriptionIdRef.current) {
      const id = subscriptionIdRef.current
      managedRuntime.runFork(
        Effect.gen(function* () {
          const client = yield* WebSocketClient
          yield* client.unsubscribe(id)
        }),
      )
      subscriptionIdRef.current = null
    }

    setState(SubscriptionState.Unsubscribed)
  }, [managedRuntime])

  // Subscribe
  const subscribe = React.useCallback(() => {
    // Clean up any existing subscription
    unsubscribe()

    setState(SubscriptionState.Subscribing)
    setError(undefined)

    const subscribeEffect = Effect.gen(function* () {
      const client = yield* WebSocketClient

      // Wait for client to be ready
      const isReady = yield* client.isReady
      if (!isReady) {
        yield* client.connect
      }

      // Subscribe and get both ID and stream (use ref to get current input value)
      const { id, stream } = yield* client.subscribe<A>(path, inputRef.current)
      subscriptionIdRef.current = id // Store the actual subscription ID

      // Process stream
      yield* stream.pipe(
        Stream.tap((item) =>
          Effect.gen(function* () {
            // Get time in Effect context before sync callback
            const now = yield* DateTime.now
            yield* Effect.sync(() => {
              setData(item)
              setHistory((prev) => {
                const newHistory = [...prev, item]
                if (newHistory.length > historyLimit) {
                  return newHistory.slice(-historyLimit)
                }
                return newHistory
              })
              // useEffectEvent ensures we call the latest callback
              onDataEvent(item)
              
              // Update state to Active on first data
              let wasSubscribing = false
              setState((current) => {
                if (current._tag === "Subscribing") {
                  wasSubscribing = true
                  return SubscriptionState.Active(now)
                }
                return current
              })
              if (wasSubscribing) {
                // useEffectEvent ensures we call the latest callback
                onSubscribedEvent()
              }
            })
          }),
        ),
        Stream.runDrain,
        Effect.tap(() =>
          Effect.sync(() => {
            setState(SubscriptionState.Complete)
            // useEffectEvent ensures we call the latest callback
            onCompleteEvent()
          }),
        ),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            const err = Cause.squash(cause) as E
            setError(err)
            setState(SubscriptionState.Error(err))
            // useEffectEvent ensures we call the latest callback
            onErrorEvent(err)
          }),
        ),
      )
    })

    fiberRef.current = managedRuntime.runFork(subscribeEffect)
  }, [
    path,
    inputKey, // Use stable stringified key instead of object reference
    historyLimit,
    unsubscribe,
    managedRuntime,
    // Note: onDataEvent, onCompleteEvent, etc. are created with useEffectEvent
    // so they always have the latest callbacks and don't need to be in deps
  ])

  // Resubscribe
  const resubscribe = React.useCallback(() => {
    subscribe()
  }, [subscribe])

  // Send data to subscription
  const send = React.useCallback(
    (sendData: unknown) => {
      if (!subscriptionIdRef.current) return

      const id = subscriptionIdRef.current
      managedRuntime.runFork(
        Effect.gen(function* () {
          const client = yield* WebSocketClient
          yield* client.send(id, sendData)
        }).pipe(Effect.ignore),
      )
    },
    [managedRuntime],
  )

  // Auto-subscribe on mount if enabled
  React.useEffect(() => {
    if (enabled) {
      subscribe()
    }
    return unsubscribe
  }, [enabled, subscribe, unsubscribe])

  const onInputChanged = useEvent(() => {
    if (enabled && state._tag !== "Idle" && state._tag !== "Unsubscribed") {
      subscribe()
    }
  })

  // Resubscribe when input changes
  React.useEffect(() => {
    onInputChanged()
  }, [inputKey])

  return {
    // Data
    data,
    history,
    error,

    // State
    state,
    connectionState,
    isActive: state._tag === "Active",
    isSubscribing: state._tag === "Subscribing",
    isError: state._tag === "Error",
    isComplete: state._tag === "Complete",
    isReconnecting: connectionState._tag === "Reconnecting",

    // Actions
    send,
    unsubscribe,
    resubscribe,
    clearHistory,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createSubscriptionHook (for integration with createTRPCReact)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a typed useSubscription hook for a specific procedure path.
 * Used internally by createTRPCReact.
 *
 * @since 0.1.0
 * @category constructors
 */
export function createSubscriptionHook<I, A, E>(
  path: string,
): (
  input: I,
  options?: UseSubscriptionOptions<A>,
) => UseSubscriptionReturn<A, E> {
  return (input: I, options?: UseSubscriptionOptions<A>) =>
    useSubscription<A, E>(path, input, options)
}
