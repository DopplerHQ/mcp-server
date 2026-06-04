import { z } from "zod";
import { OpenAPISpec, Operation, SchemaObject, DopplerTool } from "./types.js";

export class OpenAPIParser {
  private spec: OpenAPISpec;

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
        const bodySchema = operation.requestBody.content[contentType].schema;
        if (bodySchema && bodySchema.properties) {
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

  private convertSchemaToZod(schema: SchemaObject): z.ZodSchema<any> {
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
