---
title: Handler Context
description: Complete reference for the handler context objects (c and ctx) available in Crude Functions handlers.
---

Every handler function receives two parameters: the Hono context (`c`) for request/response handling, and the Crude Functions context (`ctx`) with route metadata and utilities.

```typescript
export default async function (c, ctx) {
  // c = Hono context (request, response helpers)
  // ctx = Function context (params, query, secrets, etc.)
  return c.json({ message: "Hello" });
}
```

## FunctionContext (`ctx`)

The `ctx` parameter provides Crude Functions-specific information and utilities.

### ctx.route

**Type:** `RouteInfo`

Metadata about the matched route.

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Function name from route configuration |
| `description` | `string \| undefined` | Optional description |
| `handler` | `string` | Path to the handler file |
| `route` | `string` | Route pattern (e.g., `/users/:id`) |
| `methods` | `string[]` | Allowed HTTP methods |
| `keys` | `number[] \| undefined` | Required API key group IDs |

```typescript
export default async function (c, ctx) {
  console.log(ctx.route.name);      // "get-user"
  console.log(ctx.route.handler);   // "user.ts"
  console.log(ctx.route.methods);   // ["GET", "PUT"]
  console.log(ctx.route.route);     // "/users/:id"
  return c.json({ route: ctx.route.name });
}
```

### ctx.params

**Type:** `Record<string, string>`

Path parameters extracted from the route pattern.

```typescript
// Route: /users/:userId/posts/:postId
// URL: /run/users/42/posts/99

export default async function (c, ctx) {
  const userId = ctx.params.userId;   // "42"
  const postId = ctx.params.postId;   // "99"
  return c.json({ userId, postId });
}
```

### ctx.query

**Type:** `Record<string, string>`

Query parameters parsed from the URL.

```typescript
// URL: /run/search?q=test&page=2

export default async function (c, ctx) {
  const searchQuery = ctx.query.q;    // "test"
  const page = ctx.query.page;        // "2"
  return c.json({ q: searchQuery, page });
}
```

### ctx.authenticatedKeyGroup

**Type:** `string | undefined`

The name of the API key group used for authentication. Only set when the route requires API keys and the request was successfully authenticated.

```typescript
export default async function (c, ctx) {
  if (ctx.authenticatedKeyGroup) {
    console.log(`Authenticated via: ${ctx.authenticatedKeyGroup}`);
  }
  return c.json({ group: ctx.authenticatedKeyGroup || "public" });
}
```

### ctx.requestedAt

**Type:** `Date`

Timestamp when the request was received.

```typescript
export default async function (c, ctx) {
  return c.json({
    timestamp: ctx.requestedAt.toISOString()
  });
}
```

### ctx.requestId

**Type:** `string`

Unique UUID for request tracing. Useful for logging and debugging.

```typescript
export default async function (c, ctx) {
  console.log(`Processing request ${ctx.requestId}`);
  return c.json({ requestId: ctx.requestId });
}
```

### ctx.getSecret()

**Signature:**
```typescript
getSecret(
  name: string,
  scope?: "global" | "function" | "group" | "key"
): Promise<string | undefined>
```

Retrieves a secret value. When called without a scope, secrets are resolved hierarchically from most specific to least specific:

1. **Key** - Secret for the authenticated API key
2. **Group** - Secret for the authenticated key group
3. **Function** - Secret for the current function
4. **Global** - Application-wide secret

Returns the first match found, or `undefined` if no secret exists with that name.

```typescript
export default async function (c, ctx) {
  // Hierarchical resolution (key > group > function > global)
  const apiToken = await ctx.getSecret("api_token");

  if (!apiToken) {
    return c.json({ error: "api_token not configured" }, 500);
  }

  const response = await fetch("https://api.example.com/data", {
    headers: { Authorization: `Bearer ${apiToken}` }
  });

  return c.json(await response.json());
}
```

**Explicit scope:**

```typescript
export default async function (c, ctx) {
  // Only retrieve from a specific scope
  const globalConfig = await ctx.getSecret("config", "global");
  const functionKey = await ctx.getSecret("api_key", "function");
  const groupPassword = await ctx.getSecret("db_password", "group");
  const keyToken = await ctx.getSecret("token", "key");

  return c.json({ globalConfig, functionKey, groupPassword, keyToken });
}
```

### ctx.getCompleteSecret()

**Signature:**
```typescript
getCompleteSecret(name: string): Promise<{
  global?: string;
  function?: string;
  group?: { value: string; groupId: number; groupName: string };
  key?: { value: string; groupId: number; groupName: string; keyId: number; keyName: string };
} | undefined>
```

Retrieves a secret's value from all accessible scopes at once, with metadata. Useful for debugging or when you need to know which scope a secret came from.

```typescript
export default async function (c, ctx) {
  const complete = await ctx.getCompleteSecret("db_password");

  if (!complete) {
    return c.json({ error: "db_password not found in any scope" }, 400);
  }

  // See which scopes have this secret
  return c.json({
    hasGlobal: !!complete.global,
    hasFunction: !!complete.function,
    hasGroup: !!complete.group,
    hasKey: !!complete.key,
  });
}
```

## Hono Context (`c`)

The `c` parameter is Hono's standard context object. Here are the most commonly used methods.

### Response Methods

| Method | Description |
|--------|-------------|
| `c.json(data, status?)` | Send JSON response |
| `c.text(text, status?)` | Send plain text |
| `c.html(html, status?)` | Send HTML |
| `c.body(body, status?)` | Send raw body |

```typescript
// JSON response
return c.json({ message: "success" });
return c.json({ error: "not found" }, 404);

// Text response
return c.text("OK");
return c.text("Not found", 404);

// HTML response
return c.html("<h1>Hello</h1>");
```

### Request Properties

| Property | Type | Description |
|----------|------|-------------|
| `c.req.method` | `string` | HTTP method (GET, POST, etc.) |
| `c.req.url` | `string` | Full request URL |
| `c.req.path` | `string` | Request path |
| `c.req.raw` | `Request` | Raw Request object |
| `c.req.raw.headers` | `Headers` | Request headers |

```typescript
export default async function (c, ctx) {
  return c.json({
    method: c.req.method,   // "GET"
    url: c.req.url,         // "http://localhost/run/example?foo=bar"
    path: c.req.path,       // "/run/example"
  });
}
```

### Request Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `c.req.param()` | `Record<string, string>` | All path parameters |
| `c.req.param(key)` | `string \| undefined` | Single path parameter |
| `c.req.header(name)` | `string \| undefined` | Header value |
| `c.req.json()` | `Promise<any>` | Parse JSON body |
| `c.req.text()` | `Promise<string>` | Body as text |
| `c.req.formData()` | `Promise<FormData>` | Parse form data |

```typescript
export default async function (c, ctx) {
  // Headers
  const contentType = c.req.header("content-type");
  const authHeader = c.req.header("authorization");

  // Parse JSON body
  const body = await c.req.json();

  return c.json({ received: body });
}
```

## Quick Reference

| Item | Type | Description |
|------|------|-------------|
| `ctx.route` | `RouteInfo` | Route metadata |
| `ctx.params` | `Record<string, string>` | Path parameters |
| `ctx.query` | `Record<string, string>` | Query parameters |
| `ctx.authenticatedKeyGroup` | `string \| undefined` | Authenticated key group |
| `ctx.requestedAt` | `Date` | Request timestamp |
| `ctx.requestId` | `string` | Unique request UUID |
| `ctx.getSecret(name, scope?)` | `Promise<string \| undefined>` | Get secret hierarchically |
| `ctx.getCompleteSecret(name)` | `Promise<object \| undefined>` | Get secret from all scopes |
| `c.json(data, status?)` | `Response` | Send JSON |
| `c.text(text, status?)` | `Response` | Send text |
| `c.html(html, status?)` | `Response` | Send HTML |
| `c.req.json()` | `Promise<any>` | Parse JSON body |
| `c.req.header(name)` | `string \| undefined` | Get header |

## Complete Examples

### Basic JSON Handler

```typescript
export default async function (c, ctx) {
  return c.json({
    message: "Hello from Crude Functions",
    route: ctx.route.name,
    requestId: ctx.requestId,
  });
}
```

### POST Handler with Validation

```typescript
export default async function (c, ctx) {
  try {
    const body = await c.req.json();

    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }

    return c.json({
      success: true,
      name: body.name,
      requestId: ctx.requestId,
    });
  } catch {
    return c.json({
      error: "Invalid JSON body",
      requestId: ctx.requestId,
    }, 400);
  }
}
```

### Handler with Path and Query Parameters

```typescript
// Route: /users/:id
// URL: /run/users/42?include=email

export default async function (c, ctx) {
  const userId = ctx.params.id;
  const includeEmail = ctx.query.include === "email";

  const user = { id: userId, name: "John" };

  if (includeEmail) {
    user.email = "john@example.com";
  }

  return c.json(user);
}
```

### Handler with External API Call

```typescript
export default async function (c, ctx) {
  const apiKey = await ctx.getSecret("external_api_key");

  if (!apiKey) {
    console.error(`[${ctx.requestId}] Missing external_api_key secret`);
    return c.json({ error: "API not configured" }, 500);
  }

  const response = await fetch("https://api.example.com/data", {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "X-Request-ID": ctx.requestId,
    },
  });

  if (!response.ok) {
    console.error(`[${ctx.requestId}] External API error: ${response.status}`);
    return c.json({ error: "External API error" }, 502);
  }

  return c.json(await response.json());
}
```

### Handler with Authentication Check

```typescript
export default async function (c, ctx) {
  // Route is configured to require API keys
  // ctx.authenticatedKeyGroup is set if auth succeeded

  if (!ctx.authenticatedKeyGroup) {
    return c.json({
      error: "Authentication required",
      requestId: ctx.requestId,
    }, 401);
  }

  // Use group-specific secret
  const dbPassword = await ctx.getSecret("db_password", "group");

  return c.json({
    message: "Authenticated",
    group: ctx.authenticatedKeyGroup,
    hasDbAccess: !!dbPassword,
  });
}
```
