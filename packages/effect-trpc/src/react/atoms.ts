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
 * Atom that tracks all active query keys.
 * Scoped to the registry, so each test gets a fresh set.
 * Used for prefix-based invalidation.
 *
 * @since 0.1.0
 * @category atoms
 */
export const queryKeysAtom: Atom.Writable<ReadonlySet<string>> = Atom.keepAlive(
  Atom.make(new Set<string>() as ReadonlySet<string>),
)

/**
 * Register a query key in the registry.
 * Called when a query hook mounts.
 *
 * @param registry - The effect-atom registry
 * @param key - The query key to register
 *
 * @since 0.1.0
 * @category utils
 */
export const registerQueryKey = (registry: AtomRegistry.Registry, key: string): void => {
  const currentKeys = registry.get(queryKeysAtom)
  if (!currentKeys.has(key)) {
    const newKeys = new Set(currentKeys)
    newKeys.add(key)
    registry.set(queryKeysAtom, newKeys)
  }
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
  return registry.get(queryKeysAtom)
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
 * Generate a stable key for queries/streams (includes input).
 *
 * @since 0.1.0
 * @category utils
 */
export const generateQueryKey = (path: string, input: unknown): string => {
  if (input === undefined) {
    return `${path}:`
  }
  try {
    // Handle BigInt and other non-serializable types

    const inputKey = JSON.stringify(input, (_key, value) =>
      typeof value === "bigint" ? `BigInt(${value.toString()})` : value,
    )
    return `${path}:${inputKey}`
  } catch {
    // Fallback for circular references or other serialization issues
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Intentional fallback for non-serializable input
    return `${path}:${String(input)}`
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
  `${path}:caller:${callerId}`

// ─────────────────────────────────────────────────────────────────────────────
// Query Atoms (2-tier: Main + Writable)
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
 * @since 0.1.0
 * @category atoms
 */
export const callerAtomFamily = Atom.family((_callerKey: string) =>
  Atom.make<MutationCallerState<unknown>>(initialCallerState()),
)

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

  // Set the new data
  registry.set(atom, {
    result: AtomResult.success(newData),
    lastFetchedAt: Date.now(),
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
