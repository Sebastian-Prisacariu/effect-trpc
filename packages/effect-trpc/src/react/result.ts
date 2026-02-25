/**
 * @module effect-trpc/react/result
 *
 * Re-exports effect-atom's Result module for pattern matching async state,
 * plus helper functions for converting to tRPC-compatible result formats.
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

import { Result as AtomResult } from "@effect-atom/atom"
import * as Option from "effect/Option"

// ─────────────────────────────────────────────────────────────────────────────
// Re-export effect-atom's Result namespace
// ─────────────────────────────────────────────────────────────────────────────

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
export { AtomResult as Result }

// ─────────────────────────────────────────────────────────────────────────────
// Conversion utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an effect-atom Result to a tRPC-compatible QueryResult.
 *
 * @example
 * ```typescript
 * import { toQueryResult, Result } from 'effect-trpc/react'
 *
 * const result = Result.success({ name: "Alice" })
 * const qr = toQueryResult(result)
 *
 * console.log(qr.data)      // { name: "Alice" }
 * console.log(qr.isSuccess) // true
 * console.log(qr.isLoading) // false
 * ```
 *
 * @since 0.3.0
 */
export const toQueryResult = <A, E>(
  result: AtomResult.Result<A, E>,
  previousError: E | null = null,
  refetch: () => void = () => {},
): QueryResult<A, E> => {
  const dataOption = AtomResult.value(result)
  const errorOption = AtomResult.error(result)
  const hasData = AtomResult.isSuccess(result)
  const isWaiting = result.waiting || AtomResult.isInitial(result)

  return {
    data: Option.isSome(dataOption) ? dataOption.value : undefined,
    error: Option.isSome(errorOption) ? errorOption.value : undefined,
    previousError,
    isLoading: !hasData && isWaiting,
    isError: AtomResult.isFailure(result),
    isSuccess: AtomResult.isSuccess(result) && !result.waiting,
    isRefetching: hasData && result.waiting,
    result,
    refetch,
  }
}

/**
 * Convert an effect-atom Result to a tRPC-compatible MutationResult.
 *
 * @example
 * ```typescript
 * import { toMutationResult, Result } from 'effect-trpc/react'
 *
 * const result = Result.initial()
 * const mr = toMutationResult(result)
 *
 * console.log(mr.isIdle)    // true
 * console.log(mr.isPending) // false
 * ```
 *
 * @since 0.3.0
 */
export const toMutationResult = <A, E>(result: AtomResult.Result<A, E>): MutationResult<A, E> => {
  const dataOption = AtomResult.value(result)
  const errorOption = AtomResult.error(result)

  return {
    data: Option.isSome(dataOption) ? dataOption.value : undefined,
    error: Option.isSome(errorOption) ? errorOption.value : undefined,
    isPending: result.waiting,
    isError: AtomResult.isFailure(result),
    isSuccess: AtomResult.isSuccess(result) && !result.waiting,
    isIdle: AtomResult.isInitial(result) && !result.waiting,
    result,
  }
}

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
   * The previous error that occurred before the current retry attempt.
   * Preserved during retries so UI can show both loading and error state.
   * Cleared only on successful fetch.
   *
   * @example
   * ```typescript
   * const { error, previousError, isFetching } = api.user.list.useQuery()
   *
   * if (isFetching && previousError) {
   *   return <div>Retrying... (Previous error: {previousError.message})</div>
   * }
   * ```
   */
  readonly previousError: E | null
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
  readonly result: AtomResult.Result<A, E>
  /** Manually trigger a refetch */
  readonly refetch: () => void
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
  readonly result: AtomResult.Result<A, E>
}
