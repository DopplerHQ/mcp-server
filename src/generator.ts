import { DopplerTool, Parameter } from "./types.js";
import { DopplerClient, APIError } from "./client.js";
import { type ScopeOptions } from "./scope.js";
import { ScopeViolationError } from "./errors.js";

export class ToolGenerator {
  private client: DopplerClient;
  private scope?: ScopeOptions;

  constructor(client: DopplerClient, scope?: ScopeOptions) {
    this.client = client;
    this.scope = scope;
  }

  public generateTools(dopplerTools: DopplerTool[]): any[] {
    return dopplerTools.map((dopplerTool) => this.createMCPTool(dopplerTool));
  }

  private createMCPTool(dopplerTool: DopplerTool): any {
    return {
      name: dopplerTool.name,
      description: dopplerTool.description,
      parameters: dopplerTool.inputSchema,
      execute: async (input: any) => {
        try {
          const result = await this.executeTool(dopplerTool, input);
          return this.formatResponse(result);
        } catch (error) {
          if (error instanceof ScopeViolationError) {
            throw error;
          }
          const apiError = error as APIError;
          throw new Error(this.formatError(apiError));
        }
      },
    };
  }

  private async executeTool(tool: DopplerTool, input: any): Promise<any> {
    if (
      this.scope?.project &&
      input.project &&
      input.project !== this.scope.project
    ) {
      const message =
        this.scope.projectSource === "token"
          ? `Project scope violation: Your token only has access to project "${this.scope.project}", ` +
            `but the request targets project "${input.project}".`
          : `Project scope violation: This server is configured for project "${this.scope.project}" ` +
            `but the request targets project "${input.project}". ` +
            `Remove the project parameter to use the configured project, or reconfigure the server.`;
      throw new ScopeViolationError(message);
    }

    if (
      this.scope?.config &&
      input.config &&
      input.config !== this.scope.config
    ) {
      const message =
        this.scope.configSource === "token"
          ? `Config scope violation: Your token only has access to config "${this.scope.config}", ` +
            `but the request targets config "${input.config}".`
          : `Config scope violation: This server is configured for config "${this.scope.config}" ` +
            `but the request targets config "${input.config}". ` +
            `Remove the config parameter to use the configured config, or reconfigure the server.`;
      throw new ScopeViolationError(message);
    }

    if (this.scope?.config && tool.parameters) {
      const configParam = tool.parameters.find((p) => p.name === "config");
      if (configParam && !input.config) {
        input.config = this.scope.config;
      }
    }

    if (this.scope?.project && tool.parameters) {
      const projectParam = tool.parameters.find((p) => p.name === "project");
      if (projectParam && !input.project) {
        input.project = this.scope.project;
      }
    }

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const bodyData: Record<string, any> = {};

    if (tool.parameters) {
      for (const param of tool.parameters) {
        if (input[param.name] !== undefined) {
          if (param.in === "path") {
            pathParams[param.name] = input[param.name];
          } else if (param.in === "query") {
            queryParams[param.name] = input[param.name];
          }
        }
      }
    }

    if (tool.requestBody) {
      const contentType = Object.keys(tool.requestBody.content)[0];
      if (contentType === "application/json") {
        // Include all input properties that aren't path/query params
        // This allows arbitrary properties (like custom secret names) to pass through
        for (const [key, value] of Object.entries(input)) {
          const isPathOrQueryParam = key in pathParams || key in queryParams;
          if (!isPathOrQueryParam && value !== undefined) {
            bodyData[key] = value;
          }
        }
      }
    }

    let endpoint = tool.endpoint;
    for (const [key, value] of Object.entries(pathParams)) {
      endpoint = endpoint.replace(`{${key}}`, encodeURIComponent(value));
    }

    return await this.client.makeRequest({
      method: tool.method,
      endpoint,
      queryParams,
      body: Object.keys(bodyData).length > 0 ? bodyData : undefined,
    });
  }

  private formatResponse(response: any): string {
    if (typeof response === "object") {
      return JSON.stringify(response, null, 2);
    }
    return String(response);
  }

  private formatError(error: APIError): string {
    return `Error ${error.statusCode}: ${error.message}\n\nDetails: ${error.error}`;
  }
}
