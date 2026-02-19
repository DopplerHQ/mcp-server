import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
  const packagePath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
  return `mcp-v${packageJson.version}`;
}

const CLI_VERSION = getVersion();

export interface AuthCodeResponse {
  code: string;
  pollingCode: string;
  authUrl: string;
}

export type PollResult =
  | { pending: true }
  | {
      pending: false;
      token: string;
      name: string;
      dashboardUrl: string;
    };

export async function generateAuthCode(
  baseUrl: string = "https://api.doppler.com",
): Promise<AuthCodeResponse> {
  const hostname = os.hostname();
  const osType = process.platform;
  const arch = process.arch;

  const params = new URLSearchParams({
    hostname,
    version: CLI_VERSION,
    os: osType,
    arch,
    client_type: "mcp",
  });

  const url = `${baseUrl}/v3/auth/cli/generate/2?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `doppler-mcp-server/${CLI_VERSION}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to generate auth code: ${response.status} ${response.statusText} - ${text}`,
    );
  }

  const data = await response.json();

  return {
    code: data.code,
    pollingCode: data.polling_code,
    authUrl: data.auth_url,
  };
}

export async function pollForToken(
  pollingCode: string,
  baseUrl: string = "https://api.doppler.com",
): Promise<PollResult> {
  const url = `${baseUrl}/v3/auth/cli/authorize`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `doppler-mcp-server/${CLI_VERSION}`,
    },
    body: JSON.stringify({ code: pollingCode }),
  });

  if (response.status === 409) {
    return { pending: true };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to poll for token: ${response.status} ${response.statusText} - ${text}`,
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Authentication failed: ${data.error}`);
  }

  return {
    pending: false,
    token: data.token,
    name: data.name,
    dashboardUrl: data.dashboard_url,
  };
}

export class DeviceAuthState {
  public readonly code: string;
  public readonly pollingCode: string;
  public readonly authUrl: string;
  public readonly baseUrl: string;
  public readonly startedAt: Date;

  private _isAuthenticated: boolean = false;
  private _pollingInterval?: ReturnType<typeof setInterval>;

  constructor(authCodeResponse: AuthCodeResponse, baseUrl: string = "https://api.doppler.com") {
    this.code = authCodeResponse.code;
    this.pollingCode = authCodeResponse.pollingCode;
    this.authUrl = authCodeResponse.authUrl;
    this.baseUrl = baseUrl;
    this.startedAt = new Date();
  }

  private isTimedOut(): boolean {
    const timeoutMs = 5 * 60 * 1000;
    return Date.now() - this.startedAt.getTime() > timeoutMs;
  }

  private complete(): void {
    this._isAuthenticated = true;
    this.stopPolling();
  }

  startPolling(onAuthenticated: (result: { token: string; name: string }) => void): void {
    if (this._pollingInterval) {
      return;
    }

    const poll = async () => {
      if (this._isAuthenticated) {
        this.stopPolling();
        return;
      }

      if (this.isTimedOut()) {
        this.stopPolling();
        console.error("Authentication timed out after 5 minutes.");
        return;
      }

      try {
        const result = await pollForToken(this.pollingCode, this.baseUrl);
        if (!result.pending) {
          this.complete();
          onAuthenticated({ token: result.token, name: result.name });
        }
      } catch (error) {
        console.error(
          "Polling error:",
          error instanceof Error ? error.message : String(error)
        );
      }
    };

    poll();
    this._pollingInterval = setInterval(poll, 2000);
  }

  stopPolling(): void {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = undefined;
    }
  }
}
