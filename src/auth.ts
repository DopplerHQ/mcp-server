import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export type TokenType =
  | "service_token" // dp.st.* - Project/config scoped
  | "service_account" // dp.sa.* - Workspace automation
  | "personal" // dp.pt.* - User personal token
  | "cli" // dp.ct.* - CLI token
  | "scim" // dp.scim.* - SCIM provisioning
  | "unknown";

interface DopplerConfig {
  token: string;
  baseUrl: string;
}

/**
 * Detect token type from Doppler token prefix.
 * Formats: dp.st.* (service account), dp.pt.* (personal), dp.ct.* (CLI)
 */
export function detectTokenType(token: string): TokenType {
  if (!token?.trim() || !token.startsWith("dp.")) {
    return "unknown";
  }

  const parts = token.split(".");
  if (parts.length < 3 || !parts[2]) {
    return "unknown";
  }

  switch (parts[1]) {
    case "st":
      return "service_token"; // Project/config scoped service token
    case "sa":
      return "service_account"; // Workspace-level service account
    case "pt":
      return "personal";
    case "ct":
      return "cli";
    case "scim":
      return "scim";
    default:
      return "unknown";
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json at startup
function getPackageVersion(): string {
  try {
    const packagePath = path.join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = getPackageVersion();

export class AuthManager {
  private config: DopplerConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): DopplerConfig {
    const token = process.env.DOPPLER_TOKEN;

    if (!token) {
      throw new Error(
        "DOPPLER_TOKEN environment variable is required. " +
          "Please set it to your Doppler API token.",
      );
    }

    // Validate token format (Doppler tokens typically start with 'dp.')
    if (!token.startsWith("dp.")) {
      console.warn(
        "Warning: DOPPLER_TOKEN does not appear to be a valid Doppler token format. " +
          'Valid tokens typically start with "dp."',
      );
    }

    return {
      token,
      baseUrl: process.env.DOPPLER_BASE_URL || "https://api.doppler.com",
    };
  }

  public getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
      "User-Agent": `doppler-mcp-server/${VERSION}`,
    };
  }

  public getBaseUrl(): string {
    return this.config.baseUrl;
  }

  public static validateEnvironment(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!process.env.DOPPLER_TOKEN) {
      errors.push("DOPPLER_TOKEN environment variable is required");
    } else if (!process.env.DOPPLER_TOKEN.startsWith("dp.")) {
      errors.push(
        "DOPPLER_TOKEN does not appear to be a valid Doppler token format",
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public static getSetupInstructions(): string {
    return `
To use this MCP server, you need to set the DOPPLER_TOKEN environment variable:

1. Get your Doppler API token from: https://dashboard.doppler.com/access-tokens
2. Set the environment variable:
   export DOPPLER_TOKEN=dp.your-token-here
3. Run the MCP server:
   npx @dopplerhq/mcp-server

Example:
  DOPPLER_TOKEN=dp.your-token-here npx @dopplerhq/mcp-server

For more information, visit: https://docs.doppler.com/reference/api
    `;
  }
}
