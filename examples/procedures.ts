/**
 * Shared procedure definitions.
 * 
 * This file defines the RPC contracts using Effect RPC.
 * It's shared between server and client.
 */

import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.Date,
}) {}

export class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

export class UpdateUserInput extends Schema.Class<UpdateUserInput>("UpdateUserInput")({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class NotFoundError extends Schema.TaggedError<NotFoundError>("NotFoundError")({
  message: Schema.String,
  entityId: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")({
  message: Schema.String,
  field: Schema.String,
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Group
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User RPCs — the contract.
 * 
 * This defines WHAT operations exist, not HOW they're implemented.
 */
export class UserRpcs extends RpcGroup.make(
  // Queries
  Rpc.make("list", {
    success: Schema.Array(User),
  }),
  
  Rpc.make("byId", {
    success: User,
    error: NotFoundError,
    payload: {
      id: Schema.String,
    },
  }),
  
  Rpc.make("byEmail", {
    success: User,
    error: NotFoundError,
    payload: {
      email: Schema.String,
    },
  }),
  
  // Mutations
  Rpc.make("create", {
    success: User,
    error: ValidationError,
    payload: CreateUserInput,
  }),
  
  Rpc.make("update", {
    success: User,
    error: Schema.Union(NotFoundError, ValidationError),
    payload: UpdateUserInput,
  }),
  
  Rpc.make("delete", {
    success: Schema.Void,
    error: NotFoundError,
    payload: {
      id: Schema.String,
    },
  }),
) {}
