#!/usr/bin/env node

import { FastMCP } from "fastmcp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { OpenAPIParser } from "./parser.js";
import { ToolGenerator } from "./generator.js";
import { DopplerClient } from "./client.js";
import { AuthManager, detectTokenType } from "./auth.js";
import { OpenAPISpec } from "./types.js";
import { detectImplicitScope, mergeScope, validateScope } from "./scope.js";
import {
  getAccessMessages,
  createConfirmAccessTool,
  type AccessContext,
} from "./access-warnings.js";

interface CLIOptions {
  readOnly?: boolean;
  project?: string;
  config?: string;
  help?: boolean;
  verbose?: boolean;
}

const ORG_LEVEL_ENDPOINT_PREFIXES = ["/v3/workplace", "/v3/logs"];

let verboseMode = false;

function log(message: string) {
  if (verboseMode) {
    console.error(message);
  }
}

function warn(message: string) {
  console.error(message);
}

function emitStartupMessages(ctx: AccessContext) {
  for (const m of getAccessMessages(ctx)) {
    if (m.level === "info") {
      log(`${m.emoji} ${m.message}`);
    } else {
      warn(`${m.emoji} ${m.message}`);
    }
  }
}

function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--read-only":
        options.readOnly = true;
        break;
      case "--project":
        options.project = args[++i];
        break;
      case "--config":
        options.config = args[++i];
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Doppler MCP Server

Usage: npx @dopplerhq/mcp-server [options]

Options:
  --read-only        Enable read-only mode (only GET operations)
  --project <name>   Override auto-detected project
  --config <name>    Override auto-detected config
  --verbose, -v      Enable verbose logging to stderr
  --help, -h         Show this help message

Environment Variables:
  DOPPLER_TOKEN        Your Doppler API token (required)
  DOPPLER_BASE_URL     Base URL for Doppler API (optional)

Scope Detection:
  The server auto-detects scope from your token's access:
  - Single project access → project set automatically
  - Single config access  → config set automatically
  CLI flags override auto-detected values.

Examples:
  # Basic usage (scope auto-detected from token)
  DOPPLER_TOKEN=dp.st.xxx npx @dopplerhq/mcp-server

  # Read-only mode
  DOPPLER_TOKEN=dp.xxx npx @dopplerhq/mcp-server --read-only

  # Override auto-detected project
  DOPPLER_TOKEN=dp.xxx npx @dopplerhq/mcp-server --project my-app
`);
}

async function createDopplerMCPServer(options: CLIOptions = {}) {
  verboseMode = options.verbose ?? false;

  try {
    const validation = AuthManager.validateEnvironment();
    if (!validation.valid) {
      console.error("Environment validation failed:");
      for (const error of validation.errors) {
        console.error(`  - ${error}`);
      }
      console.error("\n" + AuthManager.getSetupInstructions());
      process.exit(1);
    }

    const specPath = path.join(__dirname, "..", "doppler-openapi.json");
    let openApiSpec: OpenAPISpec;

    try {
      const specContent = fs.readFileSync(specPath, "utf-8");
      openApiSpec = JSON.parse(specContent);
    } catch (error) {
      console.error(
        `Failed to load OpenAPI specification from ${specPath}:`,
        error,
      );
      process.exit(1);
    }

    const parser = new OpenAPIParser(openApiSpec);
    const client = new DopplerClient();

    log("Testing Doppler API connection...");
    const connectionTest = await client.testConnection();
    if (!connectionTest.success) {
      console.error("Failed to connect to Doppler API:", connectionTest.error);
      console.error("\nPlease check your DOPPLER_TOKEN and try again.");
      process.exit(1);
    }
    log("✓ Successfully connected to Doppler API");

    // Detect token type early - needed to decide if auto-scope is safe
    const token = process.env.DOPPLER_TOKEN ?? "";
    const tokenType = detectTokenType(token);

    // Only auto-detect scope for service tokens (dp.st.*) which are genuinely
    // scoped by Doppler. For other token types (service accounts, personal, etc.),
    // seeing one project just means "workspace currently has one project" -
    // creating another would change the scope unexpectedly.
    const detectedScope =
      tokenType === "service_token"
        ? await detectImplicitScope(client)
        : { project: undefined, config: undefined };

    const cliScope = { project: options.project, config: options.config };
    validateScope(detectedScope, cliScope);

    const effectiveScope = mergeScope(detectedScope, cliScope);

    if (detectedScope.project || detectedScope.config) {
      const parts = [];
      if (detectedScope.project)
        parts.push(`project: ${detectedScope.project}`);
      if (detectedScope.config) parts.push(`config: ${detectedScope.config}`);
      log(`✓ Auto-detected scope: ${parts.join(", ")}`);
    }

    const scopeOptions = {
      project: effectiveScope.project,
      projectSource: options.project
        ? "cli"
        : detectedScope.project
          ? "token"
          : undefined,
      config: effectiveScope.config,
      configSource: options.config
        ? "cli"
        : detectedScope.config
          ? "token"
          : undefined,
    } as const;

    const generator = new ToolGenerator(client, scopeOptions);

    log("Parsing OpenAPI specification...");
    let dopplerTools = parser.parseToTools();

    if (options.readOnly) {
      dopplerTools = dopplerTools.filter((tool) => tool.method === "GET");
      log(`✓ Filtered to ${dopplerTools.length} read-only endpoints`);
    } else {
      log(`✓ Parsed ${dopplerTools.length} API endpoints`);
    }

    if (effectiveScope.project) {
      const beforeCount = dopplerTools.length;
      dopplerTools = dopplerTools.filter(
        (tool) =>
          !ORG_LEVEL_ENDPOINT_PREFIXES.some((prefix) =>
            tool.endpoint.startsWith(prefix),
          ),
      );
      log(
        `✓ Filtered out org-level tools: ${beforeCount} → ${dopplerTools.length} endpoints`,
      );
    }

    if (effectiveScope.config) {
      dopplerTools = dopplerTools.filter(
        (tool) =>
          tool.endpoint.includes("/configs/") ||
          tool.name.includes("config") ||
          tool.endpoint.includes("/secrets/") ||
          tool.name.includes("secret"),
      );
      log(
        `✓ Filtered for config-related tools: ${dopplerTools.length} endpoints`,
      );
    }

    log("Generating MCP tools...");
    const mcpTools = generator.generateTools(dopplerTools);
    log(`✓ Generated ${mcpTools.length} MCP tools`);

    const accessContext: AccessContext = {
      tokenType,
      readOnly: options.readOnly ?? false,
      project: effectiveScope.project,
      config: effectiveScope.config,
    };
    emitStartupMessages(accessContext);

    const serverName = options.readOnly
      ? "doppler-api-readonly"
      : "doppler-api";
    const server = new FastMCP({
      name: serverName,
      version: "1.0.0",
    });

    const confirmAccessTool = createConfirmAccessTool(accessContext);
    if (confirmAccessTool) {
      server.addTool(confirmAccessTool);
    }

    for (const tool of mcpTools) {
      server.addTool(tool);
    }

    server.start({ transportType: "stdio" });

    const modeText = options.readOnly ? " (Read-Only Mode)" : "";
    log(`🚀 Doppler MCP Server started successfully!${modeText}`);
    log(`📊 Available tools: ${mcpTools.length}`);
    log(`🔗 Base URL: ${client.getBaseUrl()}`);

    if (options.readOnly) {
      log("🔒 Read-only mode: Only GET operations are available");
    }
    if (effectiveScope.project) {
      log(`🎯 Project: ${effectiveScope.project}`);
    }
    if (effectiveScope.config) {
      log(`🎯 Config: ${effectiveScope.config}`);
    }

    const exampleTools = dopplerTools.slice(0, 5);
    log("\n📋 Example available tools:");
    for (const tool of exampleTools) {
      log(`  - ${tool.name}: ${tool.description}`);
    }

    if (dopplerTools.length > 5) {
      log(`  ... and ${dopplerTools.length - 5} more tools`);
    }

    return server;
  } catch (error) {
    console.error("Failed to start Doppler MCP Server:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.error("\n👋 Shutting down Doppler MCP Server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("\n👋 Shutting down Doppler MCP Server...");
  process.exit(0);
});

const options = parseCLIArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

createDopplerMCPServer(options).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { createDopplerMCPServer };
