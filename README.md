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
| `MANAGEMENT_API_KEY` | Management key for admin access (API and Web UI) | - |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error`, `none` | `info` |
| `METRICS_AGGREGATION_INTERVAL_SECONDS` | How often to run metrics aggregation (seconds) | `60` |
| `METRICS_RETENTION_DAYS` | Days to retain aggregated daily metrics | `90` |

### Directory Structure

```
crude-functions/
├── data/
│   └── database.db    # SQLite database (API keys & routes)
├── code/              # Your function handlers
│   └── *.ts
├── migrations/        # Database schema migrations
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

Access the management interface at `/web`. Authentication uses HTTP Basic Auth:

- **Username:** anything (ignored)
- **Password:** a valid management API key

### Pages

- `/web` - Dashboard with links to all sections
- `/web/code` - Manage code files (upload, edit, delete)
- `/web/functions` - Manage function routes
- `/web/keys` - Manage API keys

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
      - MANAGEMENT_API_KEY=your-secret-key
      - LOG_LEVEL=info
    volumes:
      - ./data:/app/data
      - ./code:/app/code
    restart: unless-stopped
```

Create your directories and start:

```bash
mkdir -p data code
docker compose up -d
```

The database will be created automatically at `./data/database.db` on first run.

### Using Docker Run

```bash
docker run -d \
  -p 8000:8000 \
  -e MANAGEMENT_API_KEY=your-secret-key \
  -v ./data:/app/data \
  -v ./code:/app/code \
  xkonti/crude-functions:latest
```

### Building from Source

```bash
docker build -t crude-functions .
```

## Hot Reload

The server automatically reloads function handlers when their files are modified. Routes and API keys stored in the database are immediately available after changes via the API or Web UI - no server restart required.

## Security Considerations

- This is designed for **internal network use** with trusted code
- No process isolation between functions
- No sandboxing - functions have full Deno permissions
- API keys are stored in plain text
- Use behind a reverse proxy for TLS termination

## License

MIT
