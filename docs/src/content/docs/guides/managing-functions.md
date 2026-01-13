---
title: Managing Functions
description: Creating and configuring function routes
---

Functions are HTTP routes that execute your TypeScript handlers. This guide covers creating, configuring, and managing function routes through both the web UI and API.

## Understanding Function Routes

Every function in Crude Functions is defined by a **route configuration** that maps:
- A URL pattern (like `/hello` or `/users/:id`)
- HTTP methods (GET, POST, PUT, DELETE, etc.)
- A handler file (TypeScript code in the `code/` directory)
- Optional API key requirements

When a request matches a route, Crude Functions loads the handler and executes it, capturing logs and metrics along the way.

## Route Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Unique identifier for the function (used internally, not in URL) |
| **Handler** | Yes | Path to TypeScript file in `code/` directory (e.g., `handlers/hello.ts`) |
| **Route** | Yes | URL path pattern (e.g., `/hello`, `/users/:id`, `/api/*`) |
| **Methods** | Yes | HTTP methods allowed: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS |
| **Description** | No | Human-readable description of what the function does |
| **API Keys** | No | Array of key group names required for access (empty = public) |

## Creating Functions

### Via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click **Add Function**
3. Fill in the form:

```
Name: hello-world
Description: A simple greeting endpoint
Handler: hello.ts
Route: /hello
Methods: [x] GET
API Keys: (leave empty for public access)
```

4. Click **Create**

The function is immediately available at `http://localhost:8000/run/hello`.

### Via API

Create a function programmatically using the management API:

```bash
curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "description": "A simple greeting endpoint",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET"]
  }'
```

Response:

```json
{
  "data": {
    "id": 1,
    "name": "hello-world",
    "description": "A simple greeting endpoint",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET"],
    "enabled": true
  }
}
```

## Route Patterns

Crude Functions uses [Hono's routing engine](https://hono.dev/api/routing), which supports various URL patterns.

### Static Routes

Simple fixed paths:

```
/hello
/api/status
/webhooks/stripe
```

**Example:**
```json
{
  "name": "status-check",
  "handler": "status.ts",
  "route": "/api/status",
  "methods": ["GET"]
}
```

### Path Parameters

Capture dynamic segments in the URL:

```
/users/:id
/posts/:postId/comments/:commentId
/files/:path
```

**Example:**
```json
{
  "name": "get-user",
  "handler": "users/get.ts",
  "route": "/users/:id",
  "methods": ["GET"]
}
```

**Handler usage:**
```typescript
export default async function (c, ctx) {
  const userId = ctx.params.id;
  return c.json({ userId });
}
```

### Wildcard Routes

Catch-all patterns using `*`:

```
/static/*
/api/proxy/*
```

**Example:**
```json
{
  "name": "file-server",
  "handler": "static/serve.ts",
  "route": "/static/*",
  "methods": ["GET"]
}
```

**Handler usage:**
```typescript
export default async function (c, ctx) {
  // Access the full path after /static/
  const filePath = c.req.param("*");
  return c.json({ filePath });
}
```

### Multiple Parameters

Combine multiple dynamic segments:

```
/api/:version/users/:userId
/organizations/:orgId/projects/:projectId
```

**Example:**
```json
{
  "name": "versioned-api",
  "handler": "api/users.ts",
  "route": "/api/:version/users/:userId",
  "methods": ["GET"]
}
```

**Handler usage:**
```typescript
export default async function (c, ctx) {
  const { version, userId } = ctx.params;
  return c.json({ version, userId });
}
```

## HTTP Methods

Functions can handle any combination of HTTP methods:

| Method | Typical Use Case |
|--------|------------------|
| **GET** | Retrieve data, read operations |
| **POST** | Create new resources, submit data |
| **PUT** | Update entire resource, replace data |
| **DELETE** | Remove resources |
| **PATCH** | Partial updates, modify specific fields |
| **HEAD** | Same as GET but without response body |
| **OPTIONS** | CORS preflight, discover allowed methods |

### Single Method

Most functions handle one method:

```json
{
  "name": "list-users",
  "handler": "users/list.ts",
  "route": "/users",
  "methods": ["GET"]
}
```

### Multiple Methods

Handle several methods in one function:

```json
{
  "name": "user-operations",
  "handler": "users/crud.ts",
  "route": "/users/:id",
  "methods": ["GET", "PUT", "DELETE"]
}
```

**Handler example:**
```typescript
export default async function (c, ctx) {
  const method = c.req.method;
  const userId = ctx.params.id;

  if (method === "GET") {
    return c.json({ action: "fetch", userId });
  } else if (method === "PUT") {
    const body = await c.req.json();
    return c.json({ action: "update", userId, body });
  } else if (method === "DELETE") {
    return c.json({ action: "delete", userId }, 204);
  }
}
```

### RESTful Patterns

Common REST API patterns:

```json
// Collection operations
{
  "name": "users-collection",
  "route": "/users",
  "methods": ["GET", "POST"]
}

// Individual resource operations
{
  "name": "user-resource",
  "route": "/users/:id",
  "methods": ["GET", "PUT", "PATCH", "DELETE"]
}
```

## Enabling and Disabling Functions

Functions can be temporarily disabled without deleting them.

### Via Web UI

1. Go to `http://localhost:8000/web/functions`
2. Find your function in the list
3. Click the status icon (green checkmark or red X) in the Status column

**When enabled (green checkmark):**
- Function accepts requests normally
- Appears in function list

**When disabled (red X):**
- Returns 404 Not Found for all requests
- Logs and metrics are preserved
- Configuration is unchanged
- Can be re-enabled instantly

### Via API

**Enable a function:**

```bash
curl -X PUT http://localhost:8000/api/functions/1/enable \
  -H "X-API-Key: your-management-key"
```

**Disable a function:**

```bash
curl -X PUT http://localhost:8000/api/functions/1/disable \
  -H "X-API-Key: your-management-key"
```

### Use Cases for Disabling

- **Maintenance:** Temporarily disable during updates
- **Testing:** Disable production functions in staging
- **Debugging:** Isolate problematic functions
- **Deprecation:** Soft-delete before final removal

## Updating Functions

### Via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click the **Edit** (pencil) icon next to the function
3. Modify any fields:
   - Name (must remain unique)
   - Description
   - Handler path
   - Route pattern
   - HTTP methods
   - API key requirements
4. Click **Save Changes**

The function is updated immediately. Active requests complete with the old configuration, but new requests use the updated configuration.

### Via API

Update any field by sending a PUT request:

```bash
curl -X PUT http://localhost:8000/api/functions/1 \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "description": "Updated description",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET", "POST"],
    "keys": [1, 2]
  }'
```

**Important:** You must provide all fields, not just the ones you want to change. This is a full replace operation.

### What Gets Preserved

When updating a function:
- ✅ Function ID remains the same
- ✅ Historical logs are preserved
- ✅ Historical metrics are preserved
- ✅ Execution continues without restart

### Route Conflicts

If you try to update a route to a pattern and method combination that already exists, you'll get an error:

```json
{
  "error": "Route '/users' with method 'GET' already exists (route: 'list-users')"
}
```

## Deleting Functions

### Via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click the **Delete** (trash) icon next to the function
3. Confirm the deletion

**What gets deleted:**
- Function configuration
- Function-scoped secrets
- Route from the router

**What gets preserved:**
- Historical logs (queryable by function ID)
- Historical metrics (queryable by function ID)
- Handler file in `code/` directory (must be deleted separately)

### Via API

```bash
curl -X DELETE http://localhost:8000/api/functions/1 \
  -H "X-API-Key: your-management-key"
```

Response:

```json
{
  "message": "Function deleted",
  "id": 1
}
```

### Before Deleting

**Consider disabling first:**
- Disable the function and wait 24 hours
- Monitor for errors from clients still calling it
- If nothing breaks, proceed with deletion

**Cleanup checklist:**
- Review logs to ensure no active clients
- Check if any other functions depend on it
- Remove the handler file if no longer needed
- Delete function-scoped secrets (automatic)

## Viewing Function Details

### Via Web UI

The functions list (`/web/functions`) shows:

- **Status** - Enabled/disabled toggle
- **Name** - Function identifier
- **Route** - URL pattern
- **Methods** - Allowed HTTP methods
- **Keys** - Required API key groups
- **Description** - Optional description
- **Actions**:
  - 📝 **Logs** - View execution logs
  - 📊 **Metrics** - View performance metrics
  - 🔐 **Secrets** - Manage function-scoped secrets
  - ✏️ **Edit** - Update configuration
  - ❌ **Delete** - Remove function

### Via API

**List all functions:**

```bash
curl http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key"
```

Response:

```json
{
  "data": [
    {
      "id": 1,
      "name": "hello-world",
      "description": "A simple greeting endpoint",
      "handler": "hello.ts",
      "route": "/hello",
      "methods": ["GET"],
      "enabled": true
    }
  ]
}
```

**Get a specific function:**

```bash
curl http://localhost:8000/api/functions/1 \
  -H "X-API-Key: your-management-key"
```

## Access Control with API Keys

Functions can require API keys for access. Keys are organized into **groups**, and functions specify which groups are allowed.

### Public Functions

Leave the "API Keys" field empty:

```json
{
  "name": "public-endpoint",
  "route": "/public",
  "methods": ["GET"],
  "keys": []
}
```

Anyone can call `http://localhost:8000/run/public` without authentication.

### Protected Functions

Specify one or more key group IDs:

```json
{
  "name": "protected-endpoint",
  "route": "/admin/users",
  "methods": ["GET", "POST"],
  "keys": [1, 2]
}
```

Only API keys from groups with IDs 1 or 2 can access this function.

### Finding Group IDs

**Via Web UI:**
1. Go to `http://localhost:8000/web/keys`
2. Note the group IDs displayed next to group names

**Via API:**
```bash
curl http://localhost:8000/api/key-groups \
  -H "X-API-Key: your-management-key"
```

### Example: Creating a Protected Function

**Step 1: Create a key group** (if not exists):

```bash
curl -X POST http://localhost:8000/api/key-groups \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mobile-app",
    "description": "Keys for mobile clients"
  }'
```

**Step 2: Add a key to the group:**

```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 1,
    "name": "mobile-prod",
    "value": "sk_prod_abc123xyz",
    "description": "Production mobile app key"
  }'
```

**Step 3: Create function requiring that group:**

```bash
curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mobile-api",
    "handler": "mobile/api.ts",
    "route": "/mobile/data",
    "methods": ["GET"],
    "keys": [1]
  }'
```

**Step 4: Test the function:**

```bash
# Without key - fails
curl http://localhost:8000/run/mobile/data
# Response: {"error": "Unauthorized"}

# With key - works
curl -H "X-API-Key: sk_prod_abc123xyz" \
  http://localhost:8000/run/mobile/data
# Response: (function output)
```

## Common Configuration Patterns

### CRUD API

RESTful resource management:

```json
// List and create
{
  "name": "users-collection",
  "handler": "users/collection.ts",
  "route": "/api/users",
  "methods": ["GET", "POST"],
  "keys": [1]
}

// Read, update, delete
{
  "name": "users-resource",
  "handler": "users/resource.ts",
  "route": "/api/users/:id",
  "methods": ["GET", "PUT", "DELETE"],
  "keys": [1]
}
```

### Webhook Receiver

Public endpoint for external services:

```json
{
  "name": "stripe-webhook",
  "handler": "webhooks/stripe.ts",
  "route": "/webhooks/stripe",
  "methods": ["POST"],
  "description": "Stripe payment webhook handler"
}
```

### Internal Tool

Admin-only functionality:

```json
{
  "name": "admin-dashboard",
  "handler": "admin/dashboard.ts",
  "route": "/admin/dashboard",
  "methods": ["GET"],
  "keys": [1],
  "description": "Admin dashboard - requires admin key group"
}
```

### Versioned API

Multiple API versions:

```json
{
  "name": "users-v1",
  "handler": "v1/users.ts",
  "route": "/api/v1/users",
  "methods": ["GET"]
}

{
  "name": "users-v2",
  "handler": "v2/users.ts",
  "route": "/api/v2/users",
  "methods": ["GET"]
}
```

### Proxy/Gateway

Forward requests to external services:

```json
{
  "name": "external-api-proxy",
  "handler": "proxy/external.ts",
  "route": "/proxy/*",
  "methods": ["GET", "POST", "PUT", "DELETE"],
  "keys": [2]
}
```

## Monitoring Function Status

### Execution Logs

View console output and errors:

1. Go to `http://localhost:8000/web/functions`
2. Click the **Logs** icon (📝) next to the function
3. See all `console.log()`, `console.error()`, etc. output
4. Filter by log level, search by request ID
5. Click rows to expand full messages

**What's logged:**
- `EXEC_START` - Function began executing
- `LOG`, `INFO`, `DEBUG`, `WARN`, `ERROR` - Console output
- `EXEC_END` - Function completed successfully
- `EXEC_REJECT` - Function threw an error or was rejected

### Execution Metrics

View performance data:

1. Go to `http://localhost:8000/web/functions`
2. Click the **Metrics** icon (📊) next to the function
3. See charts for:
   - Request count over time
   - Average execution time
   - Maximum execution time
   - Error rates

**Time ranges:**
- Last Hour (minute granularity)
- Last 24 Hours (hour granularity)
- Last N Days (day granularity)

### Via API

**Query logs:**

```bash
curl "http://localhost:8000/api/logs?functionId=1&limit=100" \
  -H "X-API-Key: your-management-key"
```

**Query metrics:**

```bash
curl "http://localhost:8000/api/metrics?functionId=1&resolution=hours" \
  -H "X-API-Key: your-management-key"
```

## Troubleshooting

### Function Returns 404

**Possible causes:**
- Function is disabled (check Status column)
- Route pattern doesn't match the URL
- HTTP method not allowed
- Function was deleted

**Solution:**
1. Verify function is enabled (green checkmark)
2. Check route pattern matches your request URL
3. Confirm HTTP method is in the allowed list

### Function Returns 401 Unauthorized

**Possible causes:**
- Function requires an API key but none was provided
- API key is invalid or expired
- API key's group is not in the function's allowed groups

**Solution:**
1. Check function configuration for required key groups
2. Verify you're sending `X-API-Key` header
3. Confirm the key belongs to an allowed group

### Function Returns 500 Error

**Possible causes:**
- Handler file doesn't exist
- Handler has syntax errors
- Handler threw an exception
- Handler doesn't export a default function

**Solution:**
1. Check logs: Click 📝 icon next to function
2. Look for `EXEC_REJECT` or `ERROR` entries
3. Verify handler file exists at the specified path
4. Check handler syntax and exports

### Changes Not Taking Effect

**Possible causes:**
- Handler file wasn't saved
- File modification time didn't change
- Cache issue (rare)

**Solution:**
1. Save the handler file
2. Wait a moment (hot-reload checks modification time)
3. Try making a request again
4. Check container logs: `docker compose logs -f`

### Route Conflicts

**Error message:**
```
Route '/users' with method 'GET' already exists (route: 'list-users')
```

**Solution:**
- Each route pattern + method combination must be unique
- Either:
  - Change the route pattern (e.g., `/users` → `/api/users`)
  - Change the method (e.g., GET → POST)
  - Delete the conflicting function
  - Combine functionality into one function handling multiple methods

## Best Practices

### Naming Conventions

**Function names:**
- Use kebab-case: `user-login`, `fetch-orders`
- Be descriptive: `stripe-webhook-handler` not `handler1`
- Include resource and action: `users-list`, `posts-create`

**Route patterns:**
- Use lowercase: `/users` not `/Users`
- Use plural for collections: `/users`, `/posts`
- Use singular for resources: `/user/:id`, `/post/:id`
- Be RESTful: `/api/users` not `/api/get-users`

### Organization

**Group related functions:**
- Use prefixes: `/api/users/*`, `/api/posts/*`
- Version your APIs: `/api/v1/*`, `/api/v2/*`
- Separate public and private: `/public/*`, `/admin/*`

**Handler structure:**
```
code/
  api/
    users/
      list.ts
      get.ts
      create.ts
    posts/
      list.ts
      get.ts
  webhooks/
    stripe.ts
    github.ts
  admin/
    dashboard.ts
```

### Security

**Protect sensitive functions:**
- Use API keys for admin functions
- Use separate key groups for different clients
- Don't expose internal tools publicly

**Validate input:**
- Check path parameters
- Validate request bodies
- Sanitize user input

**Rate limiting:**
- Implement in your handlers if needed
- Consider using middleware for common patterns

### Performance

**Keep handlers small:**
- One function, one responsibility
- Extract shared logic to utilities
- Avoid doing too much in one handler

**Monitor metrics:**
- Watch for execution time increases
- Track error rates
- Set up alerts for anomalies

**Optimize hot paths:**
- Cache expensive operations
- Use connection pooling for databases
- Minimize external API calls

## Next Steps

Now that you understand function management:

- [Writing Functions Guide](/guides/writing-functions) - Learn to write handler code
- [API Reference](/reference/api) - Complete API documentation
- [Web UI Guide](.ai/04-web-ui-guide.md) - Detailed UI walkthrough
- [Security Guide](/guides/security) - Protect your functions
