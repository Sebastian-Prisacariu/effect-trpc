/**
 * @module effect-trpc/react/result
 *
 * Re-exports effect-atom's Result module for pattern matching async state.
 *
 * The Result type represents the state of an async operation (query, mutation, etc.)
 * and provides a powerful builder API for rendering different states.
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
 *     .onErrorTag('UnauthorizedError', () => <LoginPrompt />)
 *     .onError((error) => <GenericError error={error} />)
 *     .render()
 * }
 * ```
 *
 * @since 0.1.0
 */

import { Result } from "@effect-atom/atom"

/**
 * Re-export effect-atom's Result namespace.
 *
 * Provides:
 * - `Result.Result<A, E>` - The Result type (Initial | Success | Failure)
 * - `Result.Initial<A, E>` - Initial state type
 * - `Result.Success<A, E>` - Success state type
 * - `Result.Failure<A, E>` - Failure state type
 * - `Result.builder(result)` - Builder for pattern matching (recommended!)
 * - `Result.initial()` - Create initial state
 * - `Result.success(value)` - Create success state
 * - `Result.failure(cause)` - Create failure state from Cause
 * - `Result.fail(error)` - Create failure state from error value
 * - `Result.isInitial(result)` - Check if initial
 * - `Result.isSuccess(result)` - Check if success
 * - `Result.isFailure(result)` - Check if failure
 * - `Result.isWaiting(result)` - Check if loading/waiting
 * - `Result.match(result, { onInitial, onSuccess, onFailure })` - Pattern match
 * - And many more...
 *
 * @since 0.1.0
 */
export { Result }

// ─────────────────────────────────────────────────────────────────────────────
// tRPC-compatible helper interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience type for query results in React.
 * Provides a tRPC-like API alongside the effect-atom Result.
 *
 * @example
 * ```typescript
 * // tRPC-style destructuring
 * const { data, isLoading, error } = api.user.list.useQuery()
 *
 * // Or use the Result builder pattern
 * const query = api.user.list.useQuery()
 * return Result.builder(query.result)
 *   .onInitial(() => <Skeleton />)
 *   .onSuccess((users) => <List users={users} />)
 *   .onError((e) => <Error error={e} />)
 *   .render()
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryResult<A, E = unknown> {
  /** The data if query succeeded */
  readonly data: A | undefined
  /** The error if query failed */
  readonly error: E | undefined
  /**
   * True only when loading with NO data (first load).
   * False once we have data, even if refetching.
   * @remarks
   * This matches TanStack Query semantics where isLoading means
   * "loading AND no cached data". Use isFetching for any loading state.
   */
  readonly isLoading: boolean
  /** True if query failed */
  readonly isError: boolean
  /** True if query succeeded */
  readonly isSuccess: boolean
  /**
   * True when we have cached data AND are fetching fresh data.
   * Useful for showing subtle loading indicators without hiding content.
   */
  readonly isRefetching: boolean
  /** The raw effect-atom Result for builder pattern */
  readonly result: Result.Result<A, E>
}

/**
 * Convenience type for mutation results in React.
 * Provides a tRPC-like API alongside the effect-atom Result.
 *
 * @example
 * ```typescript
 * // tRPC-style destructuring
 * const { mutateAsync, isPending, error } = api.user.create.useMutation()
 *
 * // Or use the Result builder pattern
 * const mutation = api.user.create.useMutation()
 * return Result.builder(mutation.result)
 *   .onInitial(() => <Button>Create</Button>)
 *   .onWaiting(() => <Button disabled>Creating...</Button>)
 *   .onSuccess(() => <Success />)
 *   .onError((e) => <Error error={e} />)
 *   .render()
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationResult<A, E = unknown> {
  /** The data if mutation succeeded */
  readonly data: A | undefined
  /** The error if mutation failed */
  readonly error: E | undefined
  /** True if mutation is in progress */
  readonly isPending: boolean
  /** True if mutation failed */
  readonly isError: boolean
  /** True if mutation succeeded */
  readonly isSuccess: boolean
  /** True if mutation hasn't been called yet */
  readonly isIdle: boolean
  /** The raw effect-atom Result for builder pattern */
  readonly result: Result.Result<A, E>
}
