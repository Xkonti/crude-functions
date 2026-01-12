# Crude Functions

A minimal, single-container serverless-style function router built on Deno. Functions are TypeScript files that get dynamically loaded and executed as HTTP endpoints.

**Target use case:** Internal network services with low-to-moderate traffic (~5-50 req/s).

🚨 ENTIRELY VIBE CODED INCLUDING THIS DOCUMENT 🚨

## Features

- **Minimal footprint:** Single Deno process, ~15-30MB RAM idle
- **Zero-downtime deploys:** Hot-reload functions without restarting the server
- **Simple function authoring:** Register a function by specifying handler file location
- **No build step:** Deno runs TypeScript directly
- **API-based deployment:** Programmatically add/update functions via HTTP
- **Web UI:** Browser-based management interface
- **API key authentication:** Flexible key-based access control

## Quick Start

### Prerequisites

- [Deno](https://deno.land/) v2.0+

### Running Locally

```bash
# Clone the repository
git clone <repo-url>
cd crude-functions

# Run the server
deno task dev
```

The server starts on port 8000 by default. The database is automatically created at `./data/database.db` on first run.

**First-time setup:** Navigate to `http://localhost:8000/web/setup` to create your first admin user. After setup, you can create API keys via the API Keys page in the web UI.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8000` |
| `BETTER_AUTH_BASE_URL` | Base URL for redirects and callbacks (optional, auto-detected if not set) | Auto-detected |

**Note:** Most settings (log level, metrics, encryption, API access groups) are configured via the web UI Settings page and stored in the database. Encryption keys are auto-generated on first startup and stored in `./data/encryption-keys.json`.

### Directory Structure

```
crude-functions/
├── data/
│   ├── database.db           # SQLite database (routes, keys, users, secrets, logs, metrics)
│   └── encryption-keys.json  # Auto-generated encryption keys (created on first run)
├── code/                     # Your function handlers
│   └── *.ts
├── migrations/               # Database schema migrations
└── main.ts
```

### API Keys

API keys are stored in the SQLite database and managed via the API or Web UI.

- **Key groups:** lowercase `a-z`, `0-9`, `_`, `-`
- **Key values:** `a-z`, `A-Z`, `0-9`, `_`, `-`
- **Descriptions:** Optional metadata for each key

The `management` key group is created automatically on first startup and grants access to management endpoints (API). Add keys to this group via the Web UI after creating your first admin user. You can configure which groups have API access via the Settings page.

### Function Routes

Routes are stored in the SQLite database and managed via the API or Web UI. Each route defines:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the function |
| `handler` | Yes | Path to TypeScript file in `code/` directory |
| `route` | Yes | URL path pattern (supports `:param` syntax) |
| `methods` | Yes | Array of HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) |
| `description` | No | Human-readable description |
| `keys` | No | Array of key groups required for access |

Example route (via API):

```json
{
  "name": "hello-world",
  "description": "A simple greeting endpoint",
  "handler": "hello.ts",
  "route": "/hello",
  "methods": ["GET"],
  "keys": ["api"]
}
```

## Writing Function Handlers

Create TypeScript files in the `code/` directory. Each handler exports a default function that receives a Hono context (`c`) and function context (`ctx`):

```typescript
// code/hello.ts
// Import other files from code/ using relative paths
import { greet } from "./utils/greetings.ts";

// Import external packages using full specifiers (npm:, jsr:, or URLs)
import { camelCase } from "npm:lodash-es";

export default async function (c, ctx) {
  return c.json({
    message: camelCase(greet("world")),
    params: ctx.params,
    query: ctx.query,
  });
}
```

### Function Context (`ctx`)

| Property | Type | Description |
|----------|------|-------------|
| `ctx.params` | `Record<string, string>` | Path parameters (e.g., `{ id: "123" }`) |
| `ctx.query` | `Record<string, string>` | Query string parameters |
| `ctx.requestId` | `string` | Unique request ID for tracing |
| `ctx.requestedAt` | `Date` | Request timestamp |
| `ctx.authenticatedKeyGroup` | `string?` | API key group used (if route requires auth) |
| `ctx.route` | `RouteInfo` | Route configuration (name, handler, methods, etc.) |
| `ctx.getSecret(name, scope?)` | `Promise<string \| undefined>` | Get secret value with hierarchical resolution (key > group > function > global) |
| `ctx.getCompleteSecret(name)` | `Promise<CompleteSecret \| undefined>` | Get secret with all scope values |

**Secrets:** Functions can access encrypted secrets scoped to key, group, function, or global levels. See [function_handler_design.md](./function_handler_design.md) for details.

### Hono Context (`c`)

Use `c` for request/response handling:

```typescript
// Read request
const body = await c.req.json();
const header = c.req.header("Authorization");

// Send response
return c.json({ data }, 200);
return c.text("Hello");
return c.redirect("/other");
```

For detailed documentation on writing handlers, see [function_handler_design.md](./function_handler_design.md).

## API Endpoints

All management endpoints require authentication via session (Web UI) or the `X-API-Key` header with a key from an authorized access group (configurable in Settings).

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
| GET | `/api/files/content?path=...` | Get file content |
| POST | `/api/files` | Create or update a file |
| DELETE | `/api/files` | Delete a file |

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/keys` | List all key groups |
| GET | `/api/keys/:group` | Get keys for a group |
| POST | `/api/keys/:group` | Add a new key |
| DELETE | `/api/keys/:group` | Delete all keys for a group |
| DELETE | `/api/keys/by-id/:id` | Delete a key by ID |

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
```

## Web UI

Access the management interface at `/web`.

**First-time setup:** Navigate to `/web/setup` to create your first user account. Sign-up is automatically disabled after the first user is created.

**Authentication:** After setup, log in with your email and password. Sessions are valid for 7 days.

### Pages

- `/web` - Dashboard with links to all sections
- `/web/code` - Manage code files (upload, edit, delete)
- `/web/functions` - Manage function routes and view execution logs/metrics
- `/web/keys` - Manage API key groups and keys
- `/web/secrets` - Manage encrypted secrets (global, function, group, key scopes)
- `/web/users` - Manage user accounts and roles

## Development

```bash
# Run with hot reload
deno task dev

# Run tests
deno task test
```

## Docker Deployment

### Image Variants

Two image variants are available:

| Variant | Image Tag | Base | Use Case |
|---------|-----------|------|----------|
| **Hardened** | `hardened`, `x.y.z-hardened` | `dhi.io/deno:2` | Production (recommended) |
| **Standard** | `latest`, `x.y.z` | `denoland/deno` | Development, debugging |

**Hardened variant** (default in examples):
- Near-zero CVEs, minimal attack surface
- SLSA Level 3 provenance, signed SBOM
- No shell or package manager
- Runs as non-root user

**Standard variant**:
- Full Debian base with shell access
- Easier debugging in production
- Use when you need to exec into container

To switch variants, change the image tag:
```yaml
image: xkonti/crude-functions:latest      # Standard
image: xkonti/crude-functions:hardened    # Hardened (recommended)
```

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  app:
    # Hardened image (recommended): near-zero CVEs, no shell
    # For debugging, use: xkonti/crude-functions:latest
    image: xkonti/crude-functions:hardened
    ports:
      - 8000:8000
    # Environment variables (optional)
    # environment:
    #   # Better Auth configuration
    #   # Auto-detects from request headers if not set
    #   # Set explicitly when behind reverse proxy: https://your-domain.com
    #   - BETTER_AUTH_BASE_URL=http://localhost:8000
    #
    # Note: All settings (log level, metrics, encryption, API access groups)
    # are configured via the web UI Settings page and stored in the database.
    # On first run, create an admin user via the web UI setup page,
    # then manage API keys through the API Keys page.
    volumes:
      # Mount the data directory for SQLite database and encryption keys
      - ./data:/app/data
      # Mount the code directory for function handlers
      - ./code:/app/code
    restart: unless-stopped
```

Create your directories and start:

```bash
mkdir -p data code
docker compose up -d
```

**Optional:** Set `BETTER_AUTH_BASE_URL` if deploying behind a reverse proxy with complex routing. Otherwise, it will auto-detect from incoming requests.

On first run:
- Database is created at `./data/database.db`
- Encryption keys are generated at `./data/encryption-keys.json`
- Navigate to `http://localhost:8000/web/setup` to create your first user account

### Using Docker Run

```bash
docker run -d \
  -p 8000:8000 \
  -v ./data:/app/data \
  -v ./code:/app/code \
  xkonti/crude-functions:hardened
# For debugging: xkonti/crude-functions:latest
# Optional: -e BETTER_AUTH_BASE_URL=https://your-domain.com
```

On first run, navigate to `http://localhost:8000/web/setup` to create your admin user.

### Building from Source

```bash
# Standard image
docker build -t crude-functions .

# Hardened image (requires dhi.io login)
docker login dhi.io
docker build --build-arg BASE_IMAGE=dhi.io/deno:2 -t crude-functions:hardened .
```

## Hot Reload

The server automatically reloads function handlers when their files are modified. Routes and API keys stored in the database are immediately available after changes via the API or Web UI - no server restart required.

## Security Considerations

- This is designed for **internal network use** with trusted code
- No sandboxing - functions have full Deno permissions
- Basic process isolation prevents handlers from calling `process.exit()` or changing working directory
- Environment isolation provides handlers with empty `Deno.env` and `process.env` by default
- API keys and secrets are encrypted with AES-256-GCM
- Encryption keys are auto-generated and stored in `./data/encryption-keys.json`
- Automatic key rotation with configurable intervals
- Use behind a reverse proxy for TLS termination
- **Important:** Keep `./data/encryption-keys.json` backed up and secure - loss means encrypted data cannot be recovered

## License

MIT
