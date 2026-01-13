---
title: API Endpoints
description: Documentation of all available API endpoints
---

Crude Functions provides a comprehensive REST API for programmatic management.

**Authentication:**

- All `/api/*` endpoints require authentication via session cookie (web UI) OR `X-API-Key` header
- The `X-API-Key` must belong to an authorized group (configurable in Settings, `management` by default)

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

### Code Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List all files in code directory |
| GET | `/api/files/:path` | Get file content |
| POST | `/api/files/:path` | Create a new file |
| PUT | `/api/files/:path` | Create or update a file |
| DELETE | `/api/files/:path` | Delete a file |

**Note:** File paths are URL-encoded. The GET endpoint supports content negotiation - use `Accept: application/json` for JSON envelope response with metadata.

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
  http://localhost:8000/api/secrets
```

**Scopes:** Secrets support hierarchical scopes (key > group > function > global). More specific scopes override general ones.

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:id` | Get a user by ID |
| POST | `/api/users` | Create a new user |
| PUT | `/api/users/:id` | Update a user (password, roles) |
| DELETE | `/api/users/:id` | Delete a user |

**Note:** Cannot delete your own account. First user created has permanent admin access.

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Query logs with pagination and filtering |
| DELETE | `/api/logs/:functionId` | Delete all logs for a function |

**Query parameters:**

- `functionId` - Filter by function ID (omit for all functions)
- `level` - Filter by log level (comma-separated: log, debug, info, warn, error, trace)
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
  "http://localhost:8000/api/metrics?resolution=hours&functionId=1"
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
  http://localhost:8000/api/settings
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

### Function Execution

Functions are executed via the `/run` prefix:

```bash
# Call a function at /hello
curl http://localhost:8000/run/hello

# With API key
curl -H "X-API-Key: your-api-key" http://localhost:8000/run/users/123

# POST with body
curl -X POST -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "John"}' \
  http://localhost:8000/run/users

# API key in query param (avoid)
curl http://localhost:8000/run/hello?api_key=your-api-key
```
