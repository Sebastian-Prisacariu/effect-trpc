/**
 * DevTools for effect-trpc
 * 
 * Provides real-time inspection of queries, mutations, cache, and network activity.
 * 
 * @since 1.0.0
 * @module
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Duration from "effect/Duration"

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event with timestamp and ID
 */
interface BaseEvent {
  readonly id: string
  readonly timestamp: number
}

/**
 * Query started event
 */
export interface QueryStarted extends BaseEvent {
  readonly _tag: "QueryStarted"
  readonly path: string
  readonly payload: unknown
}

/**
 * Query succeeded event
 */
export interface QuerySuccess extends BaseEvent {
  readonly _tag: "QuerySuccess"
  readonly path: string
  readonly data: unknown
  readonly duration: number
}

/**
 * Query failed event
 */
export interface QueryError extends BaseEvent {
  readonly _tag: "QueryError"
  readonly path: string
  readonly error: unknown
  readonly duration: number
}

/**
 * Mutation started event
 */
export interface MutationStarted extends BaseEvent {
  readonly _tag: "MutationStarted"
  readonly path: string
  readonly payload: unknown
}

/**
 * Mutation succeeded event
 */
export interface MutationSuccess extends BaseEvent {
  readonly _tag: "MutationSuccess"
  readonly path: string
  readonly data: unknown
  readonly duration: number
  readonly invalidated: readonly string[]
}

/**
 * Mutation failed event
 */
export interface MutationError extends BaseEvent {
  readonly _tag: "MutationError"
  readonly path: string
  readonly error: unknown
  readonly duration: number
}

/**
 * Cache invalidation event
 */
export interface CacheInvalidated extends BaseEvent {
  readonly _tag: "CacheInvalidated"
  readonly paths: readonly string[]
  readonly source: string // mutation path that triggered it
}

/**
 * Network request event
 */
export interface NetworkRequest extends BaseEvent {
  readonly _tag: "NetworkRequest"
  readonly method: "GET" | "POST"
  readonly url: string
  readonly body: unknown
  readonly isBatch: boolean
}

/**
 * Network response event
 */
export interface NetworkResponse extends BaseEvent {
  readonly _tag: "NetworkResponse"
  readonly requestId: string
  readonly status: number
  readonly body: unknown
  readonly duration: number
}

/**
 * Stream started event
 */
export interface StreamStarted extends BaseEvent {
  readonly _tag: "StreamStarted"
  readonly path: string
  readonly payload: unknown
}

/**
 * Stream chunk received event
 */
export interface StreamChunk extends BaseEvent {
  readonly _tag: "StreamChunk"
  readonly path: string
  readonly chunk: unknown
  readonly index: number
}

/**
 * Stream ended event
 */
export interface StreamEnded extends BaseEvent {
  readonly _tag: "StreamEnded"
  readonly path: string
  readonly totalChunks: number
  readonly duration: number
}

/**
 * All DevTools events
 */
export type DevToolsEvent =
  | QueryStarted
  | QuerySuccess
  | QueryError
  | MutationStarted
  | MutationSuccess
  | MutationError
  | CacheInvalidated
  | NetworkRequest
  | NetworkResponse
  | StreamStarted
  | StreamChunk
  | StreamEnded

// =============================================================================
// State Types
// =============================================================================

/**
 * Query state for display
 */
export interface QueryState {
  readonly path: string
  readonly status: "idle" | "loading" | "success" | "error"
  readonly data: unknown | undefined
  readonly error: unknown | undefined
  readonly lastUpdated: number | undefined
  readonly fetchCount: number
}

/**
 * Mutation state for display
 */
export interface MutationState {
  readonly path: string
  readonly status: "idle" | "loading" | "success" | "error"
  readonly data: unknown | undefined
  readonly error: unknown | undefined
  readonly lastExecuted: number | undefined
  readonly executionCount: number
}

/**
 * Full DevTools state
 */
export interface DevToolsState {
  readonly queries: HashMap.HashMap<string, QueryState>
  readonly mutations: HashMap.HashMap<string, MutationState>
  readonly events: readonly DevToolsEvent[]
  readonly networkLog: readonly (NetworkRequest | NetworkResponse)[]
  readonly isRecording: boolean
}

// =============================================================================
// Service
// =============================================================================

/**
 * DevTools service interface
 */
export interface DevToolsService {
  /**
   * Emit an event to DevTools
   */
  readonly emit: (event: DevToolsEvent) => Effect.Effect<void>
  
  /**
   * Subscribe to the event stream
   */
  readonly events: Stream.Stream<DevToolsEvent>
  
  /**
   * Get current state snapshot
   */
  readonly getState: Effect.Effect<DevToolsState>
  
  /**
   * Subscribe to state changes
   */
  readonly stateChanges: Stream.Stream<DevToolsState>
  
  /**
   * Clear all recorded data
   */
  readonly clear: Effect.Effect<void>
  
  /**
   * Pause/resume recording
   */
  readonly setRecording: (recording: boolean) => Effect.Effect<void>
}

/**
 * DevTools service tag
 */
export class DevTools extends Context.Tag("@effect-trpc/DevTools")<
  DevTools,
  DevToolsService
>() {}

// =============================================================================
// Implementation
// =============================================================================

const initialState: DevToolsState = {
  queries: HashMap.empty(),
  mutations: HashMap.empty(),
  events: [],
  networkLog: [],
  isRecording: true,
}

/**
 * Create the DevTools service layer
 */
export const layer: Layer.Layer<DevTools> = Layer.scoped(
  DevTools,
  Effect.gen(function* () {
    const eventQueue = yield* Queue.unbounded<DevToolsEvent>()
    const stateRef = yield* SubscriptionRef.make(initialState)
    const recordingRef = yield* Ref.make(true)
    
    // Process events and update state
    yield* Stream.fromQueue(eventQueue).pipe(
      Stream.tap((event) =>
        Effect.gen(function* () {
          const isRecording = yield* Ref.get(recordingRef)
          if (!isRecording) return
          
          yield* SubscriptionRef.update(stateRef, (state) => {
            const newEvents = [...state.events, event].slice(-1000) // Keep last 1000
            
            switch (event._tag) {
              case "QueryStarted":
                return {
                  ...state,
                  events: newEvents,
                  queries: HashMap.set(
                    state.queries,
                    event.path,
                    {
                      path: event.path,
                      status: "loading" as const,
                      data: HashMap.get(state.queries, event.path).pipe(
                        Option.map(q => q.data),
                        Option.getOrUndefined
                      ),
                      error: undefined,
                      lastUpdated: event.timestamp,
                      fetchCount: HashMap.get(state.queries, event.path).pipe(
                        Option.map(q => q.fetchCount + 1),
                        Option.getOrElse(() => 1)
                      ),
                    }
                  ),
                }
              
              case "QuerySuccess":
                return {
                  ...state,
                  events: newEvents,
                  queries: HashMap.set(
                    state.queries,
                    event.path,
                    {
                      ...HashMap.get(state.queries, event.path).pipe(
                        Option.getOrElse(() => ({
                          path: event.path,
                          fetchCount: 1,
                        }))
                      ),
                      status: "success" as const,
                      data: event.data,
                      error: undefined,
                      lastUpdated: event.timestamp,
                    } as QueryState
                  ),
                }
              
              case "QueryError":
                return {
                  ...state,
                  events: newEvents,
                  queries: HashMap.set(
                    state.queries,
                    event.path,
                    {
                      ...HashMap.get(state.queries, event.path).pipe(
                        Option.getOrElse(() => ({
                          path: event.path,
                          fetchCount: 1,
                        }))
                      ),
                      status: "error" as const,
                      error: event.error,
                      lastUpdated: event.timestamp,
                    } as QueryState
                  ),
                }
              
              case "MutationStarted":
                return {
                  ...state,
                  events: newEvents,
                  mutations: HashMap.set(
                    state.mutations,
                    event.path,
                    {
                      path: event.path,
                      status: "loading" as const,
                      data: undefined,
                      error: undefined,
                      lastExecuted: event.timestamp,
                      executionCount: HashMap.get(state.mutations, event.path).pipe(
                        Option.map(m => m.executionCount + 1),
                        Option.getOrElse(() => 1)
                      ),
                    }
                  ),
                }
              
              case "MutationSuccess":
                return {
                  ...state,
                  events: newEvents,
                  mutations: HashMap.set(
                    state.mutations,
                    event.path,
                    {
                      ...HashMap.get(state.mutations, event.path).pipe(
                        Option.getOrElse(() => ({
                          path: event.path,
                          executionCount: 1,
                        }))
                      ),
                      status: "success" as const,
                      data: event.data,
                      error: undefined,
                      lastExecuted: event.timestamp,
                    } as MutationState
                  ),
                }
              
              case "MutationError":
                return {
                  ...state,
                  events: newEvents,
                  mutations: HashMap.set(
                    state.mutations,
                    event.path,
                    {
                      ...HashMap.get(state.mutations, event.path).pipe(
                        Option.getOrElse(() => ({
                          path: event.path,
                          executionCount: 1,
                        }))
                      ),
                      status: "error" as const,
                      error: event.error,
                      lastExecuted: event.timestamp,
                    } as MutationState
                  ),
                }
              
              case "NetworkRequest":
              case "NetworkResponse":
                return {
                  ...state,
                  events: newEvents,
                  networkLog: [...state.networkLog, event].slice(-500),
                }
              
              default:
                return { ...state, events: newEvents }
            }
          })
        })
      ),
      Stream.runDrain,
      Effect.forkScoped
    )
    
    return {
      emit: (event) => Queue.offer(eventQueue, event),
      
      events: Stream.fromQueue(eventQueue),
      
      getState: SubscriptionRef.get(stateRef),
      
      stateChanges: stateRef.changes,
      
      clear: SubscriptionRef.set(stateRef, initialState),
      
      setRecording: (recording) => Ref.set(recordingRef, recording),
    }
  })
)

// =============================================================================
// Helpers
// =============================================================================

let eventCounter = 0

/**
 * Generate unique event ID
 */
export const generateEventId = (): string => {
  return `evt_${Date.now()}_${++eventCounter}`
}

/**
 * Create a query started event
 */
export const queryStarted = (path: string, payload: unknown): QueryStarted => ({
  _tag: "QueryStarted",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  payload,
})

/**
 * Create a query success event
 */
export const querySuccess = (
  path: string,
  data: unknown,
  startTime: number
): QuerySuccess => ({
  _tag: "QuerySuccess",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  data,
  duration: Date.now() - startTime,
})

/**
 * Create a query error event
 */
export const queryError = (
  path: string,
  error: unknown,
  startTime: number
): QueryError => ({
  _tag: "QueryError",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  error,
  duration: Date.now() - startTime,
})

/**
 * Create a mutation started event
 */
export const mutationStarted = (path: string, payload: unknown): MutationStarted => ({
  _tag: "MutationStarted",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  payload,
})

/**
 * Create a mutation success event
 */
export const mutationSuccess = (
  path: string,
  data: unknown,
  startTime: number,
  invalidated: readonly string[]
): MutationSuccess => ({
  _tag: "MutationSuccess",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  data,
  duration: Date.now() - startTime,
  invalidated,
})

/**
 * Create a mutation error event
 */
export const mutationError = (
  path: string,
  error: unknown,
  startTime: number
): MutationError => ({
  _tag: "MutationError",
  id: generateEventId(),
  timestamp: Date.now(),
  path,
  error,
  duration: Date.now() - startTime,
})

/**
 * Create a cache invalidated event
 */
export const cacheInvalidated = (
  paths: readonly string[],
  source: string
): CacheInvalidated => ({
  _tag: "CacheInvalidated",
  id: generateEventId(),
  timestamp: Date.now(),
  paths,
  source,
})

/**
 * Create a network request event
 */
export const networkRequest = (
  method: "GET" | "POST",
  url: string,
  body: unknown,
  isBatch: boolean
): NetworkRequest => ({
  _tag: "NetworkRequest",
  id: generateEventId(),
  timestamp: Date.now(),
  method,
  url,
  body,
  isBatch,
})

/**
 * Create a network response event
 */
export const networkResponse = (
  requestId: string,
  status: number,
  body: unknown,
  startTime: number
): NetworkResponse => ({
  _tag: "NetworkResponse",
  id: generateEventId(),
  timestamp: Date.now(),
  requestId,
  status,
  body,
  duration: Date.now() - startTime,
})

// =============================================================================
// React Integration
// =============================================================================

/**
 * DevTools panel props
 */
export interface DevToolsPanelProps {
  /**
   * Position of the panel
   */
  readonly position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  
  /**
   * Initial collapsed state
   */
  readonly defaultCollapsed?: boolean
  
  /**
   * Panel height when expanded
   */
  readonly height?: number
}

/**
 * React component for DevTools panel
 * 
 * @example
 * ```tsx
 * import { DevTools } from "effect-trpc"
 * 
 * function App() {
 *   return (
 *     <>
 *       <MyApp />
 *       {process.env.NODE_ENV === "development" && (
 *         <DevTools.Panel position="bottom-right" />
 *       )}
 *     </>
 *   )
 * }
 * ```
 */
export const Panel: React.FC<DevToolsPanelProps> = (_props) => {
  // Implementation would use useContext to get DevTools state
  // and render a floating panel with tabs for:
  // - Queries (list with status, data preview)
  // - Mutations (history log)
  // - Cache (tree view of cached data)
  // - Network (request/response log)
  // - Events (raw event stream)
  
  // For now, return null - would implement with actual React components
  return null
}

// Type import for React (optional peer dependency)
type React = {
  FC: <P>(component: (props: P) => any) => (props: P) => any
}
