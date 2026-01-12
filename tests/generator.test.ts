import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolGenerator } from "../src/generator.js";
import type { DopplerTool, Parameter } from "../src/types.js";
import { ScopeViolationError } from "../src/errors.js";
import { z } from "zod";

const mockMakeRequest = vi.fn();

const createMockClient = () => ({
  makeRequest: mockMakeRequest,
  getBaseUrl: () => "https://api.doppler.com",
  testConnection: vi.fn(),
});

const createMockTool = (overrides: Partial<DopplerTool> = {}): DopplerTool => ({
  name: "test_tool",
  description: "A test tool",
  inputSchema: z.object({
    project: z.string(),
    config: z.string().optional(),
  }),
  method: "GET",
  endpoint: "/v3/test",
  parameters: [
    {
      name: "project",
      in: "query",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "config",
      in: "query",
      required: false,
      schema: { type: "string" },
    },
  ] as Parameter[],
  ...overrides,
});

describe("ToolGenerator", () => {
  beforeEach(() => {
    mockMakeRequest.mockReset();
    mockMakeRequest.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateTools", () => {
    it("generates MCP tools from DopplerTool definitions", () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const dopplerTools = [
        createMockTool({ name: "projects_list", endpoint: "/v3/projects" }),
        createMockTool({ name: "configs_list", endpoint: "/v3/configs" }),
      ];

      const mcpTools = generator.generateTools(dopplerTools);

      expect(mcpTools).toHaveLength(2);
      expect(mcpTools[0].name).toBe("projects_list");
      expect(mcpTools[1].name).toBe("configs_list");
    });

    it("includes description in generated tools", () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const dopplerTools = [
        createMockTool({
          name: "workplace_get",
          description: "Retrieve workplace information",
        }),
      ];

      const mcpTools = generator.generateTools(dopplerTools);

      expect(mcpTools[0].description).toBe("Retrieve workplace information");
    });

    it("includes input schema parameters in generated tools", () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const dopplerTools = [createMockTool()];
      const mcpTools = generator.generateTools(dopplerTools);

      expect(mcpTools[0].parameters).toBeDefined();
    });
  });

  describe("tool execution", () => {
    it("makes GET request with correct endpoint", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "workplace_get",
        method: "GET",
        endpoint: "/v3/workplace",
        parameters: [],
        inputSchema: z.object({}),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({});

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/workplace",
        queryParams: {},
        body: undefined,
      });
    });

    it("includes query parameters in the request", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "configs_list",
        method: "GET",
        endpoint: "/v3/configs",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({ project: "my-project" });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/configs",
        queryParams: { project: "my-project" },
        body: undefined,
      });
    });

    it("substitutes path parameters in endpoint URL", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "projects_get",
        method: "GET",
        endpoint: "/v3/projects/{project}",
        parameters: [
          {
            name: "project",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({ project: "my-project" });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/projects/my-project",
        queryParams: {},
        body: undefined,
      });
    });

    it("URL-encodes path parameters", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "projects_get",
        method: "GET",
        endpoint: "/v3/projects/{project}",
        parameters: [
          {
            name: "project",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({ project: "my project/special" });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/projects/my%20project%2Fspecial",
        queryParams: {},
        body: undefined,
      });
    });

    it("includes request body for POST requests", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "projects_create",
        method: "POST",
        endpoint: "/v3/projects",
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
        inputSchema: z.object({
          name: z.string(),
          description: z.string().optional(),
        }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({
        name: "New Project",
        description: "A test project",
      });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "POST",
        endpoint: "/v3/projects",
        queryParams: {},
        body: { name: "New Project", description: "A test project" },
      });
    });

    it("preserves additional body properties not defined in schema", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      // Simulates the secrets endpoint where schema has example keys
      // but users can provide arbitrary secret names
      const tool = createMockTool({
        name: "secrets_update",
        method: "POST",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  // Schema only defines example properties
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
        inputSchema: z
          .object({
            project: z.string(),
            config: z.string(),
            secrets: z.object({}).passthrough(),
          })
          .passthrough(),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({
        project: "my-app",
        config: "dev",
        secrets: {
          MY_CUSTOM_SECRET: "secret-value",
          ANOTHER_SECRET: "another-value",
        },
      });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "POST",
        endpoint: "/v3/configs/config/secrets",
        queryParams: { project: "my-app", config: "dev" },
        body: {
          secrets: {
            MY_CUSTOM_SECRET: "secret-value",
            ANOTHER_SECRET: "another-value",
          },
        },
      });
    });

    it("preserves top-level body properties not in schema", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any);

      const tool = createMockTool({
        name: "endpoint_create",
        method: "POST",
        endpoint: "/v3/endpoint",
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
        inputSchema: z.object({ name: z.string() }).passthrough(),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({
        name: "test",
        extraField: "should-be-preserved",
        anotherExtra: 123,
      });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "POST",
        endpoint: "/v3/endpoint",
        queryParams: {},
        body: {
          name: "test",
          extraField: "should-be-preserved",
          anotherExtra: 123,
        },
      });
    });
  });

  describe("auto-injection of parameters", () => {
    it("auto-injects project parameter when configured", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "injected-project",
      });

      const tool = createMockTool({
        name: "configs_list",
        method: "GET",
        endpoint: "/v3/configs",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string().optional() }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({});

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/configs",
        queryParams: { project: "injected-project" },
        body: undefined,
      });
    });

    it("auto-injects config parameter when configured", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        config: "production",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({
          project: z.string(),
          config: z.string().optional(),
        }),
      });

      const mcpTools = generator.generateTools([tool]);
      await mcpTools[0].execute({ project: "my-project" });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        queryParams: { project: "my-project", config: "production" },
        body: undefined,
      });
    });

    it("allows explicitly provided parameters that match configured scope", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "my-project",
        config: "production",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string(), config: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);
      // Same values as configured - should work
      await mcpTools[0].execute({
        project: "my-project",
        config: "production",
      });

      expect(mockMakeRequest).toHaveBeenCalledWith({
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        queryParams: {
          project: "my-project",
          config: "production",
        },
        body: undefined,
      });
    });
  });

  describe("scope enforcement", () => {
    it("rejects project parameter that differs from CLI-configured scope", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "allowed-project",
        projectSource: "cli",
      });

      const tool = createMockTool({
        name: "configs_list",
        method: "GET",
        endpoint: "/v3/configs",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "different-project" }),
      ).rejects.toThrow(/configured for project/i);
    });

    it("rejects project parameter with token-specific message when token-scoped", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "allowed-project",
        projectSource: "token",
      });

      const tool = createMockTool({
        name: "configs_list",
        method: "GET",
        endpoint: "/v3/configs",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "different-project" }),
      ).rejects.toThrow(/token only has access to project/i);
    });

    it("rejects config parameter that differs from CLI-configured scope", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "my-project",
        config: "production",
        configSource: "cli",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string(), config: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "my-project", config: "staging" }),
      ).rejects.toThrow(/configured for config/i);
    });

    it("rejects config parameter with token-specific message when token-scoped", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "my-project",
        config: "ci",
        configSource: "token",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string(), config: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "my-project", config: "dev" }),
      ).rejects.toThrow(/token only has access to config/i);
    });

    it("includes helpful error message with configured and requested values", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "content-api",
        projectSource: "cli",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "marketing-api" }),
      ).rejects.toThrow(/content-api.*marketing-api/);
    });

    it("throws ScopeViolationError for project violations", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "allowed-project",
        projectSource: "cli",
      });

      const tool = createMockTool({
        name: "configs_list",
        method: "GET",
        endpoint: "/v3/configs",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "different-project" }),
      ).rejects.toThrow(ScopeViolationError);
    });

    it("throws ScopeViolationError for config violations", async () => {
      const client = createMockClient();
      const generator = new ToolGenerator(client as any, {
        project: "my-project",
        config: "production",
        configSource: "token",
      });

      const tool = createMockTool({
        name: "secrets_list",
        method: "GET",
        endpoint: "/v3/configs/config/secrets",
        parameters: [
          {
            name: "project",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "config",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ] as Parameter[],
        inputSchema: z.object({ project: z.string(), config: z.string() }),
      });

      const mcpTools = generator.generateTools([tool]);

      await expect(
        mcpTools[0].execute({ project: "my-project", config: "staging" }),
      ).rejects.toThrow(ScopeViolationError);
    });
  });
});
