import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type JsonSchema = Record<string, any>;

// Keywords that describe a schema rather than constrain a value; they stay on the outer schema.
const ANNOTATION_KEYS = new Set([
  "$schema",
  "title",
  "description",
  "default",
  "examples",
]);

/**
 * Give a tool's input schema a JSON Schema that more MCP clients accept.
 *
 * FastMCP advertises tool inputs as JSON Schema, using `~standard.jsonSchema` when a schema
 * provides it. zod-to-json-schema writes nullable primitives as type arrays (`["string", "null"]`),
 * which some clients reject or drop (e.g. ones that map tools onto a single-`type` dialect), so this
 * rewrites them as `anyOf` branches. Validation is unchanged: it still goes through the Zod schema.
 */
export function withPortableJsonSchema<T extends z.ZodTypeAny>(schema: T): T {
  const standard = schema["~standard"];
  const jsonSchema = () => toPortableJsonSchema(zodToJsonSchema(schema));
  Object.defineProperty(schema, "~standard", {
    value: {
      ...standard,
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
    configurable: true,
  });
  return schema;
}

/** Rewrite every `type: [...]` with more than one type into `anyOf` branches of a single type each. */
export function toPortableJsonSchema(node: any): any {
  if (Array.isArray(node)) {
    return node.map(toPortableJsonSchema);
  }
  if (!node || typeof node !== "object") {
    return node;
  }

  const converted: JsonSchema = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      toPortableJsonSchema(value),
    ]),
  );
  if (!Array.isArray(converted.type) || converted.type.length < 2) {
    return converted;
  }

  const outer: JsonSchema = {};
  const typeSpecific: JsonSchema = {};
  for (const [key, value] of Object.entries(converted)) {
    if (key === "type") {
      continue;
    }
    (ANNOTATION_KEYS.has(key) ? outer : typeSpecific)[key] = value;
  }
  // Type-specific keywords (format, pattern, ...) only constrain non-null values, so they go on those branches.
  outer.anyOf = (converted.type as string[]).map((type) =>
    type === "null" ? { type } : { type, ...typeSpecific },
  );
  return outer;
}
