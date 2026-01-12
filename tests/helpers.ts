import { vi } from "vitest";

export const jsonResponse = (data: unknown) => ({
  ok: true,
  headers: {
    get: (h: string) => (h === "content-type" ? "application/json" : null),
  },
  json: async () => data,
});

export function mockDopplerAPI(
  mockFetch: ReturnType<typeof vi.fn>,
  options: {
    projects: string[];
    configs?: Record<string, string[]>;
  },
) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = url.toString();

    if (urlStr.includes("/v3/workplace")) {
      return jsonResponse({ workplace: { name: "Test Workplace" } });
    }

    if (urlStr.includes("/v3/projects") && !urlStr.includes("/v3/projects/")) {
      return jsonResponse({
        projects: options.projects.map((slug) => ({ slug, name: slug })),
      });
    }

    if (urlStr.includes("/v3/configs")) {
      const project = urlStr.match(/project=([^&]+)/)?.[1] ?? "";
      return jsonResponse({
        configs: (options.configs?.[project] ?? []).map((slug) => ({
          slug,
          name: slug,
        })),
      });
    }

    return { ok: false, status: 404, statusText: "Not Found" };
  });
}

export const minimalOpenAPISpec = {
  openapi: "3.0.0",
  info: { title: "Doppler API", version: "1.0.0" },
  servers: [{ url: "https://api.doppler.com" }],
  paths: {
    "/v3/workplace": {
      get: {
        operationId: "workplace-get",
        summary: "Get workplace",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/projects": {
      get: {
        operationId: "projects-list",
        summary: "List projects",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
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
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/configs/config/secrets": {
      get: {
        operationId: "secrets-list",
        summary: "List secrets",
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
        ],
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

// Extended spec for filter testing - includes write methods and org-level endpoints
export const filterTestOpenAPISpec = {
  openapi: "3.0.0",
  info: { title: "Doppler API", version: "1.0.0" },
  servers: [{ url: "https://api.doppler.com" }],
  paths: {
    // Org-level endpoints (filtered by --project)
    "/v3/workplace": {
      get: {
        operationId: "workplace-get",
        summary: "Get workplace",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "workplace-update",
        summary: "Update workplace",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/workplace/users": {
      get: {
        operationId: "workplace-users-list",
        summary: "List workplace users",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/logs": {
      get: {
        operationId: "activity-logs-list",
        summary: "List activity logs",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    // Project-level endpoints (kept by --project)
    "/v3/projects": {
      get: {
        operationId: "projects-list",
        summary: "List projects",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "projects-create",
        summary: "Create project",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/environments": {
      get: {
        operationId: "environments-list",
        summary: "List environments",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    // Config/secret endpoints (kept by --config)
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
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "configs-create",
        summary: "Create config",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
    "/v3/configs/config/secrets": {
      get: {
        operationId: "secrets-list",
        summary: "List secrets",
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
        ],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "secrets-update",
        summary: "Update secrets",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
    },
  },
};
