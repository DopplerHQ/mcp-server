# Doppler MCP Server

MCP (Model Context Protocol) server that provides AI assistants with access to the Doppler API for secrets management.

## Quick Start

**1. Authenticate:**

```bash
npx @dopplerhq/mcp-server login
```

**2. Add to your MCP client configuration (e.g., Claude Desktop):**

```json
{
  "mcpServers": {
    "doppler": {
      "command": "npx",
      "args": ["-y", "@dopplerhq/mcp-server"]
    }
  }
}
```

### With Service Token

Alternatively, use a service token instead of logging in:

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

See [Service Tokens](https://docs.doppler.com/docs/service-tokens) to create a config-scoped token.

## Commands

```
login              Authenticate with Doppler (interactive)
logout             Clear cached auth credentials
```

## Options

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
      "args": ["-y", "@dopplerhq/mcp-server", "--read-only"]
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
      "args": ["-y", "@dopplerhq/mcp-server", "--project", "my-app"]
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
      ]
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

## Branch and Release Flow

New work should branch from main and target main in PRs.

To release, push a tag in the format `vX.X.X` following semantic versioning. This triggers the publish workflow which builds and publishes to NPM.
