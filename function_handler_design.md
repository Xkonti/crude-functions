# Writing Function Handlers

This guide explains how to write function handlers for crude-functions.

## Quick Start

A handler is a TypeScript file that exports a default function. Place it in the `code/` directory:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  return c.json({ message: "Hello, World!" });
}
```

Register it via the API or Web UI:

```bash
curl -X POST http://localhost:8000/api/routes \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello",
    "handler": "hello.ts",
    "route": "/hello",
    "methods": ["GET"]
  }'
```

Call it at `http://localhost:8000/run/hello`.

## Handler Function

Every handler receives two arguments:

| Argument | Purpose |
|----------|---------|
| `c` | Hono context - reading requests and sending responses |
| `ctx` | Function context - route info, parameters, request metadata |

```typescript
export default async function (c, ctx) {
  // c  - use for request/response (c.json, c.req.json, etc.)
  // ctx - use for params, query, route info, request ID
  return c.json({ ok: true });
}
```

## Importing Dependencies

### Relative Imports

Import other files from your `code/` directory using relative paths:

```typescript
// code/hello.ts
import { formatGreeting } from "./utils/formatting.ts";
import { validateInput } from "./validators.ts";

export default async function (c, ctx) {
  return c.json({ message: formatGreeting("World") });
}
```

### External Packages

Import packages from NPM, JSR, or URLs using full specifiers:

```typescript
// NPM packages - prefix with npm:
import { camelCase } from "npm:lodash-es";
import dayjs from "npm:dayjs";

// JSR packages - prefix with jsr:
import { z } from "jsr:@zod/zod";

// URL imports - full URL
import confetti from "https://esm.sh/canvas-confetti";

export default async function (c, ctx) {
  return c.json({ date: dayjs().format("YYYY-MM-DD") });
}
```

**Important:** Always use the full specifier (`npm:`, `jsr:`, or URL). Short aliases like `"lodash"` won't work.

## Reading Requests

### JSON Body

```typescript
export default async function (c, ctx) {
  const body = await c.req.json();
  return c.json({ received: body });
}
```

### Form Data

```typescript
export default async function (c, ctx) {
  const form = await c.req.formData();
  const name = form.get("name");
  return c.json({ name });
}
```

### Headers

```typescript
export default async function (c, ctx) {
  const authHeader = c.req.header("Authorization");
  const contentType = c.req.header("Content-Type");
  return c.json({ authHeader, contentType });
}
```

### Path Parameters

For a route like `/users/:id`:

```typescript
export default async function (c, ctx) {
  const userId = ctx.params.id;  // or c.req.param("id")
  return c.json({ userId });
}
```

### Query Parameters

For a request like `/search?q=hello&page=2`:

```typescript
export default async function (c, ctx) {
  const query = ctx.query.q;      // "hello"
  const page = ctx.query.page;    // "2"
  return c.json({ query, page });
}
```

## Sending Responses

### JSON

```typescript
return c.json({ message: "Success" });
return c.json({ error: "Not found" }, 404);
return c.json(data, 201);  // Created
```

### Text

```typescript
return c.text("Hello, World!");
return c.text("Not found", 404);
```

### HTML

```typescript
return c.html("<h1>Hello</h1>");
```

### Redirect

```typescript
return c.redirect("/other-path");
return c.redirect("/login", 301);  // Permanent redirect
```

### Custom Response

```typescript
return new Response("Custom body", {
  status: 201,
  headers: { "X-Custom-Header": "value" },
});
```

## Function Context (`ctx`)

The `ctx` object provides metadata about the current request:

| Property | Type | Description |
|----------|------|-------------|
| `ctx.params` | `Record<string, string>` | Path parameters (e.g., `{ id: "123" }`) |
| `ctx.query` | `Record<string, string>` | Query parameters |
| `ctx.requestId` | `string` | Unique ID for this request (for logging/tracing) |
| `ctx.requestedAt` | `Date` | Timestamp when request was received |
| `ctx.authenticatedKeyGroup` | `string?` | API key group used (if route requires auth) |
| `ctx.route` | `object` | Route configuration (name, methods, etc.) |
| `ctx.getSecret()` | `function` | Get a secret value (see Secrets section below) |
| `ctx.getCompleteSecret()` | `function` | Get secret details across all scopes (see Secrets section below) |

## Secrets

Function handlers can access secrets through the `ctx` object. Secrets are scoped (global, function, group, or key) and automatically resolved based on the current request context.

### `ctx.getSecret(name, scope?): Promise<string | undefined>`

Retrieves a secret value by name. If no scope is specified, returns the merged value (most specific scope wins).

**Parameters:**
- `name` - The secret name to look up
- `scope` (optional) - One of `'global'`, `'function'`, `'group'`, `'key'`. If omitted, returns the merged value.

**Returns:** A promise resolving to the secret value, or `undefined` if not found.

**Examples:**

```typescript
export default async function (c, ctx) {
  // Get from merged scope (most common usage)
  const smtpHost = await ctx.getSecret('SMTP_HOST');

  // Get from specific scope
  const globalDefault = await ctx.getSecret('SMTP_HOST', 'global');
  const callerOverride = await ctx.getSecret('SMTP_HOST', 'key');

  // Parallel fetching when multiple secrets needed
  const [smtpUser, smtpPass] = await Promise.all([
    ctx.getSecret('SMTP_USER'),
    ctx.getSecret('SMTP_PASS'),
  ]);

  if (!smtpHost) {
    return c.json({ error: "SMTP not configured" }, 500);
  }

  // Use the secret...
  return c.json({ ok: true });
}
```

### `ctx.getCompleteSecret(name): Promise<object | undefined>`

Retrieves a secret's values across all scopes. Useful for debugging or when a function needs to inspect the full override chain.

**Parameters:**
- `name` - The secret name to look up

**Returns:** A promise resolving to an object containing all scope values, or `undefined` if the secret doesn't exist in any scope.

**Return structure:**

```typescript
{
  global?: string,
  function?: string,
  group?: { value: string, groupId: number, groupName: string },
  key?: { value: string, groupId: number, groupName: string, keyId: number, keyValue: string }
}
```

**Example:**

```typescript
export default async function (c, ctx) {
  const details = await ctx.getCompleteSecret('SENDER_EMAIL');

  // Example result:
  // {
  //   global: "default@example.com",
  //   function: "noreply@myapp.com",
  //   group: { value: "noreply@email-service.com", groupId: 5, groupName: "email" },
  //   key: { value: "noreply@acme.com", groupId: 5, groupName: "email", keyId: 10, keyValue: "customer-acme" }
  // }

  console.log(`Using SENDER_EMAIL from ${Object.keys(details).pop()} scope`);

  return c.json({ details });
}
```

### Scope Resolution

When multiple scopes define a secret with the same name, the more specific scope wins:

```
Global → Function → Group → Key
```

**Example:**
- Global defines `LOG_LEVEL=info`
- Function defines `LOG_LEVEL=debug`
- Group defines nothing
- Key defines `LOG_LEVEL=warn`

Result: `await ctx.getSecret('LOG_LEVEL')` returns `"warn"` (Key scope wins)

### Public Routes (No API Key Required)

When a route does not require authentication (`keys: []` or undefined):
- Global and Function scoped secrets are available
- Group and Key scoped secrets return `undefined`

This is expected behavior - there is no caller identity to resolve group/key secrets from.

## Examples

### GET with Query Parameters

```typescript
// Route: /search
export default async function (c, ctx) {
  const term = ctx.query.q || "";
  const page = parseInt(ctx.query.page || "1");

  // Your search logic here...

  return c.json({ term, page, results: [] });
}
```

### POST with Validation

```typescript
// Route: /users (POST)
export default async function (c, ctx) {
  const body = await c.req.json();

  if (!body.email) {
    return c.json({ error: "Email is required" }, 400);
  }

  const user = {
    id: crypto.randomUUID(),
    email: body.email,
    createdAt: ctx.requestedAt.toISOString(),
  };

  return c.json(user, 201);
}
```

### Using External Packages

```typescript
import { z } from "jsr:@zod/zod";

const UserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export default async function (c, ctx) {
  const body = await c.req.json();
  const result = UserSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.issues }, 400);
  }

  return c.json({ user: result.data }, 201);
}
```

### Shared Utilities

```typescript
// code/utils/db.ts
export async function getUser(id: string) {
  // Database logic...
  return { id, name: "John" };
}

// code/users.ts
import { getUser } from "./utils/db.ts";

export default async function (c, ctx) {
  const user = await getUser(ctx.params.id);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json(user);
}
```

## Error Handling

Handle errors gracefully and return appropriate status codes:

```typescript
export default async function (c, ctx) {
  try {
    const result = await someOperation();
    return c.json(result);
  } catch (error) {
    console.error(`[${ctx.requestId}] Error:`, error);
    return c.json({
      error: "Something went wrong",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

Unhandled errors automatically return a 500 response with the request ID.

## File Organization

Organize handlers however makes sense for your project:

```
code/
  hello.ts              # Simple endpoints
  users.ts              # User-related handler
  users/
    create.ts           # Nested by feature
    delete.ts
  utils/
    db.ts               # Shared database utilities
    validation.ts       # Shared validation helpers
```

Reference nested handlers when creating routes via the API:

```bash
curl -X POST http://localhost:8000/api/routes \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "create-user",
    "handler": "users/create.ts",
    "route": "/users",
    "methods": ["POST"]
  }'
```

## Hot Reloading

Handlers automatically reload when you modify them. No server restart needed.

## TypeScript Types (Optional)

Types are optional but can help during development. Define them inline:

```typescript
interface User {
  id: string;
  email: string;
  name: string;
}

interface CreateUserBody {
  email: string;
  name: string;
}

export default async function (c, ctx): Promise<Response> {
  const body: CreateUserBody = await c.req.json();

  const user: User = {
    id: crypto.randomUUID(),
    ...body,
  };

  return c.json(user, 201);
}
```
