import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  toPortableJsonSchema,
  withPortableJsonSchema,
} from "../src/portable-schema.js";

describe("toPortableJsonSchema", () => {
  it("rewrites a nullable type array as anyOf branches", () => {
    expect(
      toPortableJsonSchema({
        type: ["string", "null"],
        description: "A slug.",
      }),
    ).toEqual({
      description: "A slug.",
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("keeps type-specific keywords on the non-null branches only", () => {
    expect(
      toPortableJsonSchema({
        type: ["string", "integer", "null"],
        format: "uuid",
        default: "x",
      }),
    ).toEqual({
      default: "x",
      anyOf: [
        { type: "string", format: "uuid" },
        { type: "integer", format: "uuid" },
        { type: "null" },
      ],
    });
  });

  it("rewrites nested schemas and leaves everything else unchanged", () => {
    const input = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["a", "b"] },
        data: {
          anyOf: [
            {
              type: "object",
              properties: { id: { type: ["number", "null"] } },
            },
          ],
        },
      },
      required: ["type"],
    };

    expect(toPortableJsonSchema(input)).toEqual({
      ...input,
      properties: {
        type: { type: "string", enum: ["a", "b"] },
        data: {
          anyOf: [
            {
              type: "object",
              properties: {
                id: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
            },
          ],
        },
      },
    });
  });
});

describe("withPortableJsonSchema", () => {
  it("advertises a portable JSON Schema and keeps validating with Zod", async () => {
    const schema = withPortableJsonSchema(
      z.object({ name: z.string().nullable(), count: z.number() }),
    );

    const jsonSchema = (schema["~standard"] as any).jsonSchema.input({
      target: "draft-07",
    });
    expect(jsonSchema.properties.name).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });

    const ok = await schema["~standard"].validate({ name: null, count: 1 });
    expect(ok.issues).toBeUndefined();
    const bad = await schema["~standard"].validate({ name: 5, count: 1 });
    expect(bad.issues?.length).toBeGreaterThan(0);
    // The Zod schema itself still works as before.
    expect(schema.safeParse({ name: "n", count: 1 }).success).toBe(true);
  });
});
