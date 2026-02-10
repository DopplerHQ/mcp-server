import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectImplicitScope } from "../src/scope.js";
import { DopplerClient } from "../src/client.js";
import { AuthManager } from "../src/auth.js";
import { mockDopplerAPI } from "./helpers.js";

const mockFetch = vi.fn();
const originalFetch = global.fetch;

function createAuthenticatedClient(): DopplerClient {
  const authManager = new AuthManager("dp.test.fake_token_for_testing");
  return new DopplerClient(authManager);
}

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("detectImplicitScope with DopplerClient", () => {
  it("detects both project and config when exactly one of each", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["my-app"],
      configs: { "my-app": ["production"] },
    });

    const scope = await detectImplicitScope(createAuthenticatedClient());

    expect(scope.project).toBe("my-app");
    expect(scope.config).toBe("production");
  });

  it("detects only project when multiple configs exist", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["my-app"],
      configs: { "my-app": ["dev", "stg", "prd"] },
    });

    const scope = await detectImplicitScope(createAuthenticatedClient());

    expect(scope.project).toBe("my-app");
    expect(scope.config).toBeUndefined();
  });

  it("detects nothing when multiple projects exist", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["app-one", "app-two", "app-three"],
    });

    const scope = await detectImplicitScope(createAuthenticatedClient());

    expect(scope.project).toBeUndefined();
    expect(scope.config).toBeUndefined();
  });
});
