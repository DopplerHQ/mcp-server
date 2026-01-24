import { describe, it, expect } from "vitest";
import { OpenAPIParser } from "../src/parser.js";
import type { OpenAPISpec } from "../src/types.js";

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

    it("truncates long names to 64 characters", () => {
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

      expect(tools[0].name.length).toBeLessThanOrEqual(64);
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
});
