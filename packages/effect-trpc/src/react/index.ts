/**
 * React hooks and utilities for effect-trpc.
 *
 * @remarks
 * **SSR Support**
 *
 * All hooks support server-side rendering via `useSyncExternalStore`'s
 * `getServerSnapshot` callback. During SSR:
 * - `useQuery` returns `Result.initial` or `initialData` if provided
 * - `useMutation` returns the initial mutation state
 * - `useStream` and `useChat` return their initial states
 *
 * For data fetching during SSR, use the vanilla client directly in
 * server components or getServerSideProps, then pass data via props
 * or initialData.
 *
 * @example
 * ```tsx
 * import { createTRPCReact } from 'effect-trpc/react'
 * import type { appRouter } from '~/server/trpc'
 *
 * // Create typed client
 * export const trpc = createTRPCReact<typeof appRouter>()
 *
 * // Wrap your app (URL is configured once in createTRPCReact)
 * function App() {
 *   return (
 *     <trpc.Provider>
 *       <UserList />
 *     </trpc.Provider>
 *   )
 * }
 *
 * // Use hooks
 * function UserList() {
 *   const { data, isLoading } = trpc.procedures.user.list.useQuery()
 *   const { mutateAsync } = trpc.procedures.user.create.useMutation()
 *
 *   return (
 *     <div>
 *       {isLoading ? 'Loading...' : data?.map(u => <div key={u.id}>{u.name}</div>)}
 *       <button onClick={() => mutateAsync({ name: 'New User' })}>Add</button>
 *     </div>
 *   )
 * }
 * ```
 *
 * @since 0.1.0
 * @module
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result type for async state (re-exported from @effect-atom/atom)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result namespace from effect-atom for pattern matching async state.
 *
 * @example
 * ```typescript
 * import { Result } from 'effect-trpc/react'
 *
 * function UserList() {
 *   const query = api.user.list.useQuery()
 *
 *   return Result.builder(query.result)
 *     .onInitial(() => <Skeleton />)
 *     .onWaiting(() => <Spinner />)
 *     .onSuccess((users) => <List users={users} />)
 *     .onErrorTag('NotFoundError', () => <NotFound />)
 *     .onError((error) => <GenericError error={error} />)
 *     .render()
 * }
 * ```
 */
export { Result, type QueryResult, type MutationResult } from "./result.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client creation and hooks
// ─────────────────────────────────────────────────────────────────────────────

export type {
  CreateTRPCReactOptions,
  TRPCReactClient,
  TRPCProviderProps,
  ProcedureMetadata,
  ProcedureMetadataRegistry,
  TracingConfig,
  UseQueryOptions,
  GlobalQueryOptions,
  UseQueryReturn,
  UseSuspenseQueryOptions,
  UseSuspenseQueryReturn,
  UseMutationOptions,
  UseMutationReturn,
  UseStreamOptions,
  UseStreamReturn,
  UseChatOptions,
  UseChatReturn,
  UseUtilsReturn,
  OptimisticUpdateConfig,
} from "./create-client.js"

export { createTRPCReact } from "./create-client.js"

// ─────────────────────────────────────────────────────────────────────────────
// Atom-based state management (recommended)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AtomCacheUtils,
  Registry,
  QueryAtomState,
  MutationMainState,
  MutationCallerState,
  StreamAtomState,
  SubscriptionAtomState,
  ChatAtomState,
} from "./atoms.js"

export {
  useRegistry,
  RegistryProvider,
  generateQueryKey,
  generateMutationKey,
  generateCallerKey,
  registerQueryKey,
  getRegisteredQueryKeys,
  invalidateQueryByKey,
  invalidateQueriesByPrefix,
  invalidateAllQueries,
  getQueryData,
  setQueryData,
  createAtomCacheUtils,
  // Atom families for advanced usage
  queryAtomFamily,
  callerAtomFamily,
  streamAtomFamily,
  chatAtomFamily,
  subscriptionAtomFamily,
} from "./atoms.js"

// ─────────────────────────────────────────────────────────────────────────────
// Subscription hook and provider
// ─────────────────────────────────────────────────────────────────────────────

export type {
  UseSubscriptionOptions,
  UseSubscriptionReturn,
  WebSocketProviderProps,
} from "./subscription.js"

export {
  useSubscription,
  WebSocketProvider,
  createSubscriptionHook,
  SubscriptionState,
  ConnectionState,
} from "./subscription.js"

// ─────────────────────────────────────────────────────────────────────────────
// Automatic Refetching Utilities
// ─────────────────────────────────────────────────────────────────────────────

export {
  isStale,
  subscribeToWindowFocus,
  subscribeToNetworkReconnect,
  isDocumentVisible,
} from "./signals.js"

export { keepPreviousData, queryPresets } from "./presets.js"

// ─────────────────────────────────────────────────────────────────────────────
// Server Client (SSR/RSC)
// ─────────────────────────────────────────────────────────────────────────────
//
// Server-side utilities are in a separate subpath to avoid bundling server code
// with client-only hooks. Import from "effect-trpc/react/server" instead:
//
// import { createServerClient } from "effect-trpc/react/server"
//
// This keeps the client bundle smaller (~22KB savings).
// ─────────────────────────────────────────────────────────────────────────────
