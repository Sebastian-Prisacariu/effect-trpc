/**
 * Result module stub
 * @module
 */

// TODO: Implement

export type Result<A, E> =
  | { readonly _tag: "Initial" }
  | { readonly _tag: "Waiting"; readonly previous?: unknown }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

export const initial = null as any
export const waiting = null as any
export const success = null as any
export const failure = null as any

export const isInitial = null as any
export const isWaiting = null as any
export const isSuccess = null as any
export const isFailure = null as any
export const isLoading = null as any

export const getValue = null as any
export const getError = null as any

export const match = null as any
export const matchSimple = null as any

export const map = null as any
export const mapError = null as any
export const getOrElse = null as any
