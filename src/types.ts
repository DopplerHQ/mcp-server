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
  type?: string;
  properties?: Record<string, SchemaObject>;
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
