import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OpenAPIParser } from "../src/parser.js";
import type { OpenAPISpec, SchemaObject } from "../src/types.js";

const createMockSpec = (paths: OpenAPISpec["paths"] = {}): OpenAPISpec => ({
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  servers: [{ url: "https://api.doppler.com" }],
  paths,
});

describe("OpenAPIParser", () => {
  describe("parseToTools", () => {
    it("parses a simple GET endpoint into a tool", () => {
      const spec = createMockSpec({
        "/v3/workplace": {
          get: {
            operationId: "workplace-get",
            summary: "Retrieve workplace info",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("workplace_get");
      expect(tools[0].description).toBe("Retrieve workplace info");
      expect(tools[0].method).toBe("GET");
      expect(tools[0].endpoint).toBe("/v3/workplace");
    });

    it("sanitizes operation IDs by replacing hyphens with underscores", () => {
      const spec = createMockSpec({
        "/v3/projects": {
          get: {
            operationId: "projects-list",
            summary: "List projects",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("projects_list");
    });

    it("skips deprecated operations", () => {
      const spec = createMockSpec({
        "/v3/old-endpoint": {
          get: {
            operationId: "old-endpoint-get",
            summary: "Old endpoint",
            deprecated: true,
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
        "/v3/new-endpoint": {
          get: {
            operationId: "new-endpoint-get",
            summary: "New endpoint",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("new_endpoint_get");
    });

    it("handles multiple HTTP methods on the same path", () => {
      const spec = createMockSpec({
        "/v3/projects": {
          get: {
            operationId: "projects-list",
            summary: "List projects",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
          post: {
            operationId: "projects-create",
            summary: "Create project",
            parameters: [],
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual([
        "projects_create",
        "projects_list",
      ]);
      expect(tools.find((t) => t.name === "projects_list")?.method).toBe("GET");
      expect(tools.find((t) => t.name === "projects_create")?.method).toBe(
        "POST",
      );
    });

    it("includes path parameters in tool definition", () => {
      const spec = createMockSpec({
        "/v3/projects/{project}": {
          get: {
            operationId: "projects-get",
            summary: "Get project",
            parameters: [
              {
                name: "project",
                in: "path",
                required: true,
                schema: { type: "string" },
                description: "The project slug",
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].parameters).toHaveLength(1);
      expect(tools[0].parameters[0].name).toBe("project");
      expect(tools[0].parameters[0].in).toBe("path");
      expect(tools[0].parameters[0].required).toBe(true);
    });

    it("includes query parameters in tool definition", () => {
      const spec = createMockSpec({
        "/v3/configs": {
          get: {
            operationId: "configs-list",
            summary: "List configs",
            parameters: [
              {
                name: "project",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "environment",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].parameters).toHaveLength(2);
      expect(
        tools[0].parameters.find((p) => p.name === "project")?.required,
      ).toBe(true);
      expect(
        tools[0].parameters.find((p) => p.name === "environment")?.required,
      ).toBe(false);
    });

    it("handles request body for POST operations", () => {
      const spec = createMockSpec({
        "/v3/projects": {
          post: {
            operationId: "projects-create",
            summary: "Create project",
            parameters: [],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["name"],
                  },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].requestBody).toBeDefined();
      expect(
        tools[0].requestBody?.content["application/json"].schema.properties,
      ).toHaveProperty("name");
    });

    it("uses summary as description, falling back to description field", () => {
      const spec = createMockSpec({
        "/v3/endpoint1": {
          get: {
            operationId: "endpoint1-get",
            summary: "Short summary",
            description: "Longer description",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
        "/v3/endpoint2": {
          get: {
            operationId: "endpoint2-get",
            description: "Only description",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools.find((t) => t.name === "endpoint1_get")?.description).toBe(
        "Short summary",
      );
      expect(tools.find((t) => t.name === "endpoint2_get")?.description).toBe(
        "Only description",
      );
    });
  });

  describe("hybrid tool naming", () => {
    it("uses clean operationId when available", () => {
      const spec = createMockSpec({
        "/v3/secrets": {
          get: {
            operationId: "secrets-list",
            summary: "List secrets",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("secrets_list");
    });

    it("falls back to path-based naming for ugly operationIds with v3", () => {
      const spec = createMockSpec({
        "/v3/workplace/change_requests": {
          get: {
            operationId: "get_v3workplacechange_requests",
            summary: "List change requests",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("workplace_change_requests_list");
    });

    it("falls back to path-based naming for operationIds starting with HTTP method", () => {
      const spec = createMockSpec({
        "/v3/workplace/service_accounts": {
          post: {
            operationId: "post_v3workplace_service_accounts",
            summary: "Create service account",
            parameters: [],
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("workplace_service_accounts_create");
    });

    it("generates _get suffix for GET on path ending with param", () => {
      const spec = createMockSpec({
        "/v3/projects/{project}": {
          get: {
            operationId: "get_v3projects_project",
            summary: "Get project",
            parameters: [
              {
                name: "project",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("projects_get");
    });

    it("generates _list suffix for GET on collection path", () => {
      const spec = createMockSpec({
        "/v3/configs/config/secrets": {
          get: {
            operationId: "get_v3configs_secrets",
            summary: "List secrets",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("configs_config_secrets_list");
    });

    it("handles action paths like /clone and /lock", () => {
      const spec = createMockSpec({
        "/v3/configs/config/clone": {
          post: {
            operationId: "post_v3configs_clone",
            summary: "Clone config",
            parameters: [],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name).toBe("configs_config_clone");
    });

    it("avoids conflicts for POST vs DELETE on action paths", () => {
      const spec = createMockSpec({
        "/v3/change_requests/{id}/review": {
          post: {
            operationId: "post_v3change_requests_review",
            summary: "Create review",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
          delete: {
            operationId: "delete_v3change_requests_review",
            summary: "Delete review",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain("change_requests_review");
      expect(names).toContain("change_requests_review_delete");
      expect(names.length).toBe(2); // No duplicates
    });

    it("truncates long names to 50 characters", () => {
      const spec = createMockSpec({
        "/v3/workplace/service_accounts/service_account/{sa}/identities/identity/{id}":
          {
            get: {
              operationId: "get_v3workplace_service_accounts_very_long_path",
              summary: "Get identity",
              parameters: [
                {
                  name: "sa",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                },
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: { "200": { description: "Success" } },
            },
          },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].name.length).toBeLessThanOrEqual(50);
      expect(tools[0].name).not.toMatch(/_$/); // Shouldn't end with underscore
    });
  });

  describe("input schema generation", () => {
    it("creates required fields for required parameters", () => {
      const spec = createMockSpec({
        "/v3/configs": {
          get: {
            operationId: "configs-list",
            summary: "List configs",
            parameters: [
              {
                name: "project",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const result = tools[0].inputSchema.safeParse({ project: "my-project" });
      expect(result.success).toBe(true);

      const failResult = tools[0].inputSchema.safeParse({});
      expect(failResult.success).toBe(false);
    });

    it("allows optional fields to be omitted", () => {
      const spec = createMockSpec({
        "/v3/configs": {
          get: {
            operationId: "configs-list",
            summary: "List configs",
            parameters: [
              {
                name: "project",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "page",
                in: "query",
                required: false,
                schema: { type: "integer" },
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const result = tools[0].inputSchema.safeParse({ project: "my-project" });
      expect(result.success).toBe(true);

      const resultWithOptional = tools[0].inputSchema.safeParse({
        project: "my-project",
        page: 1,
      });
      expect(resultWithOptional.success).toBe(true);
    });

    it("preserves additional properties not defined in schema", () => {
      const spec = createMockSpec({
        "/v3/configs/config/secrets": {
          post: {
            operationId: "secrets-update",
            summary: "Update secrets",
            parameters: [],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["project", "config"],
                    properties: {
                      project: { type: "string" },
                      config: { type: "string" },
                      secrets: {
                        type: "object",
                        properties: {
                          EXAMPLE_KEY: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const input = {
        project: "my-app",
        config: "dev",
        secrets: {
          MY_CUSTOM_SECRET: "secret-value",
          ANOTHER_SECRET: "another-value",
        },
      };

      const result = tools[0].inputSchema.safeParse(input);
      expect(result.success).toBe(true);

      // Critical: extra properties must be preserved, not stripped
      expect(result.data).toEqual(input);
      expect(result.data.secrets.MY_CUSTOM_SECRET).toBe("secret-value");
      expect(result.data.secrets.ANOTHER_SECRET).toBe("another-value");
    });

    it("preserves top-level additional properties", () => {
      const spec = createMockSpec({
        "/v3/endpoint": {
          post: {
            operationId: "endpoint-create",
            summary: "Create something",
            parameters: [],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "Success" } },
          },
        },
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const input = {
        name: "test",
        extraField: "should-be-preserved",
      };

      const result = tools[0].inputSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.extraField).toBe("should-be-preserved");
    });
  });

  describe("oneOf, $ref and OpenAPI 3.1 schemas", () => {
    const integrationVariant = (
      type: string,
      dataProp: string,
      title = type,
    ): SchemaObject => ({
      title,
      type: "object",
      required: ["type", "name", "data"],
      properties: {
        type: { type: "string", enum: [type] },
        name: { type: "string" },
        data: {
          type: "object",
          required: [dataProp],
          properties: { [dataProp]: { type: "string" } },
        },
      },
    });

    const specWithBody = (
      schema: SchemaObject,
      schemas: Record<string, any> = {},
    ): OpenAPISpec => ({
      ...createMockSpec({
        "/v3/integrations": {
          post: {
            operationId: "integrations-create",
            summary: "Create",
            requestBody: { content: { "application/json": { schema } } },
            responses: { "200": { description: "Success" } },
          },
        },
      }),
      components: { schemas },
    });

    const specWithQueryParam = (
      schema: SchemaObject,
      schemas: Record<string, any> = {},
    ): OpenAPISpec => ({
      ...createMockSpec({
        "/v3/things": {
          get: {
            operationId: "things-list",
            summary: "List",
            parameters: [
              { name: "value", in: "query", required: true, schema },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      }),
      components: { schemas },
    });

    it("merges the properties of a oneOf request body into tool inputs", () => {
      const spec = specWithBody(
        {
          oneOf: [
            { $ref: "#/components/schemas/CreateAws" },
            { $ref: "#/components/schemas/CreateCircleCI" },
          ],
        },
        {
          CreateAws: integrationVariant(
            "aws_secrets_manager",
            "aws_assume_role_arn",
          ),
          CreateCircleCI: integrationVariant("circleci", "api_token"),
        },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const valid = { type: "circleci", name: "ci", data: { api_token: "x" } };
      expect(tools[0].inputSchema.safeParse(valid).success).toBe(true);
      // The per-variant single-value enums are combined into one enum.
      expect(
        tools[0].inputSchema.safeParse({ ...valid, type: "nope" }).success,
      ).toBe(false);
      // Properties every variant requires stay required.
      expect(
        tools[0].inputSchema.safeParse({
          type: "circleci",
          data: { api_token: "x" },
        }).success,
      ).toBe(false);
    });

    it("merges an anyOf request body the same way", () => {
      const spec = specWithBody({
        anyOf: [
          integrationVariant("flyio", "api_key"),
          integrationVariant("render", "api_key"),
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(
        tools[0].inputSchema.safeParse({
          type: "render",
          name: "r",
          data: { api_key: "k" },
        }).success,
      ).toBe(true);
      expect(tools[0].inputSchema.safeParse({ type: "flyio" }).success).toBe(
        false,
      );
    });

    it("makes a merged property optional when only some variants require it", () => {
      const gitlab = integrationVariant("gitlab", "api_key");
      const withInstanceUrl: SchemaObject = {
        ...gitlab,
        required: [...gitlab.required!, "instance_url"],
        properties: { ...gitlab.properties, instance_url: { type: "string" } },
      };
      const spec = specWithBody({
        oneOf: [withInstanceUrl, integrationVariant("render", "api_key")],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      const base = { type: "render", name: "r", data: { api_key: "k" } };
      expect(tools[0].inputSchema.safeParse(base).success).toBe(true);
      // The property is still declared and type-checked.
      expect(
        tools[0].inputSchema.safeParse({ ...base, instance_url: 5 }).success,
      ).toBe(false);
    });

    it("keeps body properties alongside the variants of a oneOf", () => {
      const spec = specWithBody({
        type: "object",
        required: ["common"],
        properties: { common: { type: "string" } },
        oneOf: [
          {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" } },
          },
          {
            type: "object",
            required: ["b"],
            properties: { b: { type: "string" } },
          },
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(
        tools[0].inputSchema.safeParse({ common: "c", a: "x" }).success,
      ).toBe(true);
      expect(
        tools[0].inputSchema.safeParse({ common: "c", a: 5 }).success,
      ).toBe(false);
      expect(tools[0].inputSchema.safeParse({ a: "x" }).success).toBe(false);
    });

    it("merges allOf variants and expands nested oneOf variants", () => {
      const spec = specWithBody(
        {
          oneOf: [
            {
              allOf: [
                { $ref: "#/components/schemas/Named" },
                {
                  type: "object",
                  required: ["a"],
                  properties: { a: { type: "string" } },
                },
              ],
            },
            { $ref: "#/components/schemas/Nested" },
          ],
        },
        {
          Named: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          Nested: {
            oneOf: [
              {
                type: "object",
                required: ["name", "b"],
                properties: { name: { type: "string" }, b: { type: "string" } },
              },
            ],
          },
        },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      // `name` comes from both the allOf member and the nested variant, so it's required.
      expect(tools[0].inputSchema.safeParse({ a: "x" }).success).toBe(false);
      expect(
        tools[0].inputSchema.safeParse({ name: "n", a: "x" }).success,
      ).toBe(true);
      expect(tools[0].inputSchema.safeParse({ name: "n", b: 5 }).success).toBe(
        false,
      );
    });

    it("accepts any variant of a nested oneOf property, including nested choices", () => {
      const spec = specWithBody(
        {
          type: "object",
          required: ["integration", "data"],
          properties: {
            integration: { type: "string" },
            data: {
              oneOf: [
                { $ref: "#/components/schemas/SyncDataFlyIo" },
                { $ref: "#/components/schemas/SyncDataHeroku" },
              ],
            },
          },
        },
        {
          SyncDataFlyIo: {
            title: "Fly.io",
            type: "object",
            required: ["app_id"],
            properties: { app_id: { type: "string" } },
          },
          SyncDataHeroku: {
            title: "Heroku",
            oneOf: [
              {
                type: "object",
                required: ["project_type", "app_id"],
                properties: {
                  project_type: { enum: ["app"] },
                  app_id: { type: "string" },
                },
              },
              {
                type: "object",
                required: ["project_type", "pipeline_id"],
                properties: {
                  project_type: { enum: ["pipeline"] },
                  pipeline_id: { type: "string" },
                },
              },
            ],
          },
        },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();
      const accepts = (data: unknown) =>
        tools[0].inputSchema.safeParse({ integration: "i", data }).success;

      expect(accepts({ app_id: "a" })).toBe(true);
      expect(accepts({ project_type: "pipeline", pipeline_id: "p" })).toBe(
        true,
      );
      expect(accepts({ project_type: "pipeline" })).toBe(false);
      expect(accepts({})).toBe(false);
    });

    it("labels union members with their variant titles", () => {
      const spec = specWithBody(
        {
          oneOf: [
            { $ref: "#/components/schemas/A" },
            { $ref: "#/components/schemas/B" },
          ],
        },
        {
          A: integrationVariant(
            "aws_iam_user",
            "aws_assume_role_arn",
            "AWS IAM User",
          ),
          B: integrationVariant("circleci", "api_token", "CircleCI"),
        },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();
      const data = (tools[0].inputSchema as any).shape.data as z.ZodUnion<any>;

      expect(data.options.map((o: z.ZodTypeAny) => o.description)).toEqual([
        "AWS IAM User",
        "CircleCI",
      ]);
    });

    it("collapses variant properties with the same shape into one labeled member", () => {
      const withDescription = (variant: SchemaObject): SchemaObject => ({
        ...variant,
        properties: {
          ...variant.properties,
          data: {
            ...variant.properties!.data,
            description: `Data for ${variant.title}`,
          },
        },
      });
      const spec = specWithBody({
        oneOf: [
          withDescription(integrationVariant("render", "api_key", "Render")),
          withDescription(integrationVariant("railway", "api_key", "Railway")),
          withDescription(integrationVariant("flyio", "app_id", "Fly.io")),
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();
      const data = (tools[0].inputSchema as any).shape.data as z.ZodUnion<any>;

      // Render and Railway share a shape (only their descriptions differ), so they become one member.
      expect(data.options.map((o: z.ZodTypeAny) => o.description)).toEqual([
        "Render, Railway",
        "Fly.io",
      ]);
    });

    it("falls back to a union when variants mix enum and free-form values", () => {
      const spec = specWithBody({
        oneOf: [
          {
            type: "object",
            properties: { kind: { type: "string", enum: ["a"] } },
          },
          { type: "object", properties: { kind: { type: "string" } } },
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].inputSchema.safeParse({ kind: "anything" }).success).toBe(
        true,
      );
      expect(tools[0].inputSchema.safeParse({ kind: 5 }).success).toBe(false);
    });

    it("strips stray quotes from merged enum values", () => {
      const spec = specWithBody({
        oneOf: [
          {
            type: "object",
            properties: { kind: { type: "string", enum: ['"a"'] } },
          },
          { type: "object", properties: { kind: { const: "b" } } },
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].inputSchema.safeParse({ kind: "a" }).success).toBe(true);
      expect(tools[0].inputSchema.safeParse({ kind: "b" }).success).toBe(true);
    });

    it("converts allOf to an intersection", () => {
      const spec = specWithQueryParam({
        allOf: [
          {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" } },
          },
          {
            type: "object",
            required: ["b"],
            properties: { b: { type: "string" } },
          },
        ],
      });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(
        tools[0].inputSchema.safeParse({ value: { a: "x", b: "y" } }).success,
      ).toBe(true);
      expect(
        tools[0].inputSchema.safeParse({ value: { a: "x" } }).success,
      ).toBe(false);
    });

    it("treats OpenAPI 3.1 type arrays with null as nullable", () => {
      const spec = specWithQueryParam({ type: ["string", "null"] });

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].inputSchema.safeParse({ value: null }).success).toBe(
        true,
      );
      expect(tools[0].inputSchema.safeParse({ value: "n" }).success).toBe(true);
      expect(tools[0].inputSchema.safeParse({ value: 5 }).success).toBe(false);
    });

    it("handles null-only and multi-type type arrays", () => {
      const nullOnly = new OpenAPIParser(
        specWithQueryParam({ type: ["null"] }),
      ).parseToTools();
      const multi = new OpenAPIParser(
        specWithQueryParam({ type: ["string", "integer"] }),
      ).parseToTools();

      expect(nullOnly[0].inputSchema.safeParse({ value: null }).success).toBe(
        true,
      );
      expect(nullOnly[0].inputSchema.safeParse({ value: 1 }).success).toBe(
        false,
      );
      // More than one non-null type isn't narrowed further.
      expect(multi[0].inputSchema.safeParse({ value: 1 }).success).toBe(true);
      expect(multi[0].inputSchema.safeParse({ value: "s" }).success).toBe(true);
    });

    it("converts const to a literal and resolves $ref parameter schemas", () => {
      const spec = {
        ...createMockSpec({
          "/v3/things": {
            get: {
              operationId: "things-list",
              summary: "List",
              parameters: [
                {
                  name: "kind",
                  in: "query",
                  required: true,
                  schema: { const: "fixed" },
                },
                {
                  name: "per_page",
                  in: "query",
                  required: true,
                  schema: { $ref: "#/components/schemas/PerPage" },
                },
              ],
              responses: { "200": { description: "Success" } },
            },
          },
        }),
        components: { schemas: { PerPage: { type: "integer", minimum: 1 } } },
      } satisfies OpenAPISpec;

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(
        tools[0].inputSchema.safeParse({ kind: "fixed", per_page: 5 }).success,
      ).toBe(true);
      expect(
        tools[0].inputSchema.safeParse({ kind: "other", per_page: 5 }).success,
      ).toBe(false);
      expect(
        tools[0].inputSchema.safeParse({ kind: "fixed", per_page: 0 }).success,
      ).toBe(false);
    });

    it("unescapes JSON Pointer segments in $refs", () => {
      const spec = specWithQueryParam(
        { $ref: "#/components/schemas/a~1b~0c" },
        { "a/b~c": { type: "integer" } },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools[0].inputSchema.safeParse({ value: 1 }).success).toBe(true);
      expect(tools[0].inputSchema.safeParse({ value: "x" }).success).toBe(
        false,
      );
    });

    it("treats missing and non-local $refs as any, with a warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const missing = new OpenAPIParser(
          specWithQueryParam({ $ref: "#/components/schemas/Missing" }),
        ).parseToTools();
        const external = new OpenAPIParser(
          specWithQueryParam({ $ref: "https://example.com/schema.json" }),
        ).parseToTools();

        expect(
          missing[0].inputSchema.safeParse({ value: { any: "thing" } }).success,
        ).toBe(true);
        expect(external[0].inputSchema.safeParse({ value: 1 }).success).toBe(
          true,
        );
        expect(warn).toHaveBeenCalledTimes(2);
      } finally {
        warn.mockRestore();
      }
    });

    it("doesn't loop forever on a self-referencing $ref", () => {
      const spec = specWithBody(
        { $ref: "#/components/schemas/Loop" },
        { Loop: { $ref: "#/components/schemas/Loop" } },
      );

      const parser = new OpenAPIParser(spec);

      expect(() => parser.parseToTools()).not.toThrow();
    });

    it("handles a schema that refers to itself through a property", () => {
      const spec = specWithBody(
        {
          type: "object",
          properties: { node: { $ref: "#/components/schemas/Node" } },
        },
        {
          Node: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              children: {
                type: "array",
                items: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      );

      const parser = new OpenAPIParser(spec);
      const tools = parser.parseToTools();

      expect(tools).toHaveLength(1);
      expect(
        tools[0].inputSchema.safeParse({
          node: { name: "root", children: [{ name: "leaf" }] },
        }).success,
      ).toBe(true);
      expect(
        tools[0].inputSchema.safeParse({ node: { children: [] } }).success,
      ).toBe(false);
    });
  });
});
