---
title: Your First Function
description: Quick tutorial for creating and deploying your first function
---

This tutorial walks you through creating, deploying, and testing your first function in Crude Functions. You'll learn the complete workflow from writing code to calling your endpoint.

## What We'll Build

A simple "Hello World" function that:
- Responds with JSON
- Shows the current timestamp
- Includes request metadata
- Demonstrates hot-reload capability

## Prerequisites

Before starting, make sure you have:
- Crude Functions running at `http://localhost:8000`
- Completed the initial setup (created your admin account)
- Access to the web UI or API

If you haven't installed Crude Functions yet, see the [Getting Started](/guides/getting-started) guide.

## Step 1: Create the Handler File

Every function in Crude Functions is a TypeScript file in the `code/` directory. Let's create our first handler.

Create a file called `hello.ts` in your `code/` directory:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  return c.json({
    message: "Hello from Crude Functions!",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
  });
}
```

### Understanding the Handler Structure

Every handler receives exactly two parameters:

| Parameter | Type | Purpose |
|-----------|------|---------|
| `c` | Hono Context | Request/response handling (like Express `req`/`res`) |
| `ctx` | Function Context | Route metadata, params, query, secrets, request ID |

**The `c` parameter** lets you:
- Read request data (`c.req.json()`, `c.req.header()`, etc.)
- Send responses (`c.json()`, `c.text()`, `c.html()`, `c.redirect()`)

**The `ctx` parameter** provides:
- `ctx.params` - Path parameters (e.g., `/users/:id`)
- `ctx.query` - Query string parameters
- `ctx.requestId` - Unique request identifier
- `ctx.requestedAt` - Request timestamp
- `ctx.authenticatedKeyGroup` - API key group (if authenticated)
- `ctx.getSecret()` - Access to secrets
- `ctx.route` - Route configuration details

## Step 2: Register the Route

Now that we have our handler file, we need to register it as a route. You can do this via the Web UI or API.

### Option A: Using the Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click the "Add Function" button
3. Fill in the form:

| Field | Value | Description |
|-------|-------|-------------|
| **Name** | `hello-world` | Unique identifier for the function |
| **Description** | "My first function" | Human-readable description (optional) |
| **Handler** | `hello.ts` | Path to handler file relative to `code/` directory |
| **Route** | `/hello` | URL path where function will be accessible |
| **Methods** | `GET` | HTTP methods allowed (select from dropdown) |
| **API Keys** | *(leave empty)* | No authentication required for now |

4. Click "Create"

You should see your new function in the functions list with a green "Enabled" status.

### Option B: Using the API

If you prefer programmatic deployment, you can use the management API:

```bash
# First, get a management API key from the web UI at /web/keys
# The key should be in the 'management' group

curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "description": "My first function",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET"]
  }'
```

## Step 3: Test Your Function

Your function is now live. Let's test it.

### Using curl

```bash
curl http://localhost:8000/run/hello
```

You should see a JSON response like:

```json
{
  "message": "Hello from Crude Functions!",
  "timestamp": "2026-01-12T10:30:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Using your browser

Simply visit `http://localhost:8000/run/hello` in your browser. You'll see the same JSON response.

### Using an HTTP client

If you use tools like Postman, Insomnia, or HTTPie:

```bash
# HTTPie
http GET localhost:8000/run/hello

# Postman/Insomnia
# Just create a GET request to http://localhost:8000/run/hello
```

## Step 4: View Logs

Crude Functions automatically captures all console output from your functions.

1. Go to `http://localhost:8000/web/functions`
2. Click on your "hello-world" function
3. Switch to the "Logs" tab

You won't see any logs yet because our function doesn't use `console.log()`. Let's add some logging.

## Step 5: Add Logging and Hot-Reload

Edit your `hello.ts` file to add some console output:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  console.log(`Hello endpoint called - Request ID: ${ctx.requestId}`);
  console.log(`Query parameters:`, ctx.query);

  return c.json({
    message: "Hello from Crude Functions!",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
    query: ctx.query,
  });
}
```

**Save the file.** That's it - no restart needed.

### Test the hot-reload

```bash
# Call it without query parameters
curl http://localhost:8000/run/hello

# Call it with query parameters
curl "http://localhost:8000/run/hello?name=Alice&role=developer"
```

Response with query parameters:

```json
{
  "message": "Hello from Crude Functions!",
  "timestamp": "2026-01-12T10:32:15.000Z",
  "requestId": "660e8400-e29b-41d4-a716-446655440001",
  "query": {
    "name": "Alice",
    "role": "developer"
  }
}
```

### Check the logs

Go back to the web UI and refresh the Logs tab. You should now see entries like:

```
[2026-01-12 10:32:15] [LOG] Hello endpoint called - Request ID: 660e8400-e29b-41d4-a716-446655440001
[2026-01-12 10:32:15] [LOG] Query parameters: { name: "Alice", role: "developer" }
```

## Step 6: Handle Path Parameters

Let's make our function more dynamic by accepting a path parameter.

### Update the route

1. Go to `http://localhost:8000/web/functions`
2. Click "Edit" on your hello-world function
3. Change the **Route** to `/hello/:name`
4. Click "Save"

### Update the handler

Edit `hello.ts` to use the path parameter:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  const name = ctx.params.name || "Guest";

  console.log(`Greeting ${name} - Request ID: ${ctx.requestId}`);

  return c.json({
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
  });
}
```

### Test with different names

```bash
curl http://localhost:8000/run/hello/Alice
# Response: {"message": "Hello, Alice!", ...}

curl http://localhost:8000/run/hello/Bob
# Response: {"message": "Hello, Bob!", ...}

curl http://localhost:8000/run/hello/Claude
# Response: {"message": "Hello, Claude!", ...}
```

## Step 7: Handle POST Requests

Functions can handle multiple HTTP methods. Let's add POST support.

### Update the route

1. Edit your function in the web UI
2. Change **Methods** to include both `GET` and `POST` (hold Ctrl/Cmd to select multiple)
3. Save

### Update the handler to handle both methods

```typescript
// code/hello.ts
export default async function (c, ctx) {
  const method = c.req.method;

  // Handle GET request
  if (method === "GET") {
    const name = ctx.params.name || "Guest";
    console.log(`GET request - Greeting ${name}`);

    return c.json({
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle POST request
  if (method === "POST") {
    const body = await c.req.json();
    console.log(`POST request - Received:`, body);

    return c.json({
      message: `Hello, ${body.name || "Guest"}!`,
      received: body,
      timestamp: new Date().toISOString(),
    }, 201);
  }

  // Method not allowed
  return c.json({ error: "Method not allowed" }, 405);
}
```

### Test POST requests

```bash
# POST with JSON body
curl -X POST http://localhost:8000/run/hello/someone \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "role": "developer"}'
```

Response:

```json
{
  "message": "Hello, Alice!",
  "received": {
    "name": "Alice",
    "role": "developer"
  },
  "timestamp": "2026-01-12T10:35:00.000Z"
}
```

## Step 8: View Execution Metrics

Crude Functions tracks execution metrics for every function call.

1. Go to `http://localhost:8000/web/functions`
2. Click on your hello-world function
3. Switch to the "Metrics" tab

You'll see charts showing:
- **Request count** - Number of executions over time
- **Execution time** - Average and maximum response times
- **Error rates** - Failed requests (if any)

The metrics are aggregated by minute, hour, and day depending on the time range you select.

## Next Steps

Congratulations! You've created, deployed, and tested your first function. Here's what to explore next:

### Add Authentication

Protect your function with API keys:

1. Go to `http://localhost:8000/web/keys`
2. Create a new key group (e.g., `api`)
3. Add an API key to the group
4. Edit your function and add the group name to the "API Keys" field
5. Test with authentication:

```bash
# Without key - will fail
curl http://localhost:8000/run/hello/Alice

# With key - will work
curl -H "X-API-Key: your-key-value" http://localhost:8000/run/hello/Alice
```

### Use External Packages

Add external dependencies to your function:

```typescript
// code/hello.ts
import { format } from "npm:date-fns";
import { camelCase } from "npm:lodash-es";

export default async function (c, ctx) {
  const name = ctx.params.name || "Guest";
  const formatted = camelCase(name);
  const timestamp = format(new Date(), "PPpp");

  return c.json({
    message: `Hello, ${formatted}!`,
    timestamp,
  });
}
```

Deno will automatically download and cache the packages on first import.

### Work with Secrets

Store sensitive data like API keys securely:

1. Go to `http://localhost:8000/web/secrets`
2. Add a secret with scope "global":
   - **Name**: `GREETING_PREFIX`
   - **Value**: `Welcome to Crude Functions`
3. Update your handler:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  const prefix = await ctx.getSecret("GREETING_PREFIX") || "Hello";
  const name = ctx.params.name || "Guest";

  return c.json({
    message: `${prefix}, ${name}!`,
    timestamp: new Date().toISOString(),
  });
}
```

### Create Shared Utilities

Organize your code with shared modules:

```typescript
// code/lib/formatters.ts
export function formatGreeting(name: string): string {
  return `Hello, ${name.trim()}!`;
}

export function getTimestamp(): string {
  return new Date().toISOString();
}

// code/hello.ts
import { formatGreeting, getTimestamp } from "./lib/formatters.ts";

export default async function (c, ctx) {
  const name = ctx.params.name || "Guest";

  return c.json({
    message: formatGreeting(name),
    timestamp: getTimestamp(),
  });
}
```

### Learn More

- [API Reference](/api) - Complete API documentation
- [Writing Functions Guide](/guides/writing-functions) - Deep dive into handler capabilities
- [Deployment Guide](/guides/deployment) - Production deployment best practices
- [Security Guide](/guides/security) - Security considerations and best practices

## Troubleshooting

### "Function not found" error

- Make sure the handler file exists in the `code/` directory
- Check that the handler path in the function configuration is correct (relative to `code/`)
- Verify the route is enabled in the web UI

### Changes not taking effect

- Save the file and wait a moment (hot-reload checks file modification time)
- Check container logs for any errors: `docker compose logs -f`
- Verify the volume mount in docker-compose.yml is correct

### "Module not found" error

- External packages must use full specifiers (`npm:package`, `jsr:package`, or full URLs)
- Local imports must use relative paths with `.ts` extension
- Check for typos in import statements

### Function returns 500 error

- Check the function logs in the web UI
- Look at container logs: `docker compose logs -f`
- Add try-catch blocks and console.error() statements to debug

## Summary

You've learned how to:

- ✅ Create a handler file with the correct structure
- ✅ Register a function via the Web UI or API
- ✅ Test functions with curl and browsers
- ✅ View execution logs in real-time
- ✅ Experience hot-reload in action
- ✅ Handle path parameters and query strings
- ✅ Support multiple HTTP methods
- ✅ Monitor execution metrics

You're now ready to build more complex functions. Start simple, iterate quickly, and take advantage of hot-reload to rapidly develop your internal APIs.
