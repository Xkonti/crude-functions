# Crude Functions

<div align="center">
![Crude Functions](https://raw.githubusercontent.com/Xkonti/crude-functions/main/docs/public/logo.svg)
[Documentation](https://crude-functions.xkonti.tech) | [GitHub Repository](https://github.com/Xkonti/crude-functions)
</div>

Crude Functions is a minimal, self-hosted serverless function platform that runs in a single Docker container. Write TypeScript functions, deploy them as HTTP endpoints, manage everything through a web UI or API. That's it.

**Philosophy:** Simple, pragmatic, and designed for internal use. No complex deployment pipelines, no sandboxing theater, no scaling nonsense. You want to run some functions on your network? Done.

**Target use case:** Internal network services with low-to-moderate traffic. Think internal APIs, webhooks, automation scripts, or small tools for your team.

🚨 ENTIRELY VIBE CODED INCLUDING THIS DOCUMENT 🚨

## Who Should Use This?

You should use Crude Functions if you:

- Want a simple way to deploy and manage serverless-style functions internally
- Trust the code you're running (no sandboxing - this is for internal use)
- Don't need massive scale or complex orchestration
- Want to avoid cloud vendor lock-in for internal tooling
- Value simplicity over enterprise features

You should NOT use this if you:

- Need to run untrusted code (no sandbox)
- Expect high traffic
- Want a production-ready public API platform
- Need multi-tenancy or advanced isolation

## Features

- **Minimal footprint:** Single Deno process, ~25MB RAM idle
- **Zero-downtime deploys:** Hot-reload functions without restarting the server
- **Simple function authoring:** Register a function by specifying handler file location
- **No build step:** Deno runs TypeScript directly
- **API-based deployment:** Programmatically add/update functions via HTTP
- Secrets management with multiple scopes to keep them out of your code.
- **Web UI:** Browser-based management interface
- **API key authentication:** Flexible key-based access control
- Encryption at rest for API keys and secrets

## Installation

### Prerequisites

- Docker and/or Docker Compose

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000
    volumes:
      # Database and encryption keys
      - ./data:/app/data
      # Your function code
      - ./code:/app/code
    restart: unless-stopped
```

Create directories and start:

```bash
mkdir -p data code
docker compose up -d
```

That's it. The server is running on `http://localhost:8000`.

**Image variants:**

- `standard` - Full Debian base with shell. Use this for debugging or if you need to exec into the container or execute shell commands from within your functions.
- `hardened` - Uses [Docker Hardened Image](https://dhi.io) - Near-zero CVEs, no shell, runs as non-root. Use this for production.

### Docker Run

```bash
mkdir -p data code
docker run -d \
  -p 8000:8000 \
  -v ./data:/app/data \
  -v ./code:/app/code \
  --name crude-functions \
  xkonti/crude-functions:latest-hardened
```

### First-Time Setup

On first run, Crude Functions will:

1. Create SQLite database at `./data/database.db`
2. Generate encryption keys at `./data/encryption-keys.json`
3. Enable the setup page for admin user creation

**Create your admin user:**

1. Navigate to the web interface: `http://localhost:8000/web`
2. Enter your email and password
3. Click "Create Account"

**Important:** The setup page is automatically disabled after the first user is created. If you need to add more users later, use the Users page in the web UI.

## Configuration

### Environment Variables

Crude Functions needs minimal configuration. Most settings are managed through the web UI.

**Optional environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8000` |
| `AUTH_BASE_URL` | Base URL for auth redirects | Auto-detected |

**When to set `AUTH_BASE_URL`:**

- Behind a reverse proxy with complex routing
- Auto-detection fails (rare)
- Format: `https://your-domain.com` or `http://localhost:8000`

**All other settings** (logging, metrics, encryption, API access) are configured via the web UI Settings page and stored in the database.

## Directory Structure

```
crude-functions/
├── data/
│   ├── database.db           # SQLite database (everything is here)
│   └── encryption-keys.json  # Auto-generated encryption keys
└── code/                     # Your function handlers (TypeScript files)
    ├── hello.ts              # Example function
    └── utils/                # Shared code (import with relative paths)
        └── helpers.ts
```

**Important:**

- `data/` - Keep this backed up. If you lose `encryption-keys.json`, you cannot decrypt secrets or API keys.
- `code/` - Your function code. Organize however you want. Use subdirectories, shared utilities, whatever works.

## Your First Function

Let's deploy a simple function.

### Step 1: Create the Handler File

Create `code/hello.ts`:

```typescript
export default async function (c, ctx) {
  return c.json({
    message: "Hello from Crude Functions!",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
  });
}
```

**What's happening:**

- `c` is the Hono context - use it for request/response handling
- `ctx` is the function context - contains request metadata, parameters, secrets, etc.

### Step 2: Register the Route

Navigate to `http://localhost:8000/web/functions` and:

1. Click "Add Function"
2. Fill in:
   - **Name:** `hello-world`
   - **Description:** "My first function"
   - **Handler:** `hello.ts` (path relative to `code/` directory)
   - **Route:** `/hello`
   - **Methods:** `GET`
   - **API Keys:** Leave empty for now (public access)
3. Click "Create"

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the function |
| `handler` | Yes | Path to TypeScript file in `code/` directory |
| `route` | Yes | URL path pattern (supports `:param` syntax) |
| `methods` | Yes | Array of HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) |
| `description` | No | Human-readable description |
| `keys` | No | Array of key groups required for access |

### Step 3: Test Your Function

```bash
curl http://localhost:8000/run/hello
```

You should see:

```json
{
  "message": "Hello from Crude Functions!",
  "timestamp": "2026-01-12T10:30:00.000Z",
  "requestId": "..."
}
```

**Hot reload:** Edit `code/hello.ts` and save. Changes take effect immediately - no restart needed.

For more details on writing function handlers, see [Writing Functions](.ai/02-writing-functions.md).

## Adding External Dependencies

Functions can import external packages using full specifiers:

```typescript
// NPM packages
import { camelCase } from "npm:lodash-es";
import { format } from "npm:date-fns";

// JSR packages
import { parse } from "jsr:@std/yaml";

// URLs
import { z } from "https://deno.land/x/zod/mod.ts";

// Local imports (relative paths)
import { greet } from "./utils/helpers.ts";

export default async function (c, ctx) {
  const name = camelCase("john doe");
  return c.json({ name });
}
```

**Note:** Deno downloads and caches dependencies on first import. This happens inside the container - no separate build step.

## API keys

API keys are organized into **groups** for access control and logical separation.

**Groups** are containers that hold multiple API keys. Each group has:

- A unique name (lowercase alphanumeric with dashes/underscores)
- Optional description
- One or more API keys

**Individual API keys** within a group have:

- A name (unique within the group)
- A value (the actual credential used in `X-API-Key` header)
- Optional description

### How Groups Are Used

**1. Protecting Functions**

When creating a function route, specify which key groups can access it:

```json
{
  "route": "/admin/users",
  "keys": ["admin", "backend-service"]
}
```

Only API keys from the `admin` or `backend-service` groups can execute this function. Other keys get a 403.

**2. Management API Access**

The `api.access-groups` setting (configurable in Settings page) controls which key groups can access `/api/*` endpoints. Default: only the built-in `management` group.

**3. Scoped Secrets**

Secrets can be scoped to a specific group. This lets different callers use different credentials:

- Global secret `DATABASE_URL` = `postgresql://shared-db`
- Group-scoped secret `DATABASE_URL` for group `mobile-app` = `postgresql://readonly-db`

When a function is called with an API key from `mobile-app`, it gets the readonly database URL. Other keys get the shared one.

### Creating Groups and Keys

1. Go to `http://localhost:8000/web/keys`
2. Create a group (e.g., `mobile-app`)
3. Add API keys to the group
4. Use those keys in function routes or for API access

**Built-in group:** The `management` group is created automatically and cannot be deleted. Use it for platform administration.

### Using Secrets

Store sensitive data (connection strings, API tokens) in Secrets. Depending on your needs there are 4 scopes of secrets:

- **Global** - Available to all functions
- **Function** - Specific to one function (by name)
- **Group** - Specific to an API key group
- **Key** - Specific to an API key ID

In most cases using the globally-scoped secrets is enough, but the additional scopes provide extra flexibility and security if needed. Scopes are hierarchical: key > group > function > global. More specific scopes override general ones. This makes it possible to change the value of a secret that the function handler will receive depending on which API key was used, etc.

1. Go to global secrets management page: `http://localhost:8000/web/secrets`
2. Add a secret (e.g., name: `DATABASE_URL`, scope: global)
3. Access in your function:

```typescript
export default async function (c, ctx) {
  const dbUrl = await ctx.getSecret("DATABASE_URL");

  if (!dbUrl) {
    return c.json({ error: "Database URL not configured" }, 500);
  }

  // Use dbUrl to connect...
  return c.json({ status: "connected" });
}
```

## API Endpoints

Crude Functions provides a comprehensive REST API for programmatic management.

**Authentication:**

- All `/api/*` endpoints require authentication via session cookie (web UI) OR `X-API-Key` header
- The `X-API-Key` must belong to an authorized group (configurable in Settings, default: `management` group)
- Exception: `/api/auth/*` (handles own auth)

**Base URL:** `http://localhost:8000` (adjust for your deployment)

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/auth/*` | Better Auth endpoints for login, signup, sessions |

Better Auth handles authentication flows. See [Better Auth documentation](https://www.better-auth.com/docs) for details.

**Note:** The `/web` UI uses session authentication. Management endpoints (`/api/*`) accept either session cookies OR the `X-API-Key` header.

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

## Docker Deployment

### Image Variants

Two image variants are available:

- `standard` - Full Debian base with shell. Use this for debugging or if you need to exec into the container or execute shell commands from within your functions.
- `hardened` - Uses [Docker Hardened Image](https://dhi.io) - Near-zero CVEs, no shell, runs as non-root. Use this for production.

**Hardened variant** (default in examples):

- Near-zero CVEs, minimal attack surface
- SLSA Level 3 provenance, signed SBOM
- No shell or package manager
- Runs as non-root user

**Hardened image limitations for function handlers:**

- ❌ Shell commands (`Deno.Command()`, subprocess spawning) will fail
- ❌ NPM packages with native bindings or lifecycle scripts won't work
- ❌ Direct FFI access to system libraries (libc, libm, etc.) mostly unavailable
- ✅ Pure TypeScript/JavaScript, JSR packages, and most NPM packages work fine

**Standard variant**:

- Full Debian base with shell access
- Easier debugging in production
- Use when you need to exec into container

To switch variants, change the image tag:

```yaml
image: xkonti/crude-functions:latest      # Standard
image: xkonti/crude-functions:latest-hardened    # Hardened (recommended)
```

These images follow the semver conventions and one can specify more specific versions of the image, for example:

- `:0.4.3`/`:0.4.3-hardened`
- `:0.4`/`:0.4-hardened`
- `:0`/`:0-hardened`

## Security Considerations

- This is designed for **internal network use** with trusted code
- No sandboxing - functions have full Deno permissions
- Basic process isolation prevents obvious _oopsies_ and doesn't provide any real security
- Environment isolation provides handlers with empty `Deno.env` and `process.env` - these can be populated within each function execution if needed
- API keys and secrets are encrypted with AES-256-GCM
- Encryption keys are auto-generated and stored in `./data/encryption-keys.json`
- Automatic key rotation with configurable intervals
- Use behind a reverse proxy for TLS termination
- **Important:** Keep `./data/encryption-keys.json` backed up and secure - loss means encrypted data cannot be recovered

## Development

```bash
# Run with hot reload
deno task dev

# Run tests
deno task test

# Build the standard container image locally
docker build -t crude-functions:test .

# Build the hardened container image locally
docker build --build-arg BASE_IMAGE=dhi.io/deno:2 -t crude-functions:test-hardened .

# Run the local container without persisting

```

## License

MIT
