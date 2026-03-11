/**
 * Result - Query result states and pattern matching
 * 
 * @since 1.0.0
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Query result states (mirrors Effect Atom's Result)
 * 
 * @since 1.0.0
 * @category models
 */
export type Result<A, E> =
  | Initial
  | Waiting
  | Success<A>
  | Failure<E>

/**
 * @since 1.0.0
 * @category models
 */
export interface Initial {
  readonly _tag: "Initial"
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Waiting {
  readonly _tag: "Waiting"
  readonly previous?: unknown
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Success<A> {
  readonly _tag: "Success"
  readonly value: A
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Failure<E> {
  readonly _tag: "Failure"
  readonly error: E
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * @since 1.0.0
 * @category constructors
 */
export const initial = (): Initial => ({ _tag: "Initial" })

/**
 * @since 1.0.0
 * @category constructors
 */
export const waiting = (previous?: unknown): Waiting => ({ _tag: "Waiting", previous })

/**
 * @since 1.0.0
 * @category constructors
 */
export const success = <A>(value: A): Success<A> => ({ _tag: "Success", value })

/**
 * @since 1.0.0
 * @category constructors
 */
export const failure = <E>(error: E): Failure<E> => ({ _tag: "Failure", error })

// =============================================================================
// Guards
// =============================================================================

/**
 * @since 1.0.0
 * @category guards
 */
export const isInitial = <A, E>(result: Result<A, E>): result is Initial =>
  result._tag === "Initial"

/**
 * @since 1.0.0
 * @category guards
 */
export const isWaiting = <A, E>(result: Result<A, E>): result is Waiting =>
  result._tag === "Waiting"

/**
 * @since 1.0.0
 * @category guards
 */
export const isSuccess = <A, E>(result: Result<A, E>): result is Success<A> =>
  result._tag === "Success"

/**
 * @since 1.0.0
 * @category guards
 */
export const isFailure = <A, E>(result: Result<A, E>): result is Failure<E> =>
  result._tag === "Failure"

/**
 * @since 1.0.0
 * @category guards
 */
export const isLoading = <A, E>(result: Result<A, E>): boolean =>
  result._tag === "Initial" || result._tag === "Waiting"

// =============================================================================
// Getters
// =============================================================================

/**
 * @since 1.0.0
 * @category getters
 */
export const getValue = <A, E>(result: Result<A, E>): A | undefined =>
  result._tag === "Success" ? result.value : undefined

/**
 * @since 1.0.0
 * @category getters
 */
export const getError = <A, E>(result: Result<A, E>): E | undefined =>
  result._tag === "Failure" ? result.error : undefined

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * @since 1.0.0
 * @category models
 */
export interface MatchHandlers<A, E, R> {
  readonly onInitial: () => R
  readonly onWaiting: (previous?: A) => R
  readonly onSuccess: (value: A) => R
  readonly onFailure: (error: E) => R
}

/**
 * Pattern match on a Result
 * 
 * @since 1.0.0
 * @category pattern matching
 * @example
 * ```ts
 * Result.match(query.result, {
 *   onInitial: () => <Loading />,
 *   onWaiting: () => <Refreshing />,
 *   onSuccess: (users) => <UserList users={users} />,
 *   onFailure: (error) => <Error error={error} />,
 * })
 * ```
 */
export const match = <A, E, R>(
  result: Result<A, E>,
  handlers: MatchHandlers<A, E, R>
): R => {
  switch (result._tag) {
    case "Initial":
      return handlers.onInitial()
    case "Waiting":
      return handlers.onWaiting(result.previous as A | undefined)
    case "Success":
      return handlers.onSuccess(result.value)
    case "Failure":
      return handlers.onFailure(result.error)
  }
}

/**
 * Simplified match with just loading/success/error
 * 
 * @since 1.0.0
 * @category pattern matching
 */
export interface SimpleMatchHandlers<A, E, R> {
  readonly onLoading: () => R
  readonly onSuccess: (value: A) => R
  readonly onFailure: (error: E) => R
}

/**
 * @since 1.0.0
 * @category pattern matching
 */
export const matchSimple = <A, E, R>(
  result: Result<A, E>,
  handlers: SimpleMatchHandlers<A, E, R>
): R => {
  switch (result._tag) {
    case "Initial":
    case "Waiting":
      return handlers.onLoading()
    case "Success":
      return handlers.onSuccess(result.value)
    case "Failure":
      return handlers.onFailure(result.error)
  }
}

// =============================================================================
// Transformations
// =============================================================================

/**
 * @since 1.0.0
 * @category transformations
 */
export const map = <A, E, B>(
  result: Result<A, E>,
  f: (a: A) => B
): Result<B, E> => {
  if (result._tag === "Success") {
    return success(f(result.value))
  }
  return result as Result<B, E>
}

/**
 * @since 1.0.0
 * @category transformations
 */
export const mapError = <A, E, E2>(
  result: Result<A, E>,
  f: (e: E) => E2
): Result<A, E2> => {
  if (result._tag === "Failure") {
    return failure(f(result.error))
  }
  return result as Result<A, E2>
}

/**
 * @since 1.0.0
 * @category transformations
 */
export const getOrElse = <A, E>(
  result: Result<A, E>,
  defaultValue: () => A
): A => {
  if (result._tag === "Success") {
    return result.value
  }
  return defaultValue()
}
