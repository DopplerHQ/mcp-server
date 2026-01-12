import { AuthManager } from "./auth.js";
import { APIError } from "./errors.js";

export { APIError };

export interface RequestOptions {
  method: string;
  endpoint: string;
  queryParams?: Record<string, string>;
  body?: any;
}

export class DopplerClient {
  private authManager: AuthManager;
  private baseUrl: string;

  constructor() {
    this.authManager = new AuthManager();
    this.baseUrl = this.authManager.getBaseUrl();
  }

  public async makeRequest(options: RequestOptions): Promise<any> {
    const { method, endpoint, queryParams, body } = options;

    let url = `${this.baseUrl}${endpoint}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      url += `?${searchParams.toString()}`;
    }

    const requestOptions: RequestInit = {
      method,
      headers: this.authManager.getAuthHeaders(),
    };

    if (body && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        throw await this.handleErrorResponse(response);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        return text || { success: true };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        throw error;
      }

      throw new APIError(
        "Network or request error",
        error instanceof Error ? error.message : "Unknown error occurred",
        0,
      );
    }
  }

  private async handleErrorResponse(response: Response): Promise<APIError> {
    let errorMessage = `HTTP ${response.status} ${response.statusText}`;
    let errorDetails = errorMessage;

    try {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();

        if (errorData.messages && Array.isArray(errorData.messages)) {
          errorMessage = errorData.messages.join(", ");
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }

        errorDetails = JSON.stringify(errorData, null, 2);
      } else {
        errorDetails = await response.text();
      }
    } catch {
      errorDetails = `Failed to parse error response: ${response.statusText}`;
    }

    return new APIError(errorDetails, errorMessage, response.status);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.makeRequest({
        method: "GET",
        endpoint: "/v3/workplace",
      });
      return { success: true };
    } catch (error) {
      const apiError = error as APIError;
      return {
        success: false,
        error: `Connection test failed: ${apiError.message} (Status: ${apiError.statusCode})`,
      };
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async listProjects(): Promise<Array<{ slug: string }>> {
    const response = await this.makeRequest({
      method: "GET",
      endpoint: "/v3/projects",
    });
    return response.projects ?? [];
  }

  public async listConfigs(
    project: string,
  ): Promise<Array<{ name: string; slug: string }>> {
    const response = await this.makeRequest({
      method: "GET",
      endpoint: "/v3/configs",
      queryParams: { project },
    });
    return response.configs ?? [];
  }
}
