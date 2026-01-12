/**
 * Implicit scope detection - enables better UX for scoped tokens where users
 * don't need to specify --project and --config explicitly if the token can
 * only access one of each.
 */

export type ScopeSource = "cli" | "token";

export interface ScopeOptions {
  project?: string;
  projectSource?: ScopeSource;
  config?: string;
  configSource?: ScopeSource;
}

export interface ScopeClient {
  listProjects(): Promise<Array<{ slug: string }>>;
  listConfigs(project: string): Promise<Array<{ name: string; slug: string }>>;
}

export interface ImplicitScope {
  project?: string;
  config?: string;
}

export interface CLIScopeArgs {
  project?: string;
  config?: string;
}

export async function detectImplicitScope(
  client: ScopeClient,
): Promise<ImplicitScope> {
  const scope: ImplicitScope = {};

  const projects = await client.listProjects();
  if (projects.length !== 1) {
    return scope;
  }

  scope.project = projects[0].slug;

  const configs = await client.listConfigs(scope.project);
  if (configs.length === 1) {
    scope.config = configs[0].name;
  }

  return scope;
}

/**
 * CLI args take precedence. If CLI provides a different project than detected,
 * the detected config is cleared (it was for a different project).
 */
export function mergeScope(
  detected: ImplicitScope,
  cliArgs: CLIScopeArgs,
): ImplicitScope {
  const effectiveProject = cliArgs.project ?? detected.project;

  const projectChanged =
    cliArgs.project !== undefined && cliArgs.project !== detected.project;

  let effectiveConfig: string | undefined;
  if (cliArgs.config !== undefined) {
    effectiveConfig = cliArgs.config;
  } else if (!projectChanged) {
    effectiveConfig = detected.config;
  }

  return {
    project: effectiveProject,
    config: effectiveConfig,
  };
}

export function validateScope(
  detected: ImplicitScope,
  cliArgs: CLIScopeArgs,
): void {
  if (cliArgs.config === undefined) {
    return;
  }

  const effectiveProject = cliArgs.project ?? detected.project;

  if (effectiveProject === undefined) {
    throw new Error(
      "--config requires --project (your token has access to multiple projects)",
    );
  }
}
