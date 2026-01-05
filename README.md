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

# Set up a management key
echo "MANAGEMENT_API_KEY=your-secret-key" > .env

# Run the server
deno task dev
```

The server starts on port 8000 by default. The database is automatically created at `./data/database.db` on first run. Access the web UI at `http://localhost:8000/web`.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8000` |
| `MANAGEMENT_API_KEY` | Management key for admin access (API and Web UI) | Required |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error`, `none` | `info` |
| `METRICS_AGGREGATION_INTERVAL_SECONDS` | How often to aggregate metrics (seconds) | `60` |
| `METRICS_RETENTION_DAYS` | Days to retain aggregated daily metrics | `90` |
| `LOG_TRIMMING_INTERVAL_SECONDS` | How often to trim old logs (seconds) | `300` |
| `LOG_MAX_PER_ROUTE` | Maximum logs to keep per function/route | `2000` |
| `BETTER_AUTH_BASE_URL` | Base URL for redirects and callbacks | `http://localhost:8000` |
| `KEY_ROTATION_CHECK_INTERVAL_SECONDS` | How often to check if key rotation needed (seconds) | `10800` |
| `KEY_ROTATION_INTERVAL_DAYS` | Days between automatic key rotations | `90` |
| `KEY_ROTATION_BATCH_SIZE` | Records to re-encrypt per batch during rotation | `100` |
| `KEY_ROTATION_BATCH_SLEEP_MS` | Sleep between re-encryption batches (ms) | `100` |

**Note:** Encryption keys are auto-generated on first startup and stored in `./data/encryption-keys.json`. The key rotation variables are optional - the system will use the defaults shown above if not specified.

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

The `management` key group is reserved for admin access (API and Web UI). You can provide a management key via the `MANAGEMENT_API_KEY` environment variable, or add keys using the API/Web UI after initial setup.

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

All management endpoints require the `X-API-Key` header with a valid management key.

### Functions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/routes` | List all function routes |
| GET | `/api/routes/:name` | Get a specific route |
| POST | `/api/routes` | Create a new route |
| DELETE | `/api/routes/:name` | Delete a route |

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

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest
    ports:
      - 8000:8000
    environment:
      # Management API key for admin access (Web UI and API)
      - MANAGEMENT_API_KEY=your-secret-key-here

      # Log level: debug, info, warn, error, none (default: info)
      - LOG_LEVEL=info

      # Metrics configuration
      - METRICS_AGGREGATION_INTERVAL_SECONDS=60  # Default: 60
      - METRICS_RETENTION_DAYS=90                # Default: 90

      # Log trimming configuration
      - LOG_TRIMMING_INTERVAL_SECONDS=300        # Default: 300 (5 minutes)
      - LOG_MAX_PER_ROUTE=2000                   # Default: 2000

      # Better Auth configuration
      # IMPORTANT: Update this to match your deployment URL
      - BETTER_AUTH_BASE_URL=http://localhost:8000

      # Encryption Key Rotation (optional - defaults shown below)
      # Encryption keys are auto-generated on first startup
      # - KEY_ROTATION_CHECK_INTERVAL_SECONDS=10800  # Default: 10800 (3 hours)
      # - KEY_ROTATION_INTERVAL_DAYS=90              # Default: 90
      # - KEY_ROTATION_BATCH_SIZE=100                # Default: 100
      # - KEY_ROTATION_BATCH_SLEEP_MS=100            # Default: 100
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

**Important:** Update `BETTER_AUTH_BASE_URL` to match your deployment URL (e.g., `https://functions.yourdomain.com`).

On first run:
- Database is created at `./data/database.db`
- Encryption keys are generated at `./data/encryption-keys.json`
- Navigate to `http://localhost:8000/web/setup` to create your first user account

### Using Docker Run

```bash
docker run -d \
  -p 8000:8000 \
  -e MANAGEMENT_API_KEY=your-secret-key \
  -e BETTER_AUTH_BASE_URL=http://localhost:8000 \
  -v ./data:/app/data \
  -v ./code:/app/code \
  xkonti/crude-functions:latest
```

See the Docker Compose section above for all available environment variables.

### Building from Source

```bash
docker build -t crude-functions .
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
