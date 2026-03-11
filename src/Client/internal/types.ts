/**
 * Internal types for Client module
 * @internal
 */

/**
 * Query result states (mirrors Effect Atom's Result)
 */
export type QueryResult<A, E> =
  | { readonly _tag: "Initial" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Refreshing"; readonly value: A }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

/**
 * Result constructors
 */
export const QueryResult = {
  initial: <A, E>(): QueryResult<A, E> => ({ _tag: "Initial" }),
  loading: <A, E>(): QueryResult<A, E> => ({ _tag: "Loading" }),
  refreshing: <A, E>(value: A): QueryResult<A, E> => ({ _tag: "Refreshing", value }),
  success: <A, E>(value: A): QueryResult<A, E> => ({ _tag: "Success", value }),
  failure: <A, E>(error: E): QueryResult<A, E> => ({ _tag: "Failure", error }),

  isInitial: <A, E>(r: QueryResult<A, E>): r is { readonly _tag: "Initial" } =>
    r._tag === "Initial",
  isLoading: <A, E>(r: QueryResult<A, E>): r is { readonly _tag: "Loading" } =>
    r._tag === "Loading",
  isRefreshing: <A, E>(r: QueryResult<A, E>): r is { readonly _tag: "Refreshing"; readonly value: A } =>
    r._tag === "Refreshing",
  isSuccess: <A, E>(r: QueryResult<A, E>): r is { readonly _tag: "Success"; readonly value: A } =>
    r._tag === "Success",
  isFailure: <A, E>(r: QueryResult<A, E>): r is { readonly _tag: "Failure"; readonly error: E } =>
    r._tag === "Failure",

  getValue: <A, E>(r: QueryResult<A, E>): A | undefined =>
    r._tag === "Success" || r._tag === "Refreshing" ? r.value : undefined,

  getError: <A, E>(r: QueryResult<A, E>): E | undefined =>
    r._tag === "Failure" ? r.error : undefined,
}

/**
 * Serialized state for SSR hydration
 */
export interface DehydratedState {
  readonly queries: ReadonlyArray<{
    readonly key: string
    readonly value: unknown
    readonly timestamp: number
  }>
}
