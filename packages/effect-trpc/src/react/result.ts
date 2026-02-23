/**
 * @module effect-trpc/react/result
 *
 * Result type for representing async state in React components.
 * Inspired by effect-atom's Result type.
 *
 * Uses Data.TaggedClass for structural equality, which enables:
 * - Proper comparison in React's useSyncExternalStore
 * - Efficient memoization with useMemo
 * - Effect's built-in equality checks
 */

import * as Data from "effect/Data"

// ─────────────────────────────────────────────────────────────────────────────
// Result Types using Data.TaggedClass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initial state - query has not started yet.
 *
 * @since 0.1.0
 * @category models
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class Initial extends Data.TaggedClass("Initial")<{}> {}

/**
 * Loading state - query is in progress.
 *
 * @since 0.1.0
 * @category models
 */
export class Loading<A> extends Data.TaggedClass("Loading")<{
  /**
   * Previous successful value, if any.
   */
  readonly previous: A | undefined
}> {}

/**
 * Success state - query completed successfully.
 *
 * @since 0.1.0
 * @category models
 */
export class Success<A> extends Data.TaggedClass("Success")<{
  readonly value: A
  /**
   * True if currently refetching in the background.
   */
  readonly isRefetching: boolean
}> {}

/**
 * Failure state - query failed with an error.
 *
 * @since 0.1.0
 * @category models
 */
export class Failure<A, E> extends Data.TaggedClass("Failure")<{
  readonly error: E
  /**
   * Previous successful value, if any.
   */
  readonly previous: A | undefined
  /**
   * True if currently retrying.
   */
  readonly isRetrying: boolean
}> {}

/**
 * Result represents the state of an async operation.
 *
 * @since 0.1.0
 * @category models
 */
export type Result<A, E = unknown> =
  | Initial
  | Loading<A>
  | Success<A>
  | Failure<A, E>

// ─────────────────────────────────────────────────────────────────────────────
// Constructors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The initial result state singleton.
 *
 * @since 0.1.0
 * @category constructors
 */
export const initial: Initial = new Initial()

/**
 * Create a loading result.
 *
 * @param previous - The previous successful value, if any
 *
 * @since 0.1.0
 * @category constructors
 */
export const loading = <A>(previous?: A): Loading<A> =>
  new Loading({ previous })

/**
 * Create a success result.
 *
 * @param value - The successful value
 * @param isRefetching - Whether the query is currently refetching in the background
 *
 * @since 0.1.0
 * @category constructors
 */
export const success = <A>(value: A, isRefetching = false): Success<A> =>
  new Success({ value, isRefetching })

/**
 * Create a failure result.
 *
 * @param error - The error that occurred
 * @param previous - The previous successful value, if any
 * @param isRetrying - Whether the query is currently retrying
 *
 * @since 0.1.0
 * @category constructors
 */
export const failure = <A, E>(
  error: E,
  previous?: A,
  isRetrying = false,
): Failure<A, E> =>
  new Failure({ error, previous, isRetrying })

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a result is in the initial state.
 *
 * @since 0.1.0
 * @category guards
 */
export const isInitial = <A, E>(result: Result<A, E>): result is Initial =>
  result._tag === "Initial"

/**
 * Check if a result is in the loading state.
 *
 * @since 0.1.0
 * @category guards
 */
export const isLoading = <A, E>(result: Result<A, E>): result is Loading<A> =>
  result._tag === "Loading"

/**
 * Check if a result is in the success state.
 *
 * @since 0.1.0
 * @category guards
 */
export const isSuccess = <A, E>(result: Result<A, E>): result is Success<A> =>
  result._tag === "Success"

/**
 * Check if a result is in the failure state.
 *
 * @since 0.1.0
 * @category guards
 */
export const isFailure = <A, E>(
  result: Result<A, E>,
): result is Failure<A, E> => result._tag === "Failure"

// ─────────────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the value if success, or the previous value if loading/failure.
 *
 * @since 0.1.0
 * @category utils
 */
export const getValue = <A, E>(result: Result<A, E>): A | undefined => {
  switch (result._tag) {
    case "Initial":
      return undefined
    case "Loading":
      return result.previous
    case "Success":
      return result.value
    case "Failure":
      return result.previous
  }
}

/**
 * Get the value if success, or a fallback value.
 *
 * @since 0.1.0
 * @category utils
 */
export const getOrElse = <A, E>(result: Result<A, E>, fallback: () => A): A => {
  if (isSuccess(result)) {
    return result.value
  }
  return fallback()
}

/**
 * Get the error if failure.
 *
 * @since 0.1.0
 * @category utils
 */
export const getError = <A, E>(result: Result<A, E>): E | undefined => {
  if (isFailure(result)) {
    return result.error
  }
  return undefined
}

/**
 * Check if the result is in any loading state (initial, loading, or refetching).
 *
 * @since 0.1.0
 * @category guards
 */
export const isPending = <A, E>(result: Result<A, E>): boolean => {
  switch (result._tag) {
    case "Initial":
    case "Loading":
      return true
    case "Success":
      return result.isRefetching
    case "Failure":
      return result.isRetrying
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pattern matcher for Result types.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResultMatcher<A, E, R> {
  readonly onInitial: () => R
  readonly onLoading: (previous: A | undefined) => R
  readonly onSuccess: (value: A, isRefetching: boolean) => R
  readonly onFailure: (error: E, previous: A | undefined, isRetrying: boolean) => R
}

/**
 * Pattern match on a Result.
 *
 * @since 0.1.0
 * @category utils
 */
export const match = <A, E, R>(
  result: Result<A, E>,
  matcher: ResultMatcher<A, E, R>,
): R => {
  switch (result._tag) {
    case "Initial":
      return matcher.onInitial()
    case "Loading":
      return matcher.onLoading(result.previous)
    case "Success":
      return matcher.onSuccess(result.value, result.isRefetching)
    case "Failure":
      return matcher.onFailure(result.error, result.previous, result.isRetrying)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience type for query results in React.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryResult<A, E = unknown> {
  readonly data: A | undefined
  readonly error: E | undefined
  readonly isLoading: boolean
  readonly isError: boolean
  readonly isSuccess: boolean
  readonly isRefetching: boolean
  readonly result: Result<A, E>
}

/**
 * Convert a Result to a QueryResult for easier use in components.
 *
 * @since 0.1.0
 * @category utils
 */
export const toQueryResult = <A, E>(result: Result<A, E>): QueryResult<A, E> => ({
  data: getValue(result),
  error: getError(result),
  isLoading: isInitial(result) || isLoading(result),
  isError: isFailure(result),
  isSuccess: isSuccess(result),
  isRefetching: isSuccess(result) && result.isRefetching,
  result,
})

/**
 * Convenience type for mutation results in React.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationResult<A, E = unknown> {
  readonly data: A | undefined
  readonly error: E | undefined
  readonly isPending: boolean
  readonly isError: boolean
  readonly isSuccess: boolean
  readonly isIdle: boolean
  readonly result: Result<A, E>
}

/**
 * Convert a Result to a MutationResult for easier use in components.
 *
 * @since 0.1.0
 * @category utils
 */
export const toMutationResult = <A, E>(
  result: Result<A, E>,
): MutationResult<A, E> => ({
  data: getValue(result),
  error: getError(result),
  isPending: isLoading(result),
  isError: isFailure(result),
  isSuccess: isSuccess(result),
  isIdle: isInitial(result),
  result,
})
