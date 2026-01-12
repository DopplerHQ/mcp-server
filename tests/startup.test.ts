import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDopplerAPI, minimalOpenAPISpec } from "./helpers.js";

const mockFetch = vi.fn();
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

describe("MCP server startup", () => {
  let consoleOutput: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    consoleOutput = [];
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push(args.join(" "));

    process.env = { ...originalEnv };
    process.env.DOPPLER_TOKEN = "dp.st.test_token";
    global.fetch = mockFetch;
    mockFetch.mockReset();

    vi.resetModules();

    vi.doMock("fs", () => ({
      readFileSync: () => JSON.stringify(minimalOpenAPISpec),
    }));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("auto-detects and logs scope from config-scoped token", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["my-app"],
      configs: { "my-app": ["production"] },
    });

    const { createDopplerMCPServer } = await import("../src/index.js");
    await createDopplerMCPServer({ verbose: true });

    const output = consoleOutput.join("\n");
    expect(output).toContain("my-app");
    expect(output).toContain("production");
    expect(output).toMatch(/auto[- ]?detect|implicit|detected/i);
  });

  it("auto-detects project only when multiple configs exist", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["my-app"],
      configs: { "my-app": ["dev", "staging", "production"] },
    });

    const { createDopplerMCPServer } = await import("../src/index.js");
    await createDopplerMCPServer({ verbose: true });

    const output = consoleOutput.join("\n");
    expect(output).toContain("my-app");
    expect(output).toMatch(/auto[- ]?detect|implicit|detected/i);
  });

  it("CLI args override auto-detected scope", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["my-app"],
      configs: { "my-app": ["production"] },
    });

    const { createDopplerMCPServer } = await import("../src/index.js");
    await createDopplerMCPServer({
      verbose: true,
      project: "other-project",
      config: "dev",
    });

    const output = consoleOutput.join("\n");
    expect(output).toContain("other-project");
    expect(output).toContain("dev");
  });

  it("errors when --config provided without effective project", async () => {
    mockDopplerAPI(mockFetch, {
      projects: ["app-one", "app-two"],
    });

    const { createDopplerMCPServer } = await import("../src/index.js");

    try {
      await createDopplerMCPServer({ config: "production" });
    } catch {
      // process.exit throws in test environment
    }

    const output = consoleOutput.join("\n");
    expect(output).toMatch(/--config requires --project/);
  });
});
