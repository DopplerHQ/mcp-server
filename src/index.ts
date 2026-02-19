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
import { TokenCache } from "./token-cache.js";
import { generateAuthCode, DeviceAuthState } from "./device-auth.js";

interface CLIOptions {
  command?: "login" | "logout";
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
      case "login":
      case "logout":
        options.command = arg;
        break;
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

Usage: npx @dopplerhq/mcp-server [command] [options]

Commands:
  login              Authenticate with Doppler (interactive)
  logout             Clear cached auth credentials

Options:
  --read-only        Enable read-only mode (only GET operations)
  --project <name>   Override auto-detected project
  --config <name>    Override auto-detected config
  --verbose, -v      Enable verbose logging to stderr
  --help, -h         Show this help message

Environment Variables:
  DOPPLER_TOKEN        Your Doppler API token (optional if logged in)
  DOPPLER_BASE_URL     Base URL for Doppler API (optional)

Examples:
  # First-time setup: authenticate with Doppler
  npx @dopplerhq/mcp-server login

  # Run the server (uses cached credentials)
  npx @dopplerhq/mcp-server

  # With explicit token (no login required)
  DOPPLER_TOKEN=dp.st.xxx npx @dopplerhq/mcp-server

  # Read-only mode
  npx @dopplerhq/mcp-server --read-only

  # Clear cached credentials
  npx @dopplerhq/mcp-server logout
`);
}

type AuthenticatedServerResult =
  | { success: true; server: FastMCP }
  | { success: false; reason: "invalid_token" };

function showAuthRequiredError(): never {
  console.error(
    "Not authenticated. Run 'npx @dopplerhq/mcp-server login' first, or set DOPPLER_TOKEN environment variable.",
  );
  process.exit(1);
}

async function startAuthenticatedServer(
  options: CLIOptions,
  openApiSpec: OpenAPISpec,
  token: string,
): Promise<AuthenticatedServerResult> {
  const authManager = new AuthManager(token);
  const client = new DopplerClient(authManager);

  log("Testing Doppler API connection...");
  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    return { success: false, reason: "invalid_token" };
  }
  log("✓ Successfully connected to Doppler API");

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
    if (detectedScope.project) parts.push(`project: ${detectedScope.project}`);
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

  const parser = new OpenAPIParser(openApiSpec);
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

  const serverName = options.readOnly ? "doppler-api-readonly" : "doppler-api";
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
  log(`Doppler MCP Server started successfully!${modeText}`);
  log(`Available tools: ${mcpTools.length}`);
  log(`Base URL: ${client.getBaseUrl()}`);

  if (options.readOnly) {
    log("Read-only mode: Only GET operations are available");
  }
  if (effectiveScope.project) {
    log(`Project: ${effectiveScope.project}`);
  }
  if (effectiveScope.config) {
    log(`Config: ${effectiveScope.config}`);
  }

  const exampleTools = dopplerTools.slice(0, 5);
  log("\n📋 Example available tools:");
  for (const tool of exampleTools) {
    log(`  - ${tool.name}: ${tool.description}`);
  }

  if (dopplerTools.length > 5) {
    log(`  ... and ${dopplerTools.length - 5} more tools`);
  }

  return { success: true, server };
}

async function createDopplerMCPServer(options: CLIOptions = {}) {
  verboseMode = options.verbose ?? false;

  try {
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

    const tokenCache = new TokenCache();
    const cachedToken = await tokenCache.loadToken();

    if (cachedToken) {
      const validation = AuthManager.validateToken(cachedToken.token);
      if (!validation.valid) {
        warn("Cached token appears invalid.");
        await tokenCache.clearToken();
        showAuthRequiredError();
      }

      const source = tokenCache.isFromEnvironment() ? "environment" : "keyring";
      log(`Loaded token from ${source}`);

      const result = await startAuthenticatedServer(
        options,
        openApiSpec,
        cachedToken.token,
      );

      if (result.success) {
        return result.server;
      }

      warn("Cached token is no longer valid.");
      await tokenCache.clearToken();
      showAuthRequiredError();
    }

    showAuthRequiredError();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to start Doppler MCP Server:", errorMessage);
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

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("doppler-mcp") ||
  process.argv[1]?.endsWith("index.js");

async function handleLogin() {
  const tokenCache = new TokenCache();

  if (tokenCache.isFromEnvironment()) {
    console.error("DOPPLER_TOKEN is set. Unset it to use interactive login.");
    process.exit(1);
  }

  const { promptChoice, promptToken, copyToClipboard, openBrowser } =
    await import("./prompt.js");

  console.error("Doppler MCP Server - Login\n");

  const choice = await promptChoice(
    "How would you like to authenticate?",
    ["Create new CLI token", "Enter a token manually"],
    0,
  );

  if (choice === 1) {
    const token = await promptToken();
    if (token) {
      const validation = AuthManager.validateToken(token);
      if (!validation.valid) {
        console.error("Invalid token format.");
        process.exit(1);
      }
      await tokenCache.saveToken(token);
      console.error("\n✓ Logged in. Token saved to system keyring.");
      console.error("\nRun the server with: npx @dopplerhq/mcp-server");
      process.exit(0);
    }
    console.error("No token provided.");
    process.exit(1);
  }

  const baseUrl = process.env.DOPPLER_BASE_URL || "https://api.doppler.com";
  const authCodeResponse = await generateAuthCode(baseUrl);
  const authState = new DeviceAuthState(authCodeResponse, baseUrl);

  const browserChoice = await promptChoice(
    "Open the authorization page in your browser?",
    ["Yes", "No"],
    0,
  );

  if (browserChoice === 0) {
    try {
      await openBrowser(authState.authUrl);
    } catch {}
  }

  console.error(`\nComplete authorization at ${authState.authUrl}`);
  console.error(`Your auth code is:\n\x1b[32m${authState.code}\x1b[0m\n`);

  try {
    await copyToClipboard(authState.code);
    console.error("(Copied to clipboard)");
  } catch {}

  console.error("\nWaiting for authentication...");

  const token = await new Promise<string>((resolve, reject) => {
    authState.startPolling(async (result) => {
      resolve(result.token);
    });

    setTimeout(
      () => reject(new Error("Authentication timed out")),
      5 * 60 * 1000,
    );
  });

  await tokenCache.saveToken(token);
  console.error("\n✓ Logged in. Token saved to system keyring.");
  console.error("\nRun the server with: npx @dopplerhq/mcp-server");
  process.exit(0);
}

async function handleLogout() {
  const tokenCache = new TokenCache();

  if (tokenCache.isFromEnvironment()) {
    console.error(
      "Cannot logout: token is set via DOPPLER_TOKEN environment variable.",
    );
    console.error("Unset the environment variable to logout.");
    process.exit(1);
  }

  await tokenCache.clearToken();
  console.error("✓ Logged out. Cached credentials have been cleared.");
  console.error(
    "Your token has not been revoked. To revoke it, visit the Doppler dashboard.",
  );
  process.exit(0);
}

if (isMainModule) {
  const options = parseCLIArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.command === "login") {
    handleLogin().catch((error) => {
      console.error(
        "Login failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
  } else if (options.command === "logout") {
    handleLogout().catch((error) => {
      console.error(
        "Logout failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
  } else {
    createDopplerMCPServer(options).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  }
}

export { createDopplerMCPServer };
