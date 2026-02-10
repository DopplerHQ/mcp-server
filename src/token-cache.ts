const KEYRING_SERVICE = "doppler-mcp-server";
const KEYRING_ACCOUNT = "token";

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

let keyringModule: KeyringModule | null = null;
let keyringLoadAttempted = false;

async function getKeyring(): Promise<KeyringModule | null> {
  if (keyringLoadAttempted) {
    return keyringModule;
  }
  keyringLoadAttempted = true;

  try {
    const moduleName = "@napi-rs/keyring";
    keyringModule = (await import(moduleName)) as KeyringModule;
    return keyringModule;
  } catch {
    return null;
  }
}

export interface CachedToken {
  token: string;
  apiHost: string;
}

export class TokenCache {
  async loadToken(): Promise<CachedToken | undefined> {
    const envToken = process.env.DOPPLER_TOKEN;
    if (envToken) {
      return {
        token: envToken,
        apiHost: process.env.DOPPLER_BASE_URL || "https://api.doppler.com",
      };
    }

    const keyring = await getKeyring();
    if (keyring) {
      try {
        const entry = new keyring.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
        const token = entry.getPassword();
        if (token) {
          return {
            token,
            apiHost: process.env.DOPPLER_BASE_URL || "https://api.doppler.com",
          };
        }
      } catch (error) {
        console.error(
          "Warning: Could not access system keyring:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return undefined;
  }

  async saveToken(token: string): Promise<void> {
    const keyring = await getKeyring();
    if (!keyring) {
      console.error(
        "Warning: System keyring not available. Token will not persist across sessions.",
      );
      return;
    }

    try {
      const entry = new keyring.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
      entry.setPassword(token);
    } catch (error) {
      console.error(
        "Warning: Could not save token to system keyring:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async clearToken(): Promise<void> {
    const keyring = await getKeyring();
    if (!keyring) {
      return;
    }

    try {
      const entry = new keyring.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
      entry.deletePassword();
    } catch {
    }
  }

  isFromEnvironment(): boolean {
    return !!process.env.DOPPLER_TOKEN;
  }
}
