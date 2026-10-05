import { z } from "zod";
import { OpenAPISpec, Operation, SchemaObject, DopplerTool } from "./types.js";

export class OpenAPIParser {
  private spec: OpenAPISpec;
  /**
   * Refs currently being converted. Re-entering one means the schema refers to itself through a property
   * or array item (e.g. a tree), so that occurrence converts to `any` instead of recursing forever.
   */
  private refsInProgress = new Set<string>();

  constructor(spec: OpenAPISpec) {
    this.spec = spec;
  }

  public parseToTools(): DopplerTool[] {
    const tools: DopplerTool[] = [];

    for (const [path, methods] of Object.entries(this.spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (operation.operationId && !operation.deprecated) {
          const tool = this.createToolFromOperation(path, method, operation);
          if (tool) {
            tools.push(tool);
          }
        }
      }
    }

    return tools;
  }

  private createToolFromOperation(
    path: string,
    method: string,
    operation: Operation,
  ): DopplerTool | null {
    try {
      const inputSchema = this.createInputSchema(operation);

      return {
        name: this.generateToolName(method, path, operation.operationId),
        description:
          operation.summary ||
          operation.description ||
          `${method.toUpperCase()} ${path}`,
        inputSchema,
        method: method.toUpperCase(),
        endpoint: path,
        parameters: operation.parameters || [],
        requestBody: operation.requestBody,
      };
    } catch (error) {
      console.warn(
        `Failed to create tool for ${operation.operationId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Generate a tool name using hybrid approach:
   * - Use operationId if it's clean (semantic, not auto-generated)
   * - Fall back to path-based generation for ugly operationIds
   */
  private generateToolName(
    method: string,
    path: string,
    operationId: string,
  ): string {
    let fullName: string;
    if (this.isCleanOperationId(operationId)) {
      fullName = this.sanitizeOperationId(operationId);
    } else {
      fullName = this.generateFromPath(method, path);
    }
    // Maps name components in the form `${collection}_${resource}` to just `${resource}`, to reduce verbosity.
    const collectionResourceNames: Record<string, string> = {
      change_request_units: "unit",
      change_requests: "change_request",
      identities: "identity",
      integrations: "integration",
      service_accounts: "service_account",
      change_request_policies: "change_request_policy",
      groups: "group",
      roles: "role",
      webhooks: "webhook",
    };
    for (const [collection, resource] of Object.entries(
      collectionResourceNames,
    )) {
      fullName = fullName.replace(`${collection}_${resource}`, resource);
    }
    // MCP tool names cannot be more than 64 characters, but some clients add a prefix. We trim to 50 to be safe.
    return fullName.substring(0, 50);
  }

  /**
   * Check if an operationId looks "clean" (semantic, not auto-generated).
   * Clean examples: "workplace-get", "users_list", "secrets-download"
   * Ugly examples: "get_v3workplacechange_requests", "post_v3configs"
   */
  private isCleanOperationId(operationId: string): boolean {
    // Ugly indicators:
    // 1. Contains "v3" (path leaked into operationId)
    if (/v3/i.test(operationId)) return false;
    // 2. Contains path params like {slug}
    if (/\{[^}]+\}/.test(operationId)) return false;
    // 3. Starts with HTTP method (get_, post_, put_, delete_, patch_)
    if (/^(get|post|put|patch|delete)_/i.test(operationId)) return false;

    return true;
  }

  /**
   * Sanitize a clean operationId for use as a tool name.
   */
  private sanitizeOperationId(operationId: string): string {
    let name = operationId
      .replace(/-/g, "_")
      // Remove path template variables like {service_account}
      .replace(/\{[^}]+\}/g, "")
      // Collapse multiple underscores
      .replace(/_+/g, "_")
      // Remove trailing underscores
      .replace(/_$/, "");

    return name;
  }

  /**
   * Generate a tool name from the HTTP method and path.
   * Used as fallback when operationId is ugly/auto-generated.
   */
  private generateFromPath(method: string, path: string): string {
    // 1. Strip /v3/ prefix
    let cleanPath = path.replace(/^\/v3\//, "");

    // 2. Split by / and process each segment
    const segments = cleanPath.split("/").filter(Boolean);

    // 3. Process segments: extract resource names, skip path params
    const parts: string[] = [];
    for (const seg of segments) {
      // Path parameter like {project} - skip
      if (seg.startsWith("{")) {
        continue;
      }
      // Convert to snake_case
      parts.push(seg.replace(/-/g, "_"));
    }

    // 4. Determine action suffix based on method and path structure
    const endsWithParam = path.endsWith("}");
    const methodUpper = method.toUpperCase();

    let action: string;
    switch (methodUpper) {
      case "GET":
        action = endsWithParam ? "get" : "list";
        break;
      case "POST":
        action = "create";
        break;
      case "PUT":
      case "PATCH":
        action = "update";
        break;
      case "DELETE":
        action = "delete";
        break;
      default:
        action = method.toLowerCase();
    }

    // 5. Handle special action paths (e.g., /clone, /lock, /review)
    const lastPart = parts[parts.length - 1];
    const actionWords = [
      "clone",
      "lock",
      "unlock",
      "rollback",
      "download",
      "rename",
      "close",
      "apply",
      "review",
      "status",
      "enable",
      "disable",
    ];
    if (actionWords.includes(lastPart)) {
      // For DELETE on action paths, use "{action}_delete" to avoid conflicts
      if (methodUpper === "DELETE") {
        action = `${lastPart}_delete`;
      } else {
        action = lastPart;
      }
      parts.pop();
    }

    // 6. Build the name
    let name = parts.join("_");
    if (!name.endsWith(`_${action}`) && !name.endsWith(action)) {
      name = `${name}_${action}`;
    }

    // 7. Clean up
    name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");

    return name;
  }

  private createInputSchema(operation: Operation): z.ZodSchema<any> {
    const schemaFields: Record<string, z.ZodSchema<any>> = {};

    if (operation.parameters) {
      for (const param of operation.parameters) {
        const zodSchema = this.convertSchemaToZod(param.schema);
        schemaFields[param.name] = param.required
          ? zodSchema
          : zodSchema.optional();
      }
    }

    if (operation.requestBody) {
      const contentType = Object.keys(operation.requestBody.content)[0];
      if (contentType === "application/json") {
        const rawBodySchema = operation.requestBody.content[contentType].schema;
        const bodySchema = rawBodySchema
          ? this.resolveSchema(rawBodySchema)
          : undefined;
        const variants = bodySchema?.oneOf ?? bodySchema?.anyOf;
        if (variants) {
          // A body that varies by variant (e.g. one variant per integration type): expose the union of every
          // variant's properties as tool inputs, since tool inputs are a single flat object. Properties
          // declared directly on the body (below) take precedence over same-named variant properties.
          const variantFields = this.mergeVariantProperties(variants);
          if (
            Object.keys(variantFields).length === 0 &&
            !bodySchema?.properties
          ) {
            console.warn(
              `Request body variants for ${operation.operationId} have no properties; the tool takes no body inputs`,
            );
          }
          Object.assign(schemaFields, variantFields);
        }
        if (bodySchema?.properties) {
          for (const [propName, propSchema] of Object.entries(
            bodySchema.properties,
          )) {
            const zodSchema = this.convertSchemaToZod(propSchema);
            const isRequired = bodySchema.required?.includes(propName) ?? false;
            schemaFields[propName] = isRequired
              ? zodSchema
              : zodSchema.optional();
          }
        }
      }
    }

    // Use passthrough() to allow additional properties not in schema.
    // OpenAPI specs often have example properties that shouldn't restrict input.
    return z.object(schemaFields).passthrough();
  }

  /**
   * Follow local `$ref`s (e.g. `#/components/schemas/Foo`) until a concrete schema is reached.
   * Non-local, unresolvable and self-referencing refs resolve to `{}`, which converts to `any`.
   */
  private resolveSchema(schema: SchemaObject): SchemaObject {
    const seen = new Set<string>();
    let current = schema;
    while (current?.$ref) {
      const ref = current.$ref;
      if (!ref.startsWith("#/")) {
        console.warn(`Unsupported $ref ${ref}; treating it as any`);
        return {};
      }
      if (seen.has(ref)) {
        return {};
      }
      seen.add(ref);
      let target: any = this.spec;
      for (const part of ref.slice(2).split("/")) {
        // JSON Pointer (RFC 6901): percent-decode the fragment, then unescape ~1 before ~0
        const key = decodeURIComponent(part)
          .replace(/~1/g, "/")
          .replace(/~0/g, "~");
        target = target?.[key];
      }
      if (target === undefined || target === null) {
        console.warn(`Unresolvable $ref ${ref}; treating it as any`);
        return {};
      }
      current = target;
    }
    return current;
  }

  /**
   * Expand request body variants into a flat list of object schemas: nested oneOf/anyOf members are
   * expanded, and an allOf variant is merged into one schema with the combined properties and required list.
   */
  private flattenVariants(
    variants: SchemaObject[],
    seen: Set<string> = new Set(),
  ): SchemaObject[] {
    const flat: SchemaObject[] = [];
    for (const raw of variants) {
      if (raw.$ref && seen.has(raw.$ref)) {
        continue;
      }
      const nextSeen = raw.$ref ? new Set([...seen, raw.$ref]) : seen;
      const schema = this.resolveSchema(raw);
      const nested = schema.oneOf ?? schema.anyOf;
      if (nested) {
        flat.push(...this.flattenVariants(nested, nextSeen));
      } else if (schema.allOf) {
        flat.push(this.mergeAllOf(schema, nextSeen));
      } else {
        flat.push(schema);
      }
    }
    return flat;
  }

  private mergeAllOf(schema: SchemaObject, seen: Set<string>): SchemaObject {
    const merged: SchemaObject = {
      type: "object",
      title: schema.title,
      properties: { ...(schema.properties ?? {}) },
      required: [...(schema.required ?? [])],
    };
    for (const raw of schema.allOf ?? []) {
      if (raw.$ref && seen.has(raw.$ref)) {
        continue;
      }
      const member = this.resolveSchema(raw);
      const part = member.allOf
        ? this.mergeAllOf(
            member,
            raw.$ref ? new Set([...seen, raw.$ref]) : seen,
          )
        : member;
      Object.assign(merged.properties!, part.properties ?? {});
      merged.required = [
        ...new Set([...(merged.required ?? []), ...(part.required ?? [])]),
      ];
      merged.title ??= part.title;
    }
    return merged;
  }

  /**
   * Merge the properties of a request body's oneOf/anyOf variants into one set of tool inputs.
   * A property is required only if every variant requires it. When every variant gives a property
   * string values through `enum` or `const` (e.g. `type: { enum: ["aws"] }`), they're combined into one
   * enum. Otherwise the property becomes a union of its distinct shapes, each labeled with the titles of
   * the variants that use it, so clients can tell which shape goes with which variant.
   */
  private mergeVariantProperties(
    variants: SchemaObject[],
  ): Record<string, z.ZodSchema<any>> {
    const flat = this.flattenVariants(variants);
    const byName = new Map<
      string,
      Array<{ schema: SchemaObject; title?: string }>
    >();
    for (const variant of flat) {
      for (const [name, prop] of Object.entries(variant.properties ?? {})) {
        byName.set(name, [
          ...(byName.get(name) ?? []),
          { schema: this.resolveSchema(prop), title: variant.title },
        ]);
      }
    }

    const fields: Record<string, z.ZodSchema<any>> = {};
    for (const [name, entries] of byName) {
      // Mixed enum and non-enum variants for the same property fall back to a union of the shapes.
      const enumValues = this.collectStringValues(entries.map((e) => e.schema));
      let zodSchema: z.ZodSchema<any>;
      if (enumValues) {
        zodSchema = this.convertSchemaToZod({
          type: "string",
          enum: enumValues,
        });
      } else {
        const groups = new Map<
          string,
          { schema: SchemaObject; titles: string[] }
        >();
        for (const { schema, title } of entries) {
          const key = this.shapeKey(schema);
          const group = groups.get(key) ?? { schema, titles: [] };
          if (title && !group.titles.includes(title)) {
            group.titles.push(title);
          }
          groups.set(key, group);
        }
        zodSchema = this.unionOf(
          [...groups.values()].map(({ schema, titles }) =>
            titles.length > 0
              ? { ...schema, title: titles.join(", ") }
              : schema,
          ),
        );
      }
      const requiredEverywhere = flat.every((v) => v.required?.includes(name));
      fields[name] = requiredEverywhere ? zodSchema : zodSchema.optional();
    }
    return fields;
  }

  /** Every string value a set of schemas allows through `enum`/`const`, or null if any schema isn't string-valued. */
  private collectStringValues(schemas: SchemaObject[]): string[] | null {
    const values: string[] = [];
    for (const schema of schemas) {
      if (typeof schema.const === "string") {
        values.push(schema.const);
      } else if (
        Array.isArray(schema.enum) &&
        schema.enum.length > 0 &&
        schema.enum.every((v) => typeof v === "string")
      ) {
        values.push(...schema.enum);
      } else {
        return null;
      }
    }
    return values.length > 0 ? [...new Set(values)] : null;
  }

  /** A key identifying a schema's shape, ignoring annotations that don't affect validation. */
  private shapeKey(schema: SchemaObject): string {
    const annotations = new Set([
      "description",
      "title",
      "example",
      "examples",
    ]);
    return JSON.stringify(schema, (key, value) => {
      if (annotations.has(key)) {
        return undefined;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        );
      }
      return value;
    });
  }

  /** Convert alternatives to a Zod union, labeling each member with its title (or description) when there's a choice. */
  private unionOf(schemas: SchemaObject[]): z.ZodSchema<any> {
    if (schemas.length === 0) {
      return z.any();
    }
    if (schemas.length === 1) {
      return this.convertSchemaToZod(schemas[0]);
    }
    const members = schemas.map((raw) => {
      const resolved = this.resolveSchema(raw);
      const label = raw.title ?? resolved.title ?? resolved.description;
      const member = this.convertSchemaToZod(raw);
      return label ? member.describe(label) : member;
    });
    return z.union(
      members as [z.ZodSchema<any>, z.ZodSchema<any>, ...z.ZodSchema<any>[]],
    );
  }

  private convertSchemaToZod(rawSchema: SchemaObject): z.ZodSchema<any> {
    const ref = rawSchema?.$ref;
    if (ref) {
      if (this.refsInProgress.has(ref)) {
        return z.any();
      }
      this.refsInProgress.add(ref);
    }
    try {
      return this.convertResolvedSchema(this.resolveSchema(rawSchema ?? {}));
    } finally {
      if (ref) {
        this.refsInProgress.delete(ref);
      }
    }
  }

  private convertResolvedSchema(schema: SchemaObject): z.ZodSchema<any> {
    // OpenAPI 3.1 type arrays, e.g. ["string", "null"]
    if (Array.isArray(schema.type)) {
      const nonNull = schema.type.filter((t) => t !== "null");
      if (nonNull.length === 0) {
        return z.null();
      }
      const base =
        nonNull.length === 1
          ? this.convertResolvedSchema({ ...schema, type: nonNull[0] })
          : z.any();
      return schema.type.includes("null") ? base.nullable() : base;
    }

    const variants = schema.oneOf ?? schema.anyOf;
    if (variants) {
      return this.unionOf(variants);
    }

    if (schema.allOf) {
      const parts = schema.allOf.map((s) => this.convertSchemaToZod(s));
      return parts.length === 0
        ? z.any()
        : parts.reduce((acc, part) => z.intersection(acc, part));
    }

    if (schema.const === null) {
      return z.null();
    }
    // Object and array consts can't be matched by z.literal, so they fall through to the type checks.
    if (schema.const !== undefined && typeof schema.const !== "object") {
      return z.literal(schema.const);
    }

    if (schema.enum) {
      const allStrings = schema.enum.every(
        (val: any) => typeof val === "string",
      );
      if (allStrings) {
        const cleanedEnum = schema.enum.map((val: string) =>
          val.replace(/^"|"$/g, ""),
        );
        return z.enum(cleanedEnum as [string, ...string[]]);
      }
      // Non-string enums use z.union of literals
      if (schema.enum.length === 0) {
        return z.never();
      }
      if (schema.enum.length === 1) {
        return z.literal(schema.enum[0]);
      }
      return z.union(
        schema.enum.map((val: any) => z.literal(val)) as [
          z.ZodLiteral<any>,
          z.ZodLiteral<any>,
          ...z.ZodLiteral<any>[],
        ],
      );
    }

    switch (schema.type) {
      case "string":
        if (schema.format === "json") {
          return z.record(z.any());
        }
        let stringSchema = z.string();
        if (schema.format === "email") {
          stringSchema = stringSchema.email();
        } else if (schema.format === "uri") {
          stringSchema = stringSchema.url();
        } else if (schema.pattern) {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        }
        if (schema.minimum !== undefined) {
          stringSchema = stringSchema.min(schema.minimum);
        }
        if (schema.maximum !== undefined) {
          stringSchema = stringSchema.max(schema.maximum);
        }
        return stringSchema;

      case "number":
      case "integer":
        let numberSchema =
          schema.type === "integer" ? z.number().int() : z.number();
        if (schema.minimum !== undefined) {
          numberSchema = numberSchema.min(schema.minimum);
        }
        if (schema.maximum !== undefined) {
          numberSchema = numberSchema.max(schema.maximum);
        }
        return numberSchema;

      case "boolean":
        return z.boolean();

      case "array":
        if (schema.items) {
          return z.array(this.convertSchemaToZod(schema.items));
        }
        return z.array(z.any());

      case "object":
        if (schema.properties) {
          const objectFields: Record<string, z.ZodSchema<any>> = {};
          for (const [propName, propSchema] of Object.entries(
            schema.properties,
          )) {
            const zodSchema = this.convertSchemaToZod(propSchema);
            const isRequired = schema.required?.includes(propName) ?? false;
            objectFields[propName] = isRequired
              ? zodSchema
              : zodSchema.optional();
          }
          return z.object(objectFields).passthrough();
        }
        return z.record(z.any());

      default:
        return z.any();
    }
  }
}
