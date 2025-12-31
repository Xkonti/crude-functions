# crude-functions

A minimal, single-container serverless-style function router built on Deno. Functions are TypeScript files that get dynamically loaded and executed as HTTP endpoints.

**Target use case:** Internal network services with low-to-moderate traffic (~5-50 req/s).

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

# Create config directory
mkdir -p config

# Set up a management key
echo "management=your-secret-key" > config/keys.config

# Run the server
deno task dev
```

The server starts on port 8000 by default. Access the web UI at `http://localhost:8000/web`.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8000` |
| `MANAGEMENT_API_KEY` | Management key (alternative to config file) | - |

### Directory Structure

```
crude-functions/
├── config/
│   ├── keys.config    # API keys configuration
│   └── routes.json    # Function route definitions
├── code/              # Your function handlers
│   └── *.ts
└── main.ts
```

### API Keys (`config/keys.config`)

API keys are stored as `name=value` pairs with optional descriptions:

```
management=your-admin-key # Admin access
management=another-key # For CI/CD
api=user-key-123 # User API access
readonly=viewer-key # Read-only access
```

- **Key names:** lowercase `a-z`, `0-9`, `_`, `-`
- **Key values:** `a-z`, `A-Z`, `0-9`, `_`, `-`
- **Comments:** Everything after `#` is treated as a description
- **Multiple values:** Same name can have multiple keys

The `management` key name is reserved for admin access (API and Web UI).

### Function Routes (`config/routes.json`)

```json
[
  {
    "name": "hello-world",
    "description": "A simple greeting endpoint",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET"],
    "keys": ["api"]
  },
  {
    "name": "user-api",
    "handler": "users/handler.ts",
    "route": "/users/:id",
    "methods": ["GET", "POST", "PUT", "DELETE"],
    "keys": ["api", "admin"]
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the function |
| `handler` | Yes | Path to TypeScript file in `code/` directory |
| `route` | Yes | URL path pattern (supports `:param` syntax) |
| `methods` | Yes | Array of HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) |
| `description` | No | Human-readable description |
| `keys` | No | Array of key names required for access |

## Writing Function Handlers

Create TypeScript files in the `code/` directory. Each handler must export a default function:

```typescript
// code/hello.ts
import type { FunctionContext } from "../src/functions/types.ts";

export default async function handler(ctx: FunctionContext): Promise<Response> {
  return new Response(JSON.stringify({
    message: "Hello, World!",
    params: ctx.params,
    query: ctx.query,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
```

### FunctionContext

```typescript
interface FunctionContext {
  request: Request;           // Original HTTP request
  params: Record<string, string>;  // URL path parameters
  query: Record<string, string>;   // Query string parameters
  route: RouteInfo;           // Route metadata
  requestId: string;          // Unique request ID
  authenticated: boolean;     // Whether request has valid API key
  authenticatedKeyName?: string;  // Name of the matched key
}
```

### Example: POST Handler with Body

```typescript
// code/create-user.ts
import type { FunctionContext } from "../src/functions/types.ts";

export default async function handler(ctx: FunctionContext): Promise<Response> {
  const body = await ctx.request.json();

  // Your logic here
  const user = { id: crypto.randomUUID(), ...body };

  return new Response(JSON.stringify(user), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
```

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
| GET | `/api/keys` | List all key names |
| GET | `/api/keys/:name` | Get keys for a name |
| POST | `/api/keys/:name` | Add a new key |
| DELETE | `/api/keys/:name` | Delete all keys for a name |
| DELETE | `/api/keys/:name/:value` | Delete a specific key |

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

## Hot Reload

The server automatically detects changes to:

- `config/keys.config` - API keys reload on next request
- `config/routes.json` - Routes rebuild on next request
- `code/*.ts` - Handlers reload when file modification time changes

Changes are detected at most every 10 seconds during active request handling.

## Security Considerations

- This is designed for **internal network use** with trusted code
- No process isolation between functions
- No sandboxing - functions have full Deno permissions
- API keys are stored in plain text
- Use behind a reverse proxy for TLS termination

## License

MIT
