/**
 * @module effect-trpc/react/atoms
 *
 * Atom-based state management for effect-trpc React client.
 * Uses @effect-atom/atom for reactive state with proper Effect integration.
 *
 * Implements the atom hierarchy from DECISION-007:
 * - Queries: 2-tier (Main Atom + Writable Atom)
 * - Mutations: 3-tier (Main + Writable + Caller Atom)
 * - Streams: 2-tier
 * - Subscriptions: 2-tier + Connection
 *
 * @remarks
 * Atom families are global singletons, but state is scoped per Registry.
 * Each RegistryProvider creates isolated state. Multiple clients under
 * the same RegistryProvider share cache (query deduplication). Use
 * separate RegistryProviders for fully isolated clients.
 *
 * @since 0.1.0
 */

import * as React from "react"
import * as Atom from "@effect-atom/atom/Atom"
import * as AtomResult from "@effect-atom/atom/Result"
import * as AtomRegistry from "@effect-atom/atom/Registry"
import * as AtomReact from "@effect-atom/atom-react"
import type * as Layer from "effect/Layer"
import type * as HttpClient from "@effect/platform/HttpClient"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"

// ─────────────────────────────────────────────────────────────────────────────
// Re-export Registry types and context
// ─────────────────────────────────────────────────────────────────────────────

export { AtomRegistry }

/**
 * Registry type from effect-atom.
 *
 * @since 0.1.0
 * @category types
 */
export type Registry = AtomRegistry.Registry

/**
 * The RegistryContext from effect-atom-react.
 * Re-exported for use in our hooks.
 *
 * @since 0.1.0
 * @category context
 */
export const RegistryContext: React.Context<AtomRegistry.Registry> = AtomReact.RegistryContext

/**
 * Hook to get the effect-atom registry from context.
 *
 * @remarks
 * This hook provides type-safe access to the Registry without
 * requiring ugly casts at the call site. The single cast here
 * handles the React types mismatch between @types/react and
 * effect-atom's internal React types.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useRegistry = (): AtomRegistry.Registry => {
  return React.useContext(RegistryContext)
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Key Registry (tracks all query keys for invalidation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of query keys to track in the registry.
 * Uses LRU eviction when limit is reached.
 *
 * @since 0.1.0
 * @category constants
 */
export const MAX_QUERY_KEY_CACHE_SIZE = 1000

/**
 * State for the LRU query key registry.
 * Tracks both the set of keys and their access order.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryKeyRegistryState {
  /** Set of all registered query keys */
  readonly keys: ReadonlySet<string>
  /** Array tracking access order (oldest first, most recent last) */
  readonly accessOrder: readonly string[]
}

/**
 * Create initial query key registry state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialQueryKeyRegistryState = (): QueryKeyRegistryState => ({
  keys: new Set<string>(),
  accessOrder: [],
})

/**
 * Atom that tracks all active query keys with LRU eviction.
 * Scoped to the registry, so each test gets a fresh set.
 * Used for prefix-based invalidation.
 *
 * When the cache exceeds MAX_QUERY_KEY_CACHE_SIZE, the least recently
 * accessed keys are evicted to prevent unbounded memory growth.
 *
 * @since 0.1.0
 * @category atoms
 */
export const queryKeyRegistryAtom: Atom.Writable<QueryKeyRegistryState> = Atom.keepAlive(
  Atom.make(initialQueryKeyRegistryState()),
)

/**
 * Register a query key in the registry with LRU tracking.
 * Called when a query hook mounts.
 *
 * If the key already exists, it's moved to the end of the access order (most recent).
 * If adding a new key would exceed MAX_QUERY_KEY_CACHE_SIZE, the oldest key is evicted.
 *
 * @param registry - The effect-atom registry
 * @param key - The query key to register
 *
 * @since 0.1.0
 * @category utils
 */
export const registerQueryKey = (registry: AtomRegistry.Registry, key: string): void => {
  const currentState = registry.get(queryKeyRegistryAtom)

  if (currentState.keys.has(key)) {
    // Key exists - move to end of access order (most recently used)
    const newAccessOrder = currentState.accessOrder.filter((k) => k !== key)
    newAccessOrder.push(key)
    registry.set(queryKeyRegistryAtom, {
      keys: currentState.keys,
      accessOrder: newAccessOrder,
    })
    return
  }

  // New key - check if we need to evict
  const newKeys = new Set(currentState.keys)
  const newAccessOrder = [...currentState.accessOrder]

  if (newKeys.size >= MAX_QUERY_KEY_CACHE_SIZE) {
    // Evict oldest key(s) until we have room
    while (newKeys.size >= MAX_QUERY_KEY_CACHE_SIZE && newAccessOrder.length > 0) {
      const oldestKey = newAccessOrder.shift()
      if (oldestKey) {
        newKeys.delete(oldestKey)
      }
    }
  }

  // Add new key
  newKeys.add(key)
  newAccessOrder.push(key)

  registry.set(queryKeyRegistryAtom, {
    keys: newKeys,
    accessOrder: newAccessOrder,
  })
}

/**
 * Clear all query keys from the registry.
 * Useful for cleanup on provider unmount or testing.
 *
 * @param registry - The effect-atom registry
 *
 * @since 0.1.0
 * @category utils
 */
export const clearQueryKeyRegistry = (registry: AtomRegistry.Registry): void => {
  registry.set(queryKeyRegistryAtom, initialQueryKeyRegistryState())
}

/**
 * Get all registered query keys from the registry.
 *
 * @param registry - The effect-atom registry
 * @returns The set of active query keys
 *
 * @since 0.1.0
 * @category utils
 */
export const getRegisteredQueryKeys = (registry: AtomRegistry.Registry): ReadonlySet<string> => {
  return registry.get(queryKeyRegistryAtom).keys
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from @effect-atom/atom-react
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props for the RegistryProvider component.
 *
 * @since 0.1.0
 * @category provider
 */
export interface RegistryProviderProps {
  readonly children?: React.ReactNode | undefined
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]> | undefined
  readonly scheduleTask?: ((f: () => void) => void) | undefined
  readonly timeoutResolution?: number | undefined
  readonly defaultIdleTTL?: number | undefined
}

/**
 * Provider component that must wrap your app.
 * Manages the atom registry and subscriptions.
 *
 * @example
 * ```tsx
 * import { RegistryProvider } from 'effect-trpc/react'
 *
 * function App() {
 *   return (
 *     <RegistryProvider>
 *       <YourApp />
 *     </RegistryProvider>
 *   )
 * }
 * ```
 *
 * @since 0.1.0
 * @category provider
 */

export const RegistryProvider: (props: RegistryProviderProps) => React.ReactElement =
  AtomReact.RegistryProvider as any

/**
 * Read an atom's value reactively.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomValue = AtomReact.useAtomValue

/**
 * Read and write an atom's value.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtom = AtomReact.useAtom

/**
 * Get a setter function for an atom.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomSet = AtomReact.useAtomSet

/**
 * Refresh an atom (re-run its effect).
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomRefresh = AtomReact.useAtomRefresh

/**
 * Subscribe to atom changes with a callback.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomSubscribe = AtomReact.useAtomSubscribe

/**
 * Use an atom with Suspense support.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomSuspense = AtomReact.useAtomSuspense

/**
 * Mount an atom (start its effect).
 *
 * @since 0.1.0
 * @category hooks
 */
export const useAtomMount = AtomReact.useAtomMount

// ─────────────────────────────────────────────────────────────────────────────
// Result Type (re-export from @effect-atom/atom)
// ─────────────────────────────────────────────────────────────────────────────

export { AtomResult }

/**
 * Result type from effect-atom for async state.
 *
 * @since 0.1.0
 * @category models
 */
export type AtomResultType<A, E> = AtomResult.Result<A, E>

// ─────────────────────────────────────────────────────────────────────────────
// Atom Key Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic JSON stringify that sorts object keys.
 * Ensures {a:1, b:2} and {b:2, a:1} produce the same string.
 *
 * @since 0.1.0
 * @category utils
 */
export const stableStringify = (obj: unknown): string => {
  if (obj === null) {
    return "null"
  }
  if (obj === undefined) {
    return "undefined"
  }
  if (typeof obj === "bigint") {
    return `"BigInt(${obj.toString()})"`
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]"
  }
  const keys = Object.keys(obj).sort()
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
  )
  return "{" + pairs.join(",") + "}"
}

/**
 * Key separator that's unlikely to appear in procedure paths or inputs.
 * Uses a double pipe which is more robust than a single colon.
 *
 * @since 0.1.0
 * @category utils
 */
const KEY_SEPARATOR = "||"

/**
 * Generate a stable key for queries/streams (includes input).
 * Uses deterministic stringify to ensure equivalent inputs produce the same key.
 *
 * @since 0.1.0
 * @category utils
 */
export const generateQueryKey = (path: string, input: unknown): string => {
  if (input === undefined) {
    return `${path}${KEY_SEPARATOR}`
  }
  try {
    const inputKey = stableStringify(input)
    return `${path}${KEY_SEPARATOR}${inputKey}`
  } catch {
    // Fallback for circular references or other serialization issues
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Intentional fallback for non-serializable input
    return `${path}${KEY_SEPARATOR}${String(input)}`
  }
}

/**
 * Generate a key for mutations (path only, no input).
 *
 * @since 0.1.0
 * @category utils
 */
export const generateMutationKey = (path: string): string => path

/**
 * Generate a key for caller-specific mutation state.
 *
 * @since 0.1.0
 * @category utils
 */
export const generateCallerKey = (path: string, callerId: string): string =>
  `${path}${KEY_SEPARATOR}caller${KEY_SEPARATOR}${callerId}`

// ─────────────────────────────────────────────────────────────────────────────
// Query Atoms (2-tier: Main + Writable)
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURE NOTE: Atom Families are Global, State is Per-Registry
//
// The atom families below (queryAtomFamily, mutationAtomFamily, etc.) are
// module-level singletons. This is INTENTIONAL and correct for effect-atom's
// architecture:
//
// - Atom families are just factories that create atom instances by key
// - The actual state lives in the Registry, not in the atoms themselves
// - Each RegistryProvider creates a fresh Registry with isolated state
// - When you call `registry.get(someAtomFamily(key))`, the value comes from
//   THAT specific registry, not from a global cache
//
// This means:
// - Multiple tRPC clients with DIFFERENT RegistryProviders have isolated state
// - Multiple tRPC clients under the SAME RegistryProvider share state
//   (query deduplication, shared cache for SSR hydration)
//
// If you need fully isolated clients, wrap each in its own RegistryProvider.
// This is consistent with React Query's QueryClientProvider pattern.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query state stored in atoms.
 * Uses effect-atom's Result type for async state.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryAtomState<A, E> {
  readonly result: AtomResult.Result<A, E>
  readonly lastFetchedAt: number | null
  /**
   * The previous error that occurred before the current retry attempt.
   * Preserved during retries so UI can show both loading and error state.
   * Cleared only on successful fetch.
   */
  readonly previousError: E | null
}

/**
 * Create initial query state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialQueryState = <A, E>(): QueryAtomState<A, E> => ({
  result: AtomResult.initial(),
  lastFetchedAt: null,
  previousError: null,
})

/**
 * Query atom family - one atom per query key.
 * This is the source of truth for query data.
 * Keys are registered via registerQueryKey() when hooks mount.
 *
 * Note: Does NOT use Atom.keepAlive so that atoms respect the registry's
 * defaultIdleTTL (set via gcTime in defaultQueryOptions). When an atom
 * becomes idle (no subscribers), it will be garbage collected after gcTime.
 *
 * @since 0.1.0
 * @category atoms
 */
export const queryAtomFamily = Atom.family((_key: string) =>
  Atom.make<QueryAtomState<unknown, unknown>>(initialQueryState()),
)

/**
 * Writable query atom for optimistic updates.
 * Reads from main atom, allows temporary overrides.
 *
 * @since 0.1.0
 * @category atoms
 */
export const writableQueryAtomFamily = Atom.family((key: string) =>
  Atom.writable(
    (get) => get(queryAtomFamily(key)),
    (ctx, update: QueryAtomState<unknown, unknown>) => {
      ctx.set(queryAtomFamily(key), update)
    },
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Atoms (3-tier: Main + Writable + Caller)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main mutation state (last result, shared across callers).
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationMainState<A, E> {
  readonly lastResult: AtomResult.Result<A, E> | null
  readonly lastInput: unknown
}

/**
 * Per-caller mutation state (isolated per useMutation call).
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationCallerState<E> {
  readonly isPending: boolean
  readonly error: E | null
  readonly lastInput: unknown
}

/**
 * Create initial mutation main state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialMutationMainState = <A, E>(): MutationMainState<A, E> => ({
  lastResult: null,
  lastInput: undefined,
})

/**
 * Create initial caller state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialCallerState = <E>(): MutationCallerState<E> => ({
  isPending: false,
  error: null,
  lastInput: undefined,
})

/**
 * Mutation main atom family - one per mutation path.
 * Holds last successful result.
 *
 * @since 0.1.0
 * @category atoms
 */
export const mutationAtomFamily = Atom.family((_path: string) =>
  Atom.keepAlive(Atom.make<MutationMainState<unknown, unknown>>(initialMutationMainState())),
)

/**
 * Writable mutation atom for optimistic updates.
 *
 * @since 0.1.0
 * @category atoms
 */
export const writableMutationAtomFamily = Atom.family((path: string) =>
  Atom.writable(
    (get) => get(mutationAtomFamily(path)),
    (ctx, update: MutationMainState<unknown, unknown>) => {
      ctx.set(mutationAtomFamily(path), update)
    },
  ),
)

/**
 * Caller atom family - one per useMutation() hook instance.
 * Isolated isPending/error state.
 *
 * NOTE: Unlike query atoms which are shared/cached, caller atoms are unique
 * per component instance (using React.useId()). They must be cleaned up
 * when the component unmounts to prevent memory leaks.
 *
 * @since 0.1.0
 * @category atoms
 */
export const callerAtomFamily = Atom.family((_callerKey: string) =>
  Atom.make<MutationCallerState<unknown>>(initialCallerState()),
)

// ─────────────────────────────────────────────────────────────────────────────
// Caller Atom Cleanup Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registry tracking active caller atoms.
 * Used to clean up caller atoms when components unmount.
 *
 * We use a WeakMap keyed by Registry to ensure cleanup per-registry,
 * which is important for tests that create fresh registries.
 *
 * @since 0.3.0
 * @category internal
 */
const callerAtomCleanupRegistry = new WeakMap<
  AtomRegistry.Registry,
  Map<string, { refCount: number }>
>()

/**
 * Get or create the cleanup map for a registry.
 *
 * @since 0.3.0
 * @category internal
 */
const getCallerCleanupMap = (
  registry: AtomRegistry.Registry,
): Map<string, { refCount: number }> => {
  let map = callerAtomCleanupRegistry.get(registry)
  if (!map) {
    map = new Map()
    callerAtomCleanupRegistry.set(registry, map)
  }
  return map
}

/**
 * Register a caller atom for cleanup tracking.
 * Increments the ref count for this caller key.
 *
 * @param registry - The effect-atom registry
 * @param callerKey - The caller key to track
 *
 * @since 0.3.0
 * @category internal
 */
export const registerCallerAtom = (registry: AtomRegistry.Registry, callerKey: string): void => {
  const map = getCallerCleanupMap(registry)
  const entry = map.get(callerKey)
  if (entry) {
    entry.refCount++
  } else {
    map.set(callerKey, { refCount: 1 })
  }
}

/**
 * Unregister a caller atom and clean up if no more references.
 * Decrements the ref count and removes the atom from the family cache
 * when the ref count reaches zero.
 *
 * @param registry - The effect-atom registry
 * @param callerKey - The caller key to unregister
 *
 * @since 0.3.0
 * @category internal
 */
export const unregisterCallerAtom = (registry: AtomRegistry.Registry, callerKey: string): void => {
  const map = getCallerCleanupMap(registry)
  const entry = map.get(callerKey)
  if (entry) {
    entry.refCount--
    if (entry.refCount <= 0) {
      map.delete(callerKey)
      // Reset the atom to initial state to help with GC
      // The atom family cache entry will be cleaned up by effect-atom's
      // idle TTL mechanism when no subscribers remain
      const atom = callerAtomFamily(callerKey)
      registry.set(atom, initialCallerState())
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Atoms (2-tier: Main + Writable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream state stored in atoms.
 *
 * @since 0.1.0
 * @category models
 */
export interface StreamAtomState<A, E> {
  readonly result: AtomResult.Result<readonly A[], E>
  readonly isStreaming: boolean
  readonly latestValue: A | null
}

/**
 * Create initial stream state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialStreamState = <A, E>(): StreamAtomState<A, E> => ({
  result: AtomResult.initial(),
  isStreaming: false,
  latestValue: null,
})

/**
 * Stream atom family - one atom per stream key.
 *
 * @since 0.1.0
 * @category atoms
 */
export const streamAtomFamily = Atom.family((_key: string) =>
  Atom.keepAlive(Atom.make<StreamAtomState<unknown, unknown>>(initialStreamState())),
)

/**
 * Writable stream atom for optimistic updates.
 *
 * @since 0.1.0
 * @category atoms
 */
export const writableStreamAtomFamily = Atom.family((key: string) =>
  Atom.writable(
    (get) => get(streamAtomFamily(key)),
    (ctx, update: StreamAtomState<unknown, unknown>) => {
      ctx.set(streamAtomFamily(key), update)
    },
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Atoms (2-tier + Connection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscription state stored in atoms.
 *
 * @since 0.1.0
 * @category models
 */
export interface SubscriptionAtomState<A, E> {
  readonly result: AtomResult.Result<readonly A[], E>
  readonly latestValue: A | null
  readonly isConnected: boolean
  readonly reconnectCount: number
}

/**
 * Create initial subscription state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialSubscriptionState = <A, E>(): SubscriptionAtomState<A, E> => ({
  result: AtomResult.initial(),
  latestValue: null,
  isConnected: false,
  reconnectCount: 0,
})

/**
 * Subscription atom family - one atom per subscription key.
 *
 * @since 0.1.0
 * @category atoms
 */
export const subscriptionAtomFamily = Atom.family((_key: string) =>
  Atom.keepAlive(Atom.make<SubscriptionAtomState<unknown, unknown>>(initialSubscriptionState())),
)

/**
 * Writable subscription atom for optimistic updates.
 *
 * @since 0.1.0
 * @category atoms
 */
export const writableSubscriptionAtomFamily = Atom.family((key: string) =>
  Atom.writable(
    (get) => get(subscriptionAtomFamily(key)),
    (ctx, update: SubscriptionAtomState<unknown, unknown>) => {
      ctx.set(subscriptionAtomFamily(key), update)
    },
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Chat Atoms (2-tier: Main + Writable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chat message part.
 *
 * @since 0.1.0
 * @category models
 */
export interface ChatPart {
  readonly type: "text" | "tool_call" | "tool_result" | "other"
  readonly content: unknown
}

/**
 * Chat state stored in atoms.
 *
 * @since 0.1.0
 * @category models
 */
export interface ChatAtomState<E> {
  readonly result: AtomResult.Result<readonly ChatPart[], E>
  readonly parts: readonly ChatPart[]
  readonly text: string
  readonly isStreaming: boolean
}

/**
 * Create initial chat state.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initialChatState = <E>(): ChatAtomState<E> => ({
  result: AtomResult.initial(),
  parts: [],
  text: "",
  isStreaming: false,
})

/**
 * Chat atom family - one atom per chat key.
 *
 * @since 0.1.0
 * @category atoms
 */
export const chatAtomFamily = Atom.family((_key: string) =>
  Atom.keepAlive(Atom.make<ChatAtomState<unknown>>(initialChatState())),
)

/**
 * Writable chat atom.
 *
 * @since 0.1.0
 * @category atoms
 */
export const writableChatAtomFamily = Atom.family((key: string) =>
  Atom.writable(
    (get) => get(chatAtomFamily(key)),
    (ctx, update: ChatAtomState<unknown>) => {
      ctx.set(chatAtomFamily(key), update)
    },
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Atom for Effect Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default HTTP client layer using fetch.
 *
 * @since 0.1.0
 * @category layers
 */
export const DefaultHttpClientLayer = FetchHttpClient.layer

/**
 * Create an AtomRuntime with HTTP client support.
 *
 * @since 0.1.0
 * @category constructors
 */
export const createRuntimeAtom = (
  layer: Layer.Layer<HttpClient.HttpClient> = DefaultHttpClientLayer,
) => Atom.runtime(layer)

// ─────────────────────────────────────────────────────────────────────────────
// Optimistic Update Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context for optimistic updates.
 *
 * @since 0.1.0
 * @category models
 */
export interface OptimisticContext<A> {
  readonly previousValue: A | undefined
  readonly rollback: () => void
  readonly commit: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Result Conversion Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert effect-atom Result to our QueryResult format.
 *
 * @since 0.1.0
 * @category utils
 */
export const atomResultToQueryResult = <A, E>(result: AtomResult.Result<A, E>) => {
  const data = AtomResult.value(result)
  const error = AtomResult.error(result)

  return {
    data: data._tag === "Some" ? data.value : undefined,
    error: error._tag === "Some" ? error.value : undefined,
    isLoading: AtomResult.isInitial(result) || result.waiting,
    isError: AtomResult.isFailure(result),
    isSuccess: AtomResult.isSuccess(result),
    isRefetching: AtomResult.isSuccess(result) && result.waiting,
    result,
  }
}

/**
 * Convert effect-atom Result to our MutationResult format.
 *
 * @since 0.1.0
 * @category utils
 */
export const atomResultToMutationResult = <A, E>(result: AtomResult.Result<A, E>) => {
  const data = AtomResult.value(result)
  const error = AtomResult.error(result)

  return {
    data: data._tag === "Some" ? data.value : undefined,
    error: error._tag === "Some" ? error.value : undefined,
    isPending: result.waiting,
    isError: AtomResult.isFailure(result),
    isSuccess: AtomResult.isSuccess(result),
    isIdle: AtomResult.isInitial(result) && !result.waiting,
    result,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Invalidation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invalidate a specific query by resetting it to initial state.
 * The query will refetch on next access.
 *
 * @param registry - The effect-atom registry
 * @param key - The query key to invalidate
 *
 * @since 0.1.0
 * @category invalidation
 */
export const invalidateQueryByKey = (registry: AtomRegistry.Registry, key: string): void => {
  const registeredKeys = getRegisteredQueryKeys(registry)
  if (registeredKeys.has(key)) {
    const atom = queryAtomFamily(key)
    // Reset to initial state to trigger refetch
    registry.set(atom, initialQueryState())
  }
}

/**
 * Invalidate all queries matching a path prefix.
 *
 * @param registry - The effect-atom registry
 * @param pathPrefix - The path prefix to match (e.g., "user" matches "user.list", "user.byId:123")
 *
 * @since 0.1.0
 * @category invalidation
 */
export const invalidateQueriesByPrefix = (
  registry: AtomRegistry.Registry,
  pathPrefix: string,
): void => {
  const registeredKeys = getRegisteredQueryKeys(registry)
  for (const key of registeredKeys) {
    if (key.startsWith(pathPrefix)) {
      const atom = queryAtomFamily(key)
      registry.set(atom, initialQueryState())
    }
  }
}

/**
 * Invalidate all queries.
 *
 * @param registry - The effect-atom registry
 *
 * @since 0.1.0
 * @category invalidation
 */
export const invalidateAllQueries = (registry: AtomRegistry.Registry): void => {
  const registeredKeys = getRegisteredQueryKeys(registry)
  for (const key of registeredKeys) {
    const atom = queryAtomFamily(key)
    registry.set(atom, initialQueryState())
  }
}

/**
 * Get query data from the cache.
 *
 * @param registry - The effect-atom registry
 * @param path - The procedure path
 * @param input - The query input
 * @returns The cached data, or undefined if not cached
 *
 * @since 0.1.0
 * @category cache
 */
export const getQueryData = <T>(
  registry: AtomRegistry.Registry,
  path: string,
  input: unknown,
): T | undefined => {
  const key = generateQueryKey(path, input)
  const registeredKeys = getRegisteredQueryKeys(registry)
  if (!registeredKeys.has(key)) return undefined

  const atom = queryAtomFamily(key)
  const state = registry.get(atom)

  if (AtomResult.isSuccess(state.result)) {
    return state.result.value as T
  }
  return undefined
}

/**
 * Set query data in the cache.
 *
 * @param registry - The effect-atom registry
 * @param path - The procedure path
 * @param input - The query input
 * @param data - The data to set (or updater function)
 *
 * @since 0.1.0
 * @category cache
 */
export const setQueryData = <T>(
  registry: AtomRegistry.Registry,
  path: string,
  input: unknown,
  data: T | ((old: T | undefined) => T),
): void => {
  const key = generateQueryKey(path, input)
  const atom = queryAtomFamily(key)

  // Get current data if using updater function
  let newData: T
  if (typeof data === "function") {
    const updater = data as (old: T | undefined) => T
    const currentState = registry.get(atom)
    const currentData = AtomResult.isSuccess(currentState.result)
      ? (currentState.result.value as T)
      : undefined
    newData = updater(currentData)
  } else {
    newData = data
  }

  // Set the new data - clear previousError since we have fresh data
  registry.set(atom, {
    result: AtomResult.success(newData),
    lastFetchedAt: Date.now(),
    previousError: null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Utilities (for optimistic updates)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utilities for interacting with the query cache.
 * Used in optimistic update callbacks.
 *
 * @since 0.1.0
 * @category cache
 */
export interface AtomCacheUtils {
  readonly getQueryData: <T>(path: string, input?: unknown) => T | undefined
  readonly setQueryData: <T>(
    path: string,
    input: unknown,
    data: T | ((old: T | undefined) => T),
  ) => void
  readonly invalidate: (path: string, input?: unknown) => void
}

/**
 * Create cache utilities for a given registry.
 * This is the atom-based replacement for the legacy createCacheUtils.
 *
 * @param registry - The effect-atom registry
 * @returns AtomCacheUtils object for interacting with the cache
 *
 * @since 0.1.0
 * @category constructors
 */
export const createAtomCacheUtils = (registry: AtomRegistry.Registry): AtomCacheUtils => ({
  getQueryData: <T>(path: string, input?: unknown): T | undefined => {
    return getQueryData<T>(registry, path, input)
  },

  setQueryData: <T>(path: string, input: unknown, data: T | ((old: T | undefined) => T)): void => {
    setQueryData(registry, path, input, data)
  },

  invalidate: (path: string, input?: unknown): void => {
    if (input !== undefined) {
      const key = generateQueryKey(path, input)
      invalidateQueryByKey(registry, key)
    } else {
      invalidateQueriesByPrefix(registry, path)
    }
  },
})
