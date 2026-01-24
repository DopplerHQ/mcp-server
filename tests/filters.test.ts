import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDopplerAPI, filterTestOpenAPISpec } from "./helpers.js";

const mockFetch = vi.fn();
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

/**
 * Filter tests use filterTestOpenAPISpec which has:
 * - 11 total tools
 * - Org-level: /v3/workplace/*, /v3/logs (4 tools)
 * - Project-level: /v3/projects, /v3/environments (3 tools)
 * - Config-level: /v3/configs/*, /v3/configs/config/secrets (4 tools)
 * - GET methods: 7, POST methods: 4
 */
describe("CLI filter flags", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOPPLER_TOKEN = "dp.st.test_token";
    global.fetch = mockFetch;
    mockFetch.mockReset();

    vi.resetModules();

    vi.doMock("fs", () => ({
      readFileSync: () => JSON.stringify(filterTestOpenAPISpec),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("--read-only", () => {
    it("only includes GET methods", async () => {
      mockDopplerAPI(mockFetch, {
        projects: ["my-app"],
        configs: { "my-app": ["dev"] },
      });

      const { createDopplerMCPServer } = await import("../src/index.js");

      // Capture tool registrations by inspecting what gets logged
      const consoleOutput: string[] = [];
      const originalError = console.error;
      console.error = (...args) => consoleOutput.push(args.join(" "));

      await createDopplerMCPServer({ readOnly: true, verbose: true });

      console.error = originalError;

      // Parse logged output to verify filtering
      const output = consoleOutput.join("\n");
      expect(output).toMatch(/read-only/i);

      // The key assertion: filtered count < total count
      const filteredMatch = output.match(/(\d+) read-only endpoints/);
      const totalMatch = output.match(/Parsed (\d+) API endpoints/);

      // With filterTestOpenAPISpec: 7 GET, 4 POST = 11 total, 7 read-only
      expect(filteredMatch).toBeTruthy();
      const filteredCount = parseInt(filteredMatch![1]);
      expect(filteredCount).toBeLessThan(11); // Less than total
      expect(filteredCount).toBeGreaterThan(0); // But not zero
    });
  });

  describe("--project", () => {
    it("filters out org-level endpoints", async () => {
      mockDopplerAPI(mockFetch, {
        projects: ["my-app"],
        configs: { "my-app": ["dev"] },
      });

      const { createDopplerMCPServer } = await import("../src/index.js");

      const consoleOutput: string[] = [];
      const originalError = console.error;
      console.error = (...args) => consoleOutput.push(args.join(" "));

      await createDopplerMCPServer({ project: "my-app", verbose: true });

      console.error = originalError;

      const output = consoleOutput.join("\n");

      // Should log filtering action
      expect(output).toMatch(/org-level/i);

      // Should show reduction: "11 → 7" (filters out 4 org-level tools)
      const filterMatch = output.match(/(\d+) → (\d+) endpoints/);
      expect(filterMatch).toBeTruthy();
      const [, before, after] = filterMatch!;
      expect(parseInt(after)).toBeLessThan(parseInt(before));
    });
  });

  describe("--config", () => {
    it("keeps only config and secret related tools", async () => {
      mockDopplerAPI(mockFetch, {
        projects: ["my-app"],
        configs: { "my-app": ["production"] },
      });

      const { createDopplerMCPServer } = await import("../src/index.js");

      const consoleOutput: string[] = [];
      const originalError = console.error;
      console.error = (...args) => consoleOutput.push(args.join(" "));

      await createDopplerMCPServer({
        project: "my-app",
        config: "production",
        verbose: true,
      });

      console.error = originalError;

      const output = consoleOutput.join("\n");

      // Should log config filtering
      expect(output).toMatch(/config-related/i);

      // With filterTestOpenAPISpec: should reduce to 4 config/secret tools
      const filterMatch = output.match(/config-related tools: (\d+) endpoints/);
      expect(filterMatch).toBeTruthy();
      const configToolCount = parseInt(filterMatch![1]);
      expect(configToolCount).toBeLessThan(11); // Less than total
      expect(configToolCount).toBeGreaterThan(0); // But not zero
    });
  });

  describe("combined filters", () => {
    it("--read-only + --project applies both filters", async () => {
      mockDopplerAPI(mockFetch, {
        projects: ["my-app"],
        configs: { "my-app": ["dev"] },
      });

      const { createDopplerMCPServer } = await import("../src/index.js");

      const consoleOutput: string[] = [];
      const originalError = console.error;
      console.error = (...args) => consoleOutput.push(args.join(" "));

      await createDopplerMCPServer({
        readOnly: true,
        project: "my-app",
        verbose: true,
      });

      console.error = originalError;

      const output = consoleOutput.join("\n");

      // Both filters should be mentioned
      expect(output).toMatch(/read-only/i);
      expect(output).toMatch(/org-level/i);
    });
  });
});
