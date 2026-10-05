import type { z } from "zod";

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  servers: Array<{
    url: string;
  }>;
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

export interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema: SchemaObject;
  description?: string;
}

export interface RequestBody {
  content: Record<
    string,
    {
      schema: SchemaObject;
    }
  >;
  required?: boolean;
}

export interface Response {
  description: string;
  content?: Record<
    string,
    {
      schema?: SchemaObject;
      examples?: Record<string, any>;
    }
  >;
}

export interface SchemaObject {
  // OpenAPI 3.1 allows an array of types, e.g. ["string", "null"]
  type?: string | string[];
  $ref?: string;
  title?: string;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  const?: any;
  properties?: Record<string, SchemaObject>;
  // A schema for the values of a map-like object, or true/false to allow/forbid extra keys
  additionalProperties?: SchemaObject | boolean;
  items?: SchemaObject;
  required?: string[];
  enum?: any[];
  example?: any;
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface DopplerTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
  method: string;
  endpoint: string;
  parameters: Parameter[];
  requestBody?: RequestBody;
}
