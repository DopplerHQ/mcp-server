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
  token: string | null;
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

  constructor(token?: string, baseUrl?: string) {
    this.config = {
      token: token ?? null,
      baseUrl: baseUrl || process.env.DOPPLER_BASE_URL || "https://api.doppler.com",
    };

    if (this.config.token && !this.config.token.startsWith("dp.")) {
      console.warn(
        "Warning: Token does not appear to be a valid Doppler token format. " +
          'Valid tokens typically start with "dp."',
      );
    }
  }

  public getToken(): string | null {
    return this.config.token;
  }

  public setToken(token: string): void {
    if (!token.startsWith("dp.")) {
      console.warn(
        "Warning: Token does not appear to be a valid Doppler token format. " +
          'Valid tokens typically start with "dp."',
      );
    }
    this.config.token = token;
  }

  public getAuthHeaders(): Record<string, string> {
    if (!this.config.token) {
      throw new Error("Not authenticated. Token has not been set.");
    }
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
      "User-Agent": `doppler-mcp-server/${VERSION}`,
    };
  }

  public getBaseUrl(): string {
    return this.config.baseUrl;
  }

  public static validateToken(token: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!token) {
      errors.push("Token is empty");
    } else if (!token.startsWith("dp.")) {
      errors.push("Token does not appear to be a valid Doppler token format");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

}
