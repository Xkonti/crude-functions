# Function Handler Design

This document describes how to write function handlers for the Deno Functions Router.

## Handler Signature

Handlers are TypeScript files that export a default async function. The function receives two arguments:

1. **`c`** - Hono Context for full request/response control
2. **`ctx`** - FunctionContext with route metadata and convenience data

```typescript
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  return c.json({ message: "Hello!" });
}
```

## FunctionContext Interface

The `FunctionContext` provides metadata about the request and matched route:

```typescript
interface FunctionContext {
  // Route configuration that matched this request
  route: {
    name: string;           // Function name from config
    description?: string;   // Optional description
    handler: string;        // Path to this handler file
    route: string;          // Route pattern (e.g., "/users/:id")
    methods: string[];      // Allowed HTTP methods
    keys?: string[];        // Required API key names
  };

  // Extracted path parameters (e.g., { id: "123" })
  params: Record<string, string>;

  // Query parameters as key-value pairs
  query: Record<string, string>;

  // Which API key name matched (if auth required)
  authenticatedKeyName?: string;

  // Request timestamp
  requestedAt: Date;

  // Unique request ID for tracing
  requestId: string;
}
```

## Hono Context Capabilities

The Hono Context (`c`) provides rich request/response handling:

### Reading Request Data

```typescript
// Get JSON body
const body = await c.req.json();

// Get form data
const formData = await c.req.formData();

// Get raw text
const text = await c.req.text();

// Get headers
const contentType = c.req.header("Content-Type");

// Get specific path parameter
const id = c.req.param("id");

// Get query parameter
const page = c.req.query("page");
```

### Returning Responses

```typescript
// JSON response
return c.json({ success: true });

// JSON with status code
return c.json({ error: "Not found" }, 404);

// Plain text
return c.text("Hello, World!");

// HTML
return c.html("<h1>Hello</h1>");

// Redirect
return c.redirect("/other-path");

// Custom response
return new Response("Custom", {
  status: 201,
  headers: { "X-Custom": "value" },
});
```

## Example Handlers

### Simple Hello World

```typescript
// code/hello.ts
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  return c.json({
    message: "Hello, World!",
    requestId: ctx.requestId,
  });
}
```

### Using Path Parameters

```typescript
// code/users.ts
// Route: /users/:id
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  const userId = ctx.params.id;

  // Fetch user from database...
  const user = { id: userId, name: "John" };

  return c.json(user);
}
```

### Handling POST with JSON Body

```typescript
// code/create-item.ts
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

interface CreateItemRequest {
  name: string;
  description?: string;
}

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  const body = await c.req.json<CreateItemRequest>();

  if (!body.name) {
    return c.json({ error: "Name is required" }, 400);
  }

  // Create item in database...
  const item = {
    id: crypto.randomUUID(),
    name: body.name,
    description: body.description,
    createdAt: ctx.requestedAt.toISOString(),
  };

  return c.json(item, 201);
}
```

### Using Query Parameters

```typescript
// code/search.ts
// Route: /search?q=term&page=1
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  const query = ctx.query.q || "";
  const page = parseInt(ctx.query.page || "1", 10);

  // Search logic...
  const results = {
    query,
    page,
    results: [],
  };

  return c.json(results);
}
```

### Protected Route with API Key

```typescript
// code/admin-action.ts
// Route config includes: "keys": ["admin"]
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";

export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  // ctx.authenticatedKeyName will be "admin" if we got here
  console.log(`Authenticated with key: ${ctx.authenticatedKeyName}`);

  // Perform admin action...

  return c.json({ success: true });
}
```

## Error Handling

Handlers should catch their own errors and return appropriate responses:

```typescript
export default async function (
  c: Context,
  ctx: FunctionContext
): Promise<Response> {
  try {
    const result = await riskyOperation();
    return c.json(result);
  } catch (error) {
    console.error(`Error in ${ctx.route.name}:`, error);

    return c.json(
      {
        error: "Operation failed",
        requestId: ctx.requestId,
      },
      500
    );
  }
}
```

If an unhandled error occurs, the router will catch it and return a 500 response with the `requestId` for debugging.

## File Organization

Place handler files in the `code/` directory:

```
code/
  hello.ts          # Simple endpoint
  users.ts          # User operations
  users/
    create.ts       # Nested organization
    delete.ts
  utils/
    helpers.ts      # Shared utilities (import in handlers)
```

Reference handlers in `config/routes.json`:

```json
[
  {
    "name": "hello",
    "handler": "code/hello.ts",
    "route": "/hello",
    "methods": ["GET"]
  },
  {
    "name": "create-user",
    "handler": "code/users/create.ts",
    "route": "/users",
    "methods": ["POST"],
    "keys": ["api"]
  }
]
```

## Hot Reloading

Handlers are automatically reloaded when their files change. The system checks file modification times and reloads handlers as needed. No server restart required.

## Type Imports

For full type safety, import types from the project:

```typescript
import type { Context } from "@hono/hono";
import type { FunctionContext } from "./src/functions/types.ts";
```

Or create a `code/_types.ts` for convenience:

```typescript
// code/_types.ts
export type { Context } from "@hono/hono";
export type { FunctionContext, FunctionHandler } from "../src/functions/types.ts";
```

Then use in handlers:

```typescript
import type { Context, FunctionContext } from "./_types.ts";
```
