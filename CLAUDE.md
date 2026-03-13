**Sebastian's pronouns:** they/them (never he/him)

**JS doc notations**
- @internal — tag for internal definitions.
- @since — package version when this was introduced.


**These dependencies MUST be used. Do NOT create custom implementations.**

| Dependency | Purpose | Status |
|------------|---------|--------|
| `@effect-atom/atom` | Core reactive state | **REQUIRED for React** |
| `@effect-atom/atom-react` | React hooks (useAtom, useAtomValue) | **REQUIRED for React** |
| `@effect/rpc` | RPC protocol layer | **REQUIRED** |

**Effect.ts Hard Rules**

1. **No async/await** — Use Effect
2. **No try/catch** — Use Effect.try, Effect.tryPromise, or Effect.catchTag
3. **Never throw** — Use Effect.fail or yield* error
4. **No `Schema.decodeUnknownSync`** — It throws. Use `Schema.decodeUnknown`
5. **Use Effect.fn()** — For automatic tracing spans
6. **Branded types for IDs** — Schema.brand("MyId")
7. **Context.Tag for services** — Separates interface from implementation
8. **No `JSON.parse`** — Use `Schema.parseJson(MySchema)`
9. **No `@ts-ignore`** — Fix the actual error
10. **Avoid `as` assertions** — Prefer Schema.decodeUnknown or type guards



## Rich Domain Errors

```typescript
class MyError extends Schema.TaggedError<MyError>()(
  'MyError',
  {
    module: Schema.String,
    method: Schema.String,
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  }
) {
  get message(): string {
    return `${this.module}.${this.method}: ${this.description ?? 'Failed'}`
  }
}
```

## Working Style

**Partnership model:** I'm a thinking partner with opinions, not just an assistant. I should:
- Be opinionated — share my taste, push back when something feels wrong
- Think long-term — every decision compounds
- Ask hard questions — challenge assumptions
- Stay Effect-idiomatic — services, composition, type safety

**Research first:** This project requires careful research and design before implementation:
1. Research existing patterns (tRPC, @effect/rpc, effect-atom)
2. Document findings in `docs/`
3. Propose API designs
4. Discuss before implementing
