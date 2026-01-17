# Getting Started with Crude Functions

## What is Crude Functions?

Crude Functions is a minimal, self-hosted serverless function platform that runs in a single Docker container. Write TypeScript functions, deploy them as HTTP endpoints, manage everything through a web UI or API. That's it.

**Philosophy:** Simple, pragmatic, and designed for internal use. No complex deployment pipelines, no sandboxing theater, no scaling nonsense. You want to run some functions on your network? Done.

**Target use case:** Internal network services with low-to-moderate traffic. Think internal APIs, webhooks, automation scripts, or small tools for your team.

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

- `hardened` - Uses [Docker Hardened Image](https://dhi.io) - Near-zero CVEs, no shell, runs as non-root. Use this for production.
- `standard` - Full Debian base with shell. Use this for debugging or if you need to exec into the container.

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

## First-Time Setup

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

## Understanding the Data Directory

Everything persistent lives in `data/`:

- **database.db** - Routes, functions, API keys, users, secrets, logs, metrics
- **encryption-keys.json** - AES-256-GCM keys for encrypting API keys and secrets

**Backup strategy:**

```bash
# Stop the container
docker compose down

# Backup data directory
tar -czf crude-functions-backup-$(date +%Y%m%d).tar.gz data/

# Restart
docker compose up -d
```

**Restoration:**

```bash
# Stop the container
docker compose down

# Restore from backup
tar -xzf crude-functions-backup-20260112.tar.gz

# Restart
docker compose up -d
```

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

## Protecting Functions with API Keys

Functions can require API keys for access.

### Step 1: Create an API Key Group

Navigate to `http://localhost:8000/web/keys`:

1. Enter a group name (e.g., `api`)
2. Click "Create Group"

### Step 2: Add a Key to the Group

1. Click on the `api` group
2. Enter a key value (e.g., `my-secret-key-12345`)
3. Optional: Add a description
4. Click "Add Key"

### Step 3: Require the Key Group on Your Route

Edit your function (or create a new one):

1. Go to Functions page
2. Edit the function
3. In "API Keys" field, enter `api`
4. Save

### Step 4: Test with Authentication

```bash
# Without key - should fail
curl http://localhost:8000/run/hello
# Response: {"error": "Unauthorized"}

# With key - should work
curl -H "X-API-Key: my-secret-key-12345" http://localhost:8000/run/hello
# Response: {"message": "Hello from Crude Functions!", ...}
```

## Accessing the Web UI

The web interface is at `http://localhost:8000/web`.

**Main pages:**

- **Dashboard** (`/web`) - Overview and quick links
- **Code** (`/web/code`) - Upload, edit, delete function files
- **Functions** (`/web/functions`) - Manage routes, view logs and metrics
- **API Keys** (`/web/keys`) - Manage key groups and keys
- **Secrets** (`/web/secrets`) - Store encrypted secrets (connection strings, tokens, etc.)
- **Users** (`/web/users`) - Manage user accounts
- **Settings** (`/web/settings`) - Configure logging, metrics, encryption, API access

**Authentication:**

- Sessions are valid for 7 days
- Use the logout button in the top-right corner
- No "remember me" checkbox - sessions are always persistent

## Using the API

All management operations can be done via API. This is useful for automation, CI/CD, or programmatic deployment.

### Get a Management API Key

1. Navigate to `http://localhost:8000/web/keys`
2. Find the `management` group (auto-created on first startup)
3. Add a key (e.g., `mgmt-key-12345`)

### Example API Calls

**List all functions:**

```bash
curl -H "X-API-Key: mgmt-key-12345" \
  http://localhost:8000/api/functions
```

**Create a new function:**

```bash
curl -X POST \
  -H "X-API-Key: mgmt-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "goodbye",
    "handler": "goodbye.ts",
    "route": "/goodbye",
    "methods": ["GET"],
    "description": "A farewell endpoint"
  }' \
  http://localhost:8000/api/functions
```

**Upload a code file:**

```bash
curl -X POST \
  -H "X-API-Key: mgmt-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "goodbye.ts",
    "content": "export default async function(c, ctx) { return c.json({ message: \"Goodbye!\" }); }"
  }' \
  http://localhost:8000/api/files
```

**Update a function:**

```bash
curl -X PUT \
  -H "X-API-Key: mgmt-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "keys": ["api"]
  }' \
  http://localhost:8000/api/functions/1
```

**Full API documentation:** See the README.md for complete endpoint listings.

## Common Patterns

### Path Parameters

```typescript
// Route: /users/:id
export default async function (c, ctx) {
  const userId = ctx.params.id;
  return c.json({ userId });
}
```

### Query Parameters

```typescript
// URL: /search?q=hello&limit=10
export default async function (c, ctx) {
  const query = ctx.query.q;      // "hello"
  const limit = ctx.query.limit;  // "10" (always strings)
  return c.json({ query, limit });
}
```

### POST Body

```typescript
export default async function (c, ctx) {
  const body = await c.req.json();
  return c.json({ received: body });
}
```

### Multiple HTTP Methods

When registering a route, you can specify multiple methods:

- Methods: `["GET", "POST"]`

Then in your handler:

```typescript
export default async function (c, ctx) {
  if (c.req.method === "GET") {
    return c.json({ action: "list" });
  } else if (c.req.method === "POST") {
    const body = await c.req.json();
    return c.json({ action: "create", data: body });
  }
}
```

### Using Secrets

Store sensitive data (connection strings, API tokens) in Secrets:

1. Go to `http://localhost:8000/web/secrets`
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

**Secret scopes:**

- **Global** - Available to all functions
- **Function** - Specific to one function (by name)
- **Group** - Specific to an API key group
- **Key** - Specific to an API key ID

Scopes are hierarchical: key > group > function > global. More specific scopes override general ones.

## Deployment Behind a Reverse Proxy

If you're deploying behind nginx, Caddy, or Traefik:

### nginx Example

```nginx
server {
    listen 80;
    server_name functions.internal.company.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `AUTH_BASE_URL` in your docker-compose.yml:

```yaml
environment:
  - AUTH_BASE_URL=http://functions.internal.company.com
```

### Caddy Example

```
functions.internal.company.com {
    reverse_proxy localhost:8000
}
```

Caddy automatically sets forwarding headers. No need to set `AUTH_BASE_URL` unless auto-detection fails.

## Monitoring and Logs

### Execution Logs

Navigate to `http://localhost:8000/web/functions`, click on a function, and view the "Logs" tab.

**What's captured:**

- All `console.log()`, `console.error()`, etc. calls
- Request ID, timestamp, authenticated key group
- Automatically trimmed (keeps last N logs per function, configurable in Settings)

### Metrics

Click the "Metrics" tab on any function to see:

- Request count over time
- Average execution time
- Error rates
- Aggregated by minute/hour/day

**Retention:** Metrics are kept for 90 days by default (configurable in Settings).

### Container Logs

Docker logs show server startup, errors, and system events:

```bash
docker compose logs -f
```

## Updating Crude Functions

### Docker Deployment

```bash
# Pull the latest image
docker compose pull

# Restart with new image
docker compose up -d
```

Your `data/` directory persists across updates. Database migrations run automatically on startup.

### Native Deno

```bash
git pull
deno task dev
```

## Troubleshooting

### "Cannot connect to database"

- Check that `./data` directory exists and is writable
- For Docker: Ensure volume mount is correct in docker-compose.yml
- Check file permissions on `data/database.db`

### "Authentication failed" when using API

- Verify the API key is correct
- Check that the key group is in the allowed access groups (Settings page)
- For management endpoints, ensure the key is in the `management` group

### Functions not hot-reloading

- Save the file (modification time must change)
- Check Docker volume mount for `./code` directory
- Look at container logs for any errors

### "Module not found" in function

- Check import specifiers (must use `npm:`, `jsr:`, or full URLs)
- For local imports, use relative paths: `./utils/helpers.ts`
- Verify the file exists in the `code/` directory

### Port already in use

```bash
# Find what's using port 8000
lsof -i :8000

# Change the port in docker-compose.yml
ports:
  - 8001:8000  # Host:Container
```

Or set `PORT` environment variable.

## Next Steps

Now that you have Crude Functions running:

1. **Explore the web UI** - Familiarize yourself with the interface
2. **Create more functions** - Build out your internal APIs
3. **Set up API keys** - Protect your functions appropriately
4. **Configure secrets** - Store connection strings and tokens securely
5. **Review settings** - Adjust logging, metrics, and encryption settings
6. **Set up backups** - Automate backups of the `data/` directory
7. **Deploy behind a reverse proxy** - Add TLS termination for production use

## Additional Resources

- **README.md** - Full technical documentation
- **function_handler_design.md** - Deep dive into handler architecture and context
- **CLAUDE.md** - Development guide and architecture overview

## Getting Help

Crude Functions is designed to be simple and self-explanatory. If you run into issues:

1. Check the container/server logs
2. Review the function execution logs in the web UI
3. Verify your configuration in Settings
4. Check file permissions on `data/` and `code/` directories
5. Consult the README.md for detailed API documentation

Remember: This is "crude" by design. It's meant to be simple, hackable, and easy to debug. If something's broken, you can usually figure it out by reading the logs.
