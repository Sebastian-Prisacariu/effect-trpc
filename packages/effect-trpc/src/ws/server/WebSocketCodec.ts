/**
 * @module effect-trpc/ws/server/WebSocketCodec
 *
 * Service for encoding/decoding WebSocket messages.
 * Default implementation uses NDJSON (matches HTTP streaming).
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  FromClientMessage,
  FromServerMessage,
  type FromClientMessage as FromClientMessageType,
  type FromServerMessage as FromServerMessageType,
} from "../protocol.js"
import { WebSocketProtocolError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for WebSocket message encoding/decoding.
 */
export interface WebSocketCodecShape {
  /**
   * Decode a raw message (string or binary) into a FromClientMessage.
   */
  readonly decode: (
    raw: string | Uint8Array,
  ) => Effect.Effect<FromClientMessageType, WebSocketProtocolError>

  /**
   * Encode a FromServerMessage to send over the wire.
   */
  readonly encode: (
    message: FromServerMessageType,
  ) => Effect.Effect<string | Uint8Array, WebSocketProtocolError>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for WebSocketCodec service.
 *
 * @example
 * ```ts
 * import { WebSocketCodec } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const codec = yield* WebSocketCodec
 *   // ...
 * }).pipe(Effect.provide(WebSocketCodec.Live))
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class WebSocketCodec extends Context.Tag("@effect-trpc/WebSocketCodec")<
  WebSocketCodec,
  WebSocketCodecShape
>() {
  /**
   * Default NDJSON codec layer.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<WebSocketCodec>
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Implementation (NDJSON)
// ─────────────────────────────────────────────────────────────────────────────

// Lazy TextDecoder initialization to avoid issues in environments
// where TextDecoder isn't available at module load time
let textDecoder: TextDecoder | undefined

const getTextDecoder = (): TextDecoder => {
  if (!textDecoder) {
    textDecoder = new TextDecoder()
  }
  return textDecoder
}

/**
 * Create the default NDJSON codec implementation.
 */
const makeNdjsonCodec = Effect.sync((): WebSocketCodecShape => ({
  decode: (raw) =>
    Effect.gen(function* () {
      // Convert to string if binary
      const text = typeof raw === "string" ? raw : getTextDecoder().decode(raw)

      // Parse JSON
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const json = yield* Effect.try({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        try: () => JSON.parse(text.trim()),
        catch: (cause) =>
          new WebSocketProtocolError({
            reason: "ParseError",
            description: `Failed to parse JSON: ${text.slice(0, 100)}`,
            cause,
          }),
      })

      // Decode using schema
      const result = yield* Schema.decodeUnknown(FromClientMessage)(json).pipe(
        Effect.mapError(
          (cause) =>
            new WebSocketProtocolError({
              reason: "InvalidMessage",
              description: "Message does not match expected schema",
              cause,
            }),
        ),
      )

      return result
    }),

  encode: (message) =>
    Effect.gen(function* () {
      // Encode to JSON object first using schema
      const encoded = yield* Schema.encode(FromServerMessage)(message).pipe(
        Effect.mapError(
          (cause) =>
            new WebSocketProtocolError({
              reason: "EncodeError",
              description: "Failed to encode message",
              cause,
            }),
        ),
      )

      // Stringify
      const json = yield* Effect.try({
        try: () => JSON.stringify(encoded),
        catch: (cause) =>
          new WebSocketProtocolError({
            reason: "EncodeError",
            description: "Failed to stringify message",
            cause,
          }),
      })

      return json
    }),
}))

/**
 * Default Layer providing NDJSON codec.
 */
export const WebSocketCodecLive: Layer.Layer<WebSocketCodec> = Layer.effect(
  WebSocketCodec,
  makeNdjsonCodec,
)

// ─────────────────────────────────────────────────────────────────────────────
// Custom Codec Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a custom codec layer.
 *
 * @example
 * ```ts
 * // MessagePack codec
 * const MessagePackCodecLive = makeWebSocketCodec({
 *   decode: (raw) => Effect.try(() => msgpack.decode(raw)),
 *   encode: (msg) => Effect.sync(() => msgpack.encode(msg)),
 * })
 * ```
 */
export const makeWebSocketCodec = (
  impl: WebSocketCodecShape,
): Layer.Layer<WebSocketCodec> => Layer.succeed(WebSocketCodec, impl)

// Assign static property after layer is defined
WebSocketCodec.Live = WebSocketCodecLive
