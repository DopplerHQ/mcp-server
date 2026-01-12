# Doppler MCP Server

MCP (Model Context Protocol) server that provides AI assistants with access to the Doppler API for secrets management.

## Quick Start

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server"],
      "env": {
        "DOPPLER_TOKEN": "<your-doppler-token>"
      }
    }
  }
}
```

See [Service Tokens](https://docs.doppler.com/docs/service-tokens) to create a token.

### Alternative: CLI Authentication (No Token in Config)

If you have the [Doppler CLI](https://docs.doppler.com/docs/cli) installed, you can use your CLI session instead of a service token. This keeps credentials out of your config file entirely.

**Prerequisites:**

1. Install the Doppler CLI
2. Run `doppler login` (creates a global/root session stored in your OS keychain)
3. Create a Doppler project to store your `DOPPLER_TOKEN` for the MCP server

**Configuration:**

```json
{
  "mcpServers": {
    "doppler": {
      "command": "doppler",
      "args": [
        "run",
        "--project",
        "mcp-server-tokens",
        "--config",
        "dev",
        "--",
        "npx",
        "-y",
        "@dopplerhq/mcp-server",
        "--project",
        "my-app",
        "--read-only"
      ]
    }
  }
}
```

**How it works:**

- `doppler run --project mcp-server-tokens --config dev` fetches secrets (including `DOPPLER_TOKEN`) from the specified Doppler project and injects them as environment variables
- The MCP server receives `DOPPLER_TOKEN` and uses it to access the Doppler API
- `--project my-app --read-only` on the MCP server scopes what the LLM can access

**Two levels of scoping:**

| Level                            | Controls                              | Example                                                    |
| -------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `doppler run --project/--config` | Which token the MCP server uses       | `mcp-server-tokens/dev` contains `DOPPLER_TOKEN=dp.st.xxx` |
| MCP server `--project/--config`  | What the LLM can access via the token | Restrict to `my-app/production`                            |

This pattern is ideal for local development where you don't want any tokens in config files.

## CLI Options

```
--read-only        Only expose read operations (GET endpoints)
--project <name>   Override auto-detected project
--config <name>    Override auto-detected config
--verbose, -v      Enable verbose logging to stderr
-h, --help         Show help message
```

### Examples

**Read-only mode**

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server", "--read-only"],
      "env": { "DOPPLER_TOKEN": "dp.pt.xxx" }
    }
  }
}
```

**Restrict to a specific project**:

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server", "--project", "my-app"],
      "env": { "DOPPLER_TOKEN": "dp.pt.xxx" }
    }
  }
}
```

**Restrict to a specific config**:

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": [
        "-y",
        "@dopplerhq/mcp-server",
        "--project",
        "my-app",
        "--config",
        "production"
      ],
      "env": { "DOPPLER_TOKEN": "dp.pt.xxx" }
    }
  }
}
```

## Implicit Scope Detection

The server automatically detects scope based on your token's access:

| Token Access                   | Auto-Detected Scope                          |
| ------------------------------ | -------------------------------------------- |
| Single project                 | `--project` set automatically                |
| Single project + single config | `--project` and `--config` set automatically |
| Multiple projects              | No auto-detection (use CLI flags)            |

This means **scoped service tokens work out of the box** without any CLI flags:

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server", "--read-only"],
      "env": {
        "DOPPLER_TOKEN": "dp.st.xxx"
      }
    }
  }
}
```

CLI flags always take precedence over auto-detected values.

## Security Best Practices

**Use scoped service tokens, not CLI flags, for access control.** The `--project` and `--config` flags provide a convenient UX layer but are not a substitute for proper token scoping. Always create service tokens with the minimum required permissions:

1. **Scope tokens to specific projects** in the Doppler dashboard
2. **Use read-only tokens** when write access isn't needed
3. **Combine read-only tokens with `--read-only`** for defense in depth:

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server", "--read-only"],
      "env": {
        "DOPPLER_TOKEN": "dp.st.readonly_token"
      }
    }
  }
}
```

Note: The server cannot determine read/write permissions from the token, so if you're using a read-only token, add `--read-only` to only expose read tools. This prevents write tools from appearing in Claude's tool list and avoids failed API calls.

## Available Tools

The server auto-generates tools from the [Doppler OpenAPI spec](https://docs.doppler.com/reference/api). The tools available depend on your flags:

### No flags (full access)

All Doppler API tools including:

- **Workplace**: `workplace_get`, `workplace_update`
- **Users & Groups**: `users_list`, `groups_list`, `service_accounts_list`
- **Projects**: `projects_list`, `projects_create`, `projects_get`, `projects_delete`
- **Environments**: `environments_list`, `environments_create`, `environments_get`
- **Configs**: `configs_list`, `configs_create`, `configs_get`, `configs_update`, `configs_lock`
- **Secrets**: `secrets_list`, `secrets_get`, `secrets_update`, `secrets_download`
- **Integrations**: `integrations_list`, `syncs_list`, `webhooks_list`

### With `--read-only`

Read-only tools only (GET operations). Write operations like `_create`, `_update`, `_delete` are not exposed.

### With `--project`

Org-level tools are filtered out (`workplace_*`, `activity_logs_*`). The `project` parameter is auto-injected into tool calls that accept it.

### With `--config`

Only config and secret management tools:

- `configs_get`, `configs_update`, `configs_lock`, `configs_unlock`
- `secrets_list`, `secrets_get`, `secrets_update`, `secrets_download`
- `config_logs_list`, `config_logs_rollback`

Both `project` and `config` parameters are auto-injected.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm run build

# Run locally
DOPPLER_TOKEN=dp.xxx pnpm start
```
