---
title: API Endpoints
description: Documentation of all available API endpoints
---

Crude Functions provides a comprehensive REST API for programmatic management.

## Ports

By default, endpoints are split across two ports:

| Port | Default | Endpoints | Purpose |
|------|---------|-----------|---------|
| `FUNCTION_PORT` | 8000 | `/run/*` | Function execution (public) |
| `MANAGEMENT_PORT` | 9000 | `/api/*`, `/web/*` | Management API and Web UI |

When both ports are set to the same value, all endpoints run on a single port. See [Deployment](/guides/deployment/#port-configuration) for configuration options.

## Authentication

- All `/api/*` endpoints require authentication via session cookie (web UI) OR `X-API-Key` header
- The `X-API-Key` must belong to an authorized group (configurable in Settings, `management` by default)
- The `/run/*` endpoints use per-function API key requirements (configured when creating functions)

:::note
The examples below use `localhost:9000` (management port). If running in single-port mode, use port 8000 instead.
:::

## Management API

### Functions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/functions` | List all functions |
| GET | `/api/functions/:id` | Get a function by ID |
| POST | `/api/functions` | Create a new function |
| PUT | `/api/functions/:id` | Update a function |
| DELETE | `/api/functions/:id` | Delete a function |
| PUT | `/api/functions/:id/enable` | Enable a function |
| PUT | `/api/functions/:id/disable` | Disable a function |

#### CORS Configuration

Functions can include optional CORS configuration for browser cross-origin requests:

| Field | Type | Description |
|-------|------|-------------|
| `cors.origins` | `string[]` | Required. Allowed origins, e.g., `["https://app.example.com"]` or `["*"]` |
| `cors.credentials` | `boolean` | Optional. Allow credentials (cookies, auth headers). Cannot be `true` with `"*"` |
| `cors.maxAge` | `number` | Optional. Preflight cache duration in seconds (default: 86400) |
| `cors.allowHeaders` | `string[]` | Optional. Additional headers client can send |
| `cors.exposeHeaders` | `string[]` | Optional. Headers client can read from response |

See the [CORS Guide](/guides/cors) for detailed configuration examples and troubleshooting.

**Creating a function with CORS:**

```bash
curl -X POST http://localhost:9000/api/functions \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "handler": "my-functions/api.ts",
    "route": "/api/data",
    "methods": ["GET", "POST", "OPTIONS"],
    "cors": {
      "origins": ["https://app.example.com"],
      "credentials": true,
      "maxAge": 86400
    }
  }'
```

### Code Sources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sources` | List all code sources |
| GET | `/api/sources/:id` | Get source by ID |
| GET | `/api/sources/by-name/:name` | Get source by name |
| POST | `/api/sources` | Create a new code source |
| PUT | `/api/sources/:id` | Update source configuration |
| DELETE | `/api/sources/:id` | Delete source and directory |
| POST | `/api/sources/:id/sync` | Trigger manual sync (git sources) |
| GET | `/api/sources/:id/status` | Get sync status |
| POST | `/api/sources/:id/webhook` | Webhook trigger endpoint |

**Creating a manual source:**

```bash
curl -X POST http://localhost:9000/api/sources \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "type": "manual",
    "enabled": true
  }'
```

**Creating a git source:**

```bash
curl -X POST http://localhost:9000/api/sources \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-api",
    "type": "git",
    "typeSettings": {
      "url": "https://github.com/yourorg/repo.git",
      "branch": "main",
      "authToken": "ghp_xxxx"
    },
    "syncSettings": {
      "intervalSeconds": 300,
      "webhookEnabled": true,
      "webhookSecret": "secure-random-string"
    }
  }'
```

**Notes:**

- Setting `syncSettings.intervalSeconds` to `0` disables the interval sync.

### Code Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sources/:id/files` | List files in a source |
| GET | `/api/sources/:id/files/:path` | Get file content |
| PUT | `/api/sources/:id/files/:path` | Create/update file (manual sources only) |
| DELETE | `/api/sources/:id/files/:path` | Delete file (manual sources only) |

**Notes:**

- `:id` is the source ID (auto-generated), not the source name
- File paths are URL-encoded (use `%2F` for nested paths)
- File operations require source to exist
- Write operations only work on manual sources (git sources are read-only)
- GET supports content negotiation - use `Accept: application/json` for JSON envelope with metadata
- PUT returns 201 (created) or 200 (updated)
- Returns 413 if file exceeds configured max size (default 50 MB)
- Returns 403 if attempting to write to non-editable source

**Upload formats (PUT):**

```bash
# First, get the source ID (either from creation response or by listing sources)
SOURCE_ID="abc123xyz"  # Replace with actual source ID

# JSON body
curl -X PUT -H "X-API-Key: key" -H "Content-Type: application/json" \
  -d '{"content": "file contents", "encoding": "utf-8"}' \
  http://localhost:9000/api/sources/$SOURCE_ID/files/example.ts

# Multipart form-data
curl -X PUT -H "X-API-Key: key" \
  -F "file=@local-file.ts" \
  http://localhost:9000/api/sources/$SOURCE_ID/files/example.ts

# Raw binary
curl -X PUT -H "X-API-Key: key" -H "Content-Type: application/octet-stream" \
  --data-binary @local-file.bin \
  http://localhost:9000/api/sources/$SOURCE_ID/files/binary.bin
```

### API Key Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/key-groups` | List all API key groups |
| GET | `/api/key-groups/:groupId` | Get a specific group by ID |
| POST | `/api/key-groups` | Create a new API key group |
| PUT | `/api/key-groups/:groupId` | Update a group's description |
| DELETE | `/api/key-groups/:groupId` | Delete an empty group |

**Note:** The `management` group cannot be deleted. Groups must be empty before deletion.

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/keys` | List all API keys (optional ?groupId filter) |
| GET | `/api/keys/:keyId` | Get a specific API key by ID |
| POST | `/api/keys` | Create a new API key |
| PUT | `/api/keys/:keyId` | Update an API key |
| DELETE | `/api/keys/:keyId` | Delete an API key |

### Secrets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/secrets` | List all secrets (with optional filtering) |
| GET | `/api/secrets/:id` | Get a secret by ID |
| GET | `/api/secrets/by-name/:name` | Search secrets by name |
| POST | `/api/secrets` | Create a new secret |
| PUT | `/api/secrets/:id` | Update a secret |
| DELETE | `/api/secrets/:id` | Delete a secret |

**Query parameters for listing:**

- `scope` - Filter by scope (global, function, group, key)
- `functionId` - Filter by function ID
- `groupId` - Filter by key group ID
- `keyId` - Filter by API key ID
- `includeValues=true` - Include decrypted values (default: false)

**Creating a secret:**

```bash
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DATABASE_URL",
    "value": "postgresql://...",
    "scope": "global",
    "comment": "Main database connection"
  }' \
  http://localhost:9000/api/secrets
```

**Scopes:** Secrets support hierarchical scopes (key > group > function > global). More specific scopes override general ones.

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:id` | Get a user by ID |
| POST | `/api/users` | Create a new user |
| PUT | `/api/users/:id` | Update a user (password) |
| DELETE | `/api/users/:id` | Delete a user |

**Note:** Cannot delete your own account. The first user created has special administrative privileges.

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Query logs with pagination and filtering |
| DELETE | `/api/logs/:functionId` | Delete all logs for a function |

**Query parameters:**

- `functionId` - Filter by function ID (omit for all functions)
- `level` - Filter by log level (comma-separated: log, debug, info, warn, error, trace, stdout, stderr, exec_start, exec_end, exec_reject)
- `limit` - Results per page (1-1000, default: 50)
- `cursor` - Pagination cursor from previous response

**Response includes pagination:**

```json
{
  "data": {
    "logs": [...],
    "pagination": {
      "limit": 50,
      "hasMore": true,
      "next": "/api/logs?limit=50&cursor=..."
    }
  }
}
```

### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/metrics` | Query aggregated execution metrics |

**Required query parameter:**

- `resolution` - Time resolution: `minutes` (last 60), `hours` (last 24), or `days` (configurable retention)

**Optional query parameter:**

- `functionId` - Filter by function ID (omit for global metrics)

**Example:**

```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:9000/api/metrics?resolution=hours&functionId=1"
```

Returns time-series data with execution counts, avg/max execution times, and summary statistics.

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get all settings (global + user if authenticated) |
| PUT | `/api/settings` | Update multiple settings atomically |

**Updating settings:**

```bash
curl -X PUT \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.level": "info",
      "metrics.retention-days": "30"
    }
  }' \
  http://localhost:9000/api/settings
```

Settings are managed through the web UI. See the Settings page for available options.

### Encryption Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/encryption-keys/rotation` | Get key rotation status |
| POST | `/api/encryption-keys/rotation` | Manually trigger key rotation |

**Rotation status includes:**

- Last rotation timestamp
- Days since last rotation
- Next scheduled rotation
- Current key version
- Whether rotation is in progress

**Manual rotation:** Re-encrypts all secrets, API keys, and settings. Can take time with large datasets.

## Function Execution

Functions are executed via the `/run` prefix on the **function port** (default: 8000):

```bash
# Call a function at /hello
curl http://localhost:8000/run/hello

# With API key (if function requires it)
curl -H "X-API-Key: your-api-key" http://localhost:8000/run/users/123

# POST with body
curl -X POST -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "John"}' \
  http://localhost:8000/run/users

# API key in query param (avoid in production)
curl http://localhost:8000/run/hello?api_key=your-api-key
```

**Note:** The function port is separate from the management port by default. This allows you to expose only function endpoints to the public internet while keeping management endpoints internal.
