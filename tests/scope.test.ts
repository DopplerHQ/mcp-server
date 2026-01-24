import { describe, it, expect, vi } from "vitest";
import {
  detectImplicitScope,
  mergeScope,
  validateScope,
  type ScopeClient,
  type ScopeOptions,
} from "../src/scope.js";

function mockClient(
  projects: string[],
  configs: Record<string, string[]> = {},
): ScopeClient {
  return {
    listProjects: vi.fn().mockResolvedValue(projects.map((slug) => ({ slug }))),
    listConfigs: vi
      .fn()
      .mockImplementation(async (project: string) =>
        (configs[project] ?? []).map((name) => ({ name, slug: name })),
      ),
  };
}

describe("detectImplicitScope", () => {
  it("returns project + config when exactly one of each", async () => {
    const client = mockClient(["my-app"], { "my-app": ["production"] });

    const scope = await detectImplicitScope(client);

    expect(scope.project).toBe("my-app");
    expect(scope.config).toBe("production");
    expect(client.listProjects).toHaveBeenCalledTimes(1);
    expect(client.listConfigs).toHaveBeenCalledWith("my-app");
  });

  it("returns only project when multiple configs exist", async () => {
    const client = mockClient(["my-app"], { "my-app": ["dev", "stg", "prd"] });

    const scope = await detectImplicitScope(client);

    expect(scope.project).toBe("my-app");
    expect(scope.config).toBeUndefined();
  });

  it("returns empty when multiple projects exist", async () => {
    const client = mockClient(["app-one", "app-two"]);

    const scope = await detectImplicitScope(client);

    expect(scope.project).toBeUndefined();
    expect(scope.config).toBeUndefined();
    expect(client.listConfigs).not.toHaveBeenCalled();
  });

  it("returns empty when no projects exist", async () => {
    const client = mockClient([]);

    const scope = await detectImplicitScope(client);

    expect(scope.project).toBeUndefined();
    expect(scope.config).toBeUndefined();
  });

  it("returns only project when no configs exist", async () => {
    const client = mockClient(["my-app"], { "my-app": [] });

    const scope = await detectImplicitScope(client);

    expect(scope.project).toBe("my-app");
    expect(scope.config).toBeUndefined();
  });
});

describe("mergeScope", () => {
  it("CLI args take precedence", () => {
    const detected = { project: "detected-project", config: "detected-config" };
    const cliArgs = { project: "cli-project", config: "cli-config" };

    const result = mergeScope(detected, cliArgs);

    expect(result.project).toBe("cli-project");
    expect(result.config).toBe("cli-config");
  });

  it("uses detected values when CLI args undefined", () => {
    const detected = { project: "detected-project", config: "detected-config" };

    const result = mergeScope(detected, {
      project: undefined,
      config: undefined,
    });

    expect(result.project).toBe("detected-project");
    expect(result.config).toBe("detected-config");
  });

  it("clears config when CLI provides different project", () => {
    const detected = { project: "detected-project", config: "detected-config" };

    const result = mergeScope(detected, {
      project: "different-project",
      config: undefined,
    });

    expect(result.project).toBe("different-project");
    expect(result.config).toBeUndefined();
  });

  it("keeps config when CLI provides same project", () => {
    const detected = { project: "my-project", config: "detected-config" };

    const result = mergeScope(detected, {
      project: "my-project",
      config: undefined,
    });

    expect(result.project).toBe("my-project");
    expect(result.config).toBe("detected-config");
  });

  it("allows CLI config to override detected config", () => {
    const detected = { project: "my-project", config: "detected-config" };

    const result = mergeScope(detected, {
      project: undefined,
      config: "cli-config",
    });

    expect(result.project).toBe("my-project");
    expect(result.config).toBe("cli-config");
  });
});

describe("validateScope", () => {
  it("throws when --config without effective project", () => {
    expect(() =>
      validateScope(
        { project: undefined, config: undefined },
        { project: undefined, config: "production" },
      ),
    ).toThrow(/--config requires --project/);
  });

  it("error mentions multiple projects", () => {
    expect(() =>
      validateScope(
        { project: undefined, config: undefined },
        { project: undefined, config: "production" },
      ),
    ).toThrow(/multiple projects/i);
  });

  it("allows --config with --project", () => {
    expect(() =>
      validateScope(
        { project: undefined, config: undefined },
        { project: "my-project", config: "production" },
      ),
    ).not.toThrow();
  });

  it("allows --config with detected project", () => {
    expect(() =>
      validateScope(
        { project: "detected-project", config: undefined },
        { project: undefined, config: "production" },
      ),
    ).not.toThrow();
  });

  it("allows no --config", () => {
    expect(() =>
      validateScope(
        { project: undefined, config: undefined },
        { project: undefined, config: undefined },
      ),
    ).not.toThrow();
  });
});

describe("ScopeOptions type", () => {
  it("can be constructed with all fields", () => {
    const options: ScopeOptions = {
      project: "my-project",
      projectSource: "cli",
      config: "production",
      configSource: "token",
    };

    expect(options.project).toBe("my-project");
    expect(options.projectSource).toBe("cli");
    expect(options.config).toBe("production");
    expect(options.configSource).toBe("token");
  });

  it("allows partial construction", () => {
    const options: ScopeOptions = {
      project: "my-project",
    };

    expect(options.project).toBe("my-project");
    expect(options.config).toBeUndefined();
  });
});
