/**
 * @since 1.0.0
 */
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import * as HttpApiSchema from "./HttpApiSchema.js";
/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId = /*#__PURE__*/Symbol.for("@effect/platform/HttpApiError");
/**
 * @since 1.0.0
 * @category schemas
 */
export const PropertyKeysNoSymbol = /*#__PURE__*/Schema.transform( /*#__PURE__*/Schema.Array( /*#__PURE__*/Schema.Union(Schema.String, Schema.Number)), /*#__PURE__*/Schema.Array( /*#__PURE__*/Schema.Union(Schema.SymbolFromSelf, Schema.String, Schema.Number)), {
  decode: identity,
  encode: items => items.filter(item => typeof item !== "symbol")
});
/**
 * @since 1.0.0
 * @category schemas
 */
export const Issue = /*#__PURE__*/Schema.Struct({
  _tag: /*#__PURE__*/Schema.Literal("Pointer", "Unexpected", "Missing", "Composite", "Refinement", "Transformation", "Type", "Forbidden"),
  path: PropertyKeysNoSymbol,
  message: Schema.String
});
/**
 * @since 1.0.0
 * @category errors
 */
export class HttpApiDecodeError extends /*#__PURE__*/Schema.TaggedError()("HttpApiDecodeError", {
  issues: /*#__PURE__*/Schema.Array(Issue),
  message: Schema.String
}, /*#__PURE__*/HttpApiSchema.annotations({
  status: 400,
  description: "The request did not match the expected schema"
})) {
  /**
   * @since 1.0.0
   */
  static fromParseError(error) {
    return ParseResult.ArrayFormatter.formatError(error).pipe(Effect.zip(ParseResult.TreeFormatter.formatError(error)), Effect.map(([issues, message]) => new HttpApiDecodeError({
      issues,
      message
    })));
  }
  /**
   * @since 1.0.0
   */
  static refailParseError(error) {
    return Effect.flatMap(HttpApiDecodeError.fromParseError(error), Effect.fail);
  }
}
//# sourceMappingURL=HttpApiError.js.map