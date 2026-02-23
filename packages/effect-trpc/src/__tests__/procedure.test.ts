import { describe, it, expect } from "vitest"
import * as Schema from "effect/Schema"
import { procedure } from "../core/procedure.js"

describe("procedure builder", () => {
  it("creates a query procedure", () => {
    const def = procedure.output(Schema.String).query()

    expect(def._tag).toBe("ProcedureDefinition")
    expect(def.type).toBe("query")
    expect(def.outputSchema).toBeDefined()
    expect(def.inputSchema).toBeUndefined()
  })

  it("creates a mutation procedure with input and output", () => {
    const InputSchema = Schema.Struct({ name: Schema.String })
    const OutputSchema = Schema.Struct({ id: Schema.String, name: Schema.String })

    const def = procedure.input(InputSchema).output(OutputSchema).mutation()

    expect(def._tag).toBe("ProcedureDefinition")
    expect(def.type).toBe("mutation")
    expect(def.inputSchema).toBeDefined()
    expect(def.outputSchema).toBeDefined()
  })

  it("creates a stream procedure", () => {
    const PartSchema = Schema.Struct({ chunk: Schema.String })

    const def = procedure.output(PartSchema).stream()

    expect(def._tag).toBe("ProcedureDefinition")
    expect(def.type).toBe("stream")
  })

  it("creates a chat procedure", () => {
    const ChatPartSchema = Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("text-delta"), delta: Schema.String }),
      Schema.Struct({ _tag: Schema.Literal("finish"), reason: Schema.String }),
    )

    const def = procedure.output(ChatPartSchema).chat()

    expect(def._tag).toBe("ProcedureDefinition")
    expect(def.type).toBe("chat")
  })

  it("supports invalidates declaration", () => {
    const def = procedure
      .input(Schema.Struct({ name: Schema.String }))
      .invalidates(["user.list", "stats.count"])
      .mutation()

    expect(def.invalidates).toEqual(["user.list", "stats.count"])
  })

  it("supports tags declaration", () => {
    const def = procedure
      .output(Schema.Array(Schema.String))
      .tags(["users", "list"])
      .query()

    expect(def.tags).toEqual(["users", "list"])
  })

  it("supports invalidatesTags declaration", () => {
    const def = procedure
      .input(Schema.Struct({ name: Schema.String }))
      .invalidatesTags(["users"])
      .mutation()

    expect(def.invalidatesTags).toEqual(["users"])
  })

  it("chains multiple builder methods", () => {
    const def = procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(Schema.Struct({ id: Schema.String, name: Schema.String }))
      .tags(["users"])
      .query()

    expect(def.inputSchema).toBeDefined()
    expect(def.outputSchema).toBeDefined()
    expect(def.tags).toEqual(["users"])
    expect(def.type).toBe("query")
  })

  describe("OpenAPI metadata", () => {
    it("supports summary", () => {
      const def = procedure
        .summary("Get user by ID")
        .output(Schema.String)
        .query()

      expect(def.summary).toBe("Get user by ID")
    })

    it("supports externalDocs", () => {
      const def = procedure
        .externalDocs("https://docs.example.com/api/users")
        .output(Schema.String)
        .query()

      expect(def.externalDocs).toBe("https://docs.example.com/api/users")
    })

    it("supports responseDescription", () => {
      const def = procedure
        .output(Schema.String)
        .responseDescription("The user object with all profile fields")
        .query()

      expect(def.responseDescription).toBe("The user object with all profile fields")
    })

    it("supports all OpenAPI metadata together", () => {
      const def = procedure
        .summary("Get user by ID")
        .description("Retrieves a user by their unique identifier. Returns 404 if not found.")
        .externalDocs("https://docs.example.com/api/users")
        .responseDescription("The user object with all profile fields")
        .deprecated()
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.Struct({ id: Schema.String, name: Schema.String }))
        .query()

      expect(def.summary).toBe("Get user by ID")
      expect(def.description).toBe("Retrieves a user by their unique identifier. Returns 404 if not found.")
      expect(def.externalDocs).toBe("https://docs.example.com/api/users")
      expect(def.responseDescription).toBe("The user object with all profile fields")
      expect(def.deprecated).toBe(true)
    })
  })
})
