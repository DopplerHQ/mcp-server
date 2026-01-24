import { describe, it, expect, beforeAll } from "vitest";
import { OpenAPIParser } from "../src/parser.js";
import type { OpenAPISpec } from "../src/types.js";

describe("OpenAPIParser with real Doppler spec", () => {
  let spec: OpenAPISpec;
  let parser: OpenAPIParser;

  beforeAll(async () => {
    const response = await fetch("https://docs.doppler.com/openapi/core.json");
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
    }
    spec = await response.json();
    parser = new OpenAPIParser(spec);
  });

  it("fetches and parses the spec successfully", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths).toBeDefined();
  });

  it("generates 50+ tools from the spec", () => {
    const tools = parser.parseToTools();
    expect(tools.length).toBeGreaterThan(50);
  });

  it("includes expected core Doppler endpoints", () => {
    const tools = parser.parseToTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("workplace_get");
    expect(toolNames).toContain("projects_list");
    expect(toolNames).toContain("projects_create");
    expect(toolNames).toContain("configs_list");
    expect(toolNames).toContain("secrets_list");
  });
});
