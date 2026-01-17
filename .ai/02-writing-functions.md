# Writing Functions in Crude Functions

This guide shows you how to write serverless-style functions for Crude Functions. If you're familiar with Express.js, Hono, or similar frameworks, you'll feel right at home.

## Table of Contents

- [Quick Start](#quick-start)
- [Handler Structure](#handler-structure)
- [The Hono Context (`c`)](#the-hono-context-c)
- [The Function Context (`ctx`)](#the-function-context-ctx)
- [Importing Packages](#importing-packages)
- [Reading Requests](#reading-requests)
- [Sending Responses](#sending-responses)
- [Working with Secrets](#working-with-secrets)
- [Error Handling](#error-handling)
- [Organizing Your Code](#organizing-your-code)
- [Complete Examples](#complete-examples)

## Quick Start

Every function is a TypeScript file in the `code/` directory that exports a default async function:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  return c.json({ message: "Hello, World!" });
}
```

Register it via the Web UI or API, then call it at `/run/hello`.

## Handler Structure

Every handler receives exactly two parameters:

```typescript
export default async function (c, ctx) {
  // c   = Hono Context - for request/response operations
  // ctx = Function Context - for metadata (params, query, secrets, etc.)

  return c.json({ ok: true });
}
```

### Parameter Reference

| Parameter | Type | Purpose |
|-----------|------|---------|
| `c` | Hono Context | Request/response handling (like Express `req`/`res`) |
| `ctx` | Function Context | Route metadata, params, query, secrets, request ID |

## The Hono Context (`c`)

The `c` parameter is your main interface for reading requests and sending responses. It's similar to Express.js but more modern.

### Reading Request Data

```typescript
export default async function (c, ctx) {
  // Request method
  const method = c.req.method; // "GET", "POST", etc.

  // Full URL
  const url = c.req.url; // "http://localhost:8000/run/users/123?q=test"

  // Path (without /run prefix)
  const path = c.req.path; // "/users/123"

  // Headers
  const authHeader = c.req.header("Authorization");
  const contentType = c.req.header("Content-Type");

  // All headers as object
  const headers = Object.fromEntries(c.req.raw.headers);

  return c.json({ method, url, path, authHeader, contentType });
}
```

### Reading Request Bodies

```typescript
// JSON body
export default async function (c, ctx) {
  const body = await c.req.json();
  // body = { name: "John", email: "john@example.com" }

  return c.json({ received: body });
}
```

```typescript
// Form data (multipart/form-data or application/x-www-form-urlencoded)
export default async function (c, ctx) {
  const formData = await c.req.formData();
  const name = formData.get("name");
  const email = formData.get("email");

  return c.json({ name, email });
}
```

```typescript
// Raw text
export default async function (c, ctx) {
  const text = await c.req.text();
  return c.json({ received: text });
}
```

```typescript
// Raw binary (ArrayBuffer)
export default async function (c, ctx) {
  const buffer = await c.req.arrayBuffer();
  const size = buffer.byteLength;
  return c.json({ size });
}
```

### Path and Query Parameters

```typescript
// For route: /users/:id
export default async function (c, ctx) {
  // Get from Hono context
  const id = c.req.param("id");

  // Or get from Function context (recommended)
  const userId = ctx.params.id;

  return c.json({ id, userId });
}
```

```typescript
// Query parameters: /search?q=hello&page=2
export default async function (c, ctx) {
  // Get from Hono context
  const q = c.req.query("q");

  // Or get from Function context (recommended)
  const query = ctx.query.q;
  const page = ctx.query.page;

  return c.json({ q, query, page });
}
```

### Sending Responses

```typescript
// JSON response (most common)
return c.json({ message: "Success" });
return c.json({ error: "Not found" }, 404);
return c.json(data, 201); // Created
```

```typescript
// Plain text
return c.text("Hello, World!");
return c.text("Not found", 404);
```

```typescript
// HTML
return c.html("<h1>Hello</h1>");
return c.html("<h1>Not found</h1>", 404);
```

```typescript
// Redirect
return c.redirect("/other-path");
return c.redirect("/login", 301); // Permanent redirect
return c.redirect("https://example.com", 302); // Temporary
```

```typescript
// Custom response
return new Response("Custom body", {
  status: 201,
  headers: {
    "X-Custom-Header": "value",
    "Content-Type": "application/xml",
  },
});
```

```typescript
// Stream a file
const file = await Deno.open("/path/to/file.pdf");
return new Response(file.readable, {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="file.pdf"',
  },
});
```

## The Function Context (`ctx`)

The `ctx` parameter provides metadata about the current request and route.

### Available Properties

```typescript
export default async function (c, ctx) {
  // Path parameters as object
  const params = ctx.params; // { id: "123", slug: "hello" }

  // Query parameters as object
  const query = ctx.query; // { q: "search", page: "2" }

  // Unique request ID (for logging/tracing)
  const requestId = ctx.requestId; // "550e8400-e29b-41d4-a716-446655440000"

  // Request timestamp
  const timestamp = ctx.requestedAt; // Date object

  // Authenticated API key group (if route requires auth)
  const keyGroup = ctx.authenticatedKeyGroup; // "api" or undefined

  // Route information
  const routeName = ctx.route.name; // "get-user"
  const routePath = ctx.route.route; // "/users/:id"
  const methods = ctx.route.methods; // ["GET"]
  const handler = ctx.route.handler; // "users/get.ts"
  const description = ctx.route.description; // "Get user by ID"
  const requiredKeys = ctx.route.keys; // [1, 2] (key group IDs)

  return c.json({ requestId, timestamp, keyGroup, routeName });
}
```

### Secrets (see dedicated section below)

```typescript
// Get secret with hierarchical resolution (most specific scope wins)
const apiKey = await ctx.getSecret("STRIPE_API_KEY");

// Get secret from specific scope
const globalDefault = await ctx.getSecret("SMTP_HOST", "global");

// Get complete secret info across all scopes
const details = await ctx.getCompleteSecret("API_KEY");
```

## Importing Packages

### Relative Imports (Your Code)

Import other files from your `code/` directory using relative paths:

```typescript
// code/users/get.ts
import { db } from "../lib/database.ts";
import { validateUserId } from "../lib/validators.ts";
import type { User } from "../types.ts";

export default async function (c, ctx) {
  const userId = ctx.params.id;

  if (!validateUserId(userId)) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const user = await db.getUser(userId);
  return c.json(user);
}
```

### External Packages

Always use full specifiers for external packages:

```typescript
// NPM packages - prefix with npm:
import { camelCase, snakeCase } from "npm:lodash-es";
import dayjs from "npm:dayjs";
import { nanoid } from "npm:nanoid";

// JSR packages - prefix with jsr:
import { z } from "jsr:@std/zod";
import * as path from "jsr:@std/path";

// URL imports - full URL
import confetti from "https://esm.sh/canvas-confetti";
import { marked } from "https://esm.sh/marked@12.0.0";

export default async function (c, ctx) {
  const id = nanoid();
  const date = dayjs().format("YYYY-MM-DD");

  return c.json({ id, date });
}
```

**Important:** Short aliases won't work. Use `npm:zod`, not `"zod"`.

### Version Pinning

Pin versions for stability:

```typescript
// Recommended: pin versions
import { z } from "npm:zod@3.22.4";
import dayjs from "npm:dayjs@1.11.10";

// Also works: semver ranges
import { z } from "npm:zod@^3.22.0";

// Not recommended: unpinned (gets latest, may break)
import { z } from "npm:zod";
```

## Reading Requests

### JSON APIs

```typescript
// POST /api/users
export default async function (c, ctx) {
  const body = await c.req.json();

  // Validate required fields
  if (!body.email || !body.name) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Create user
  const user = {
    id: crypto.randomUUID(),
    email: body.email,
    name: body.name,
    createdAt: new Date().toISOString(),
  };

  // Save to database...

  return c.json(user, 201);
}
```

### Form Submissions

```typescript
// POST /contact
export default async function (c, ctx) {
  const formData = await c.req.formData();

  const name = formData.get("name");
  const email = formData.get("email");
  const message = formData.get("message");

  // Validate
  if (!name || !email || !message) {
    return c.html(`
      <h1>Error</h1>
      <p>All fields are required</p>
      <a href="/contact">Go back</a>
    `, 400);
  }

  // Process form...

  return c.html("<h1>Thank you!</h1><p>We'll be in touch.</p>");
}
```

### File Uploads

```typescript
// POST /upload
export default async function (c, ctx) {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return c.json({ error: "No file uploaded" }, 400);
  }

  // Check file type
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Only images allowed" }, 400);
  }

  // Check file size (5MB limit)
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: "File too large" }, 400);
  }

  // Save file
  const bytes = await file.arrayBuffer();
  const filename = `uploads/${crypto.randomUUID()}-${file.name}`;
  await Deno.writeFile(filename, new Uint8Array(bytes));

  return c.json({ filename, size: file.size });
}
```

### Query String Parsing

```typescript
// GET /search?q=laptop&category=electronics&minPrice=100&maxPrice=500
export default async function (c, ctx) {
  const q = ctx.query.q || "";
  const category = ctx.query.category;
  const minPrice = parseInt(ctx.query.minPrice || "0");
  const maxPrice = parseInt(ctx.query.maxPrice || "999999");

  // Search logic...
  const results = await searchProducts(q, category, minPrice, maxPrice);

  return c.json({
    query: q,
    filters: { category, minPrice, maxPrice },
    results,
    count: results.length,
  });
}
```

### Headers and Authentication

```typescript
export default async function (c, ctx) {
  // Check custom auth header
  const apiToken = c.req.header("X-API-Token");

  if (!apiToken) {
    return c.json({ error: "Missing API token" }, 401);
  }

  // Bearer token
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // Validate token...
  }

  // User agent
  const userAgent = c.req.header("User-Agent");

  // Origin (for CORS)
  const origin = c.req.header("Origin");

  return c.json({ apiToken, userAgent, origin });
}
```

## Sending Responses

### JSON APIs

```typescript
// Success response
return c.json({ message: "User created", id: "123" }, 201);

// Error response
return c.json({ error: "User not found" }, 404);

// List response
return c.json({
  data: users,
  count: users.length,
  page: 1,
  total: 100,
});

// With custom headers
const response = c.json({ message: "OK" });
response.headers.set("X-Rate-Limit", "100");
response.headers.set("X-Request-ID", ctx.requestId);
return response;
```

### HTML Pages

```typescript
export default async function (c, ctx) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Welcome</title>
        <meta charset="utf-8">
      </head>
      <body>
        <h1>Hello, ${ctx.query.name || "Guest"}!</h1>
        <p>Request ID: ${ctx.requestId}</p>
      </body>
    </html>
  `;

  return c.html(html);
}
```

### Streaming Responses

```typescript
// Server-Sent Events (SSE)
export default async function (c, ctx) {
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 10; i++) {
        const data = `data: ${JSON.stringify({ count: i })}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

### CORS Headers

```typescript
export default async function (c, ctx) {
  const response = c.json({ message: "OK" });

  // Allow all origins (not recommended for production)
  response.headers.set("Access-Control-Allow-Origin", "*");

  // Or specific origin
  const origin = c.req.header("Origin");
  if (origin === "https://yourapp.com") {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return response;
}
```

### Content Types

```typescript
// JSON (default)
return c.json({ data: "value" });
// Content-Type: application/json

// Plain text
return c.text("Hello");
// Content-Type: text/plain

// HTML
return c.html("<h1>Hello</h1>");
// Content-Type: text/html

// XML
return new Response(`<?xml version="1.0"?><root><item>value</item></root>`, {
  headers: { "Content-Type": "application/xml" },
});

// CSV
const csv = "name,email\nJohn,john@example.com";
return new Response(csv, {
  headers: {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="users.csv"',
  },
});

// Binary data
const pdfBytes = new Uint8Array([/* ... */]);
return new Response(pdfBytes, {
  headers: { "Content-Type": "application/pdf" },
});
```

## Working with Secrets

Secrets are encrypted values that can be scoped to different levels. Use them for API keys, database credentials, and other sensitive data.

### Basic Usage

```typescript
export default async function (c, ctx) {
  // Get secret (hierarchical resolution: key > group > function > global)
  const apiKey = await ctx.getSecret("STRIPE_API_KEY");

  if (!apiKey) {
    return c.json({ error: "Stripe API key not configured" }, 500);
  }

  // Use the secret
  const stripe = new Stripe(apiKey);
  const charge = await stripe.charges.create({
    amount: 1000,
    currency: "usd",
    source: "tok_visa",
  });

  return c.json({ chargeId: charge.id });
}
```

### Loading Multiple Secrets

```typescript
export default async function (c, ctx) {
  // Load multiple secrets in parallel (more efficient)
  const [smtpHost, smtpUser, smtpPass, smtpPort] = await Promise.all([
    ctx.getSecret("SMTP_HOST"),
    ctx.getSecret("SMTP_USER"),
    ctx.getSecret("SMTP_PASS"),
    ctx.getSecret("SMTP_PORT"),
  ]);

  // Check if all required secrets are present
  if (!smtpHost || !smtpUser || !smtpPass) {
    return c.json({ error: "SMTP not configured" }, 500);
  }

  // Use secrets...
  const port = parseInt(smtpPort || "587");

  return c.json({ host: smtpHost, port });
}
```

### Scope-Specific Access

```typescript
export default async function (c, ctx) {
  // Get from specific scope
  const globalDefault = await ctx.getSecret("LOG_LEVEL", "global");
  const functionOverride = await ctx.getSecret("LOG_LEVEL", "function");
  const groupOverride = await ctx.getSecret("LOG_LEVEL", "group");
  const keyOverride = await ctx.getSecret("LOG_LEVEL", "key");

  // Get complete details across all scopes
  const details = await ctx.getCompleteSecret("LOG_LEVEL");
  // {
  //   global: "info",
  //   function: "debug",
  //   group: { value: "warn", groupId: 5, groupName: "admin" },
  //   key: { value: "error", groupId: 5, groupName: "admin", keyId: 10, keyName: "prod-key" }
  // }

  return c.json({ globalDefault, details });
}
```

### Scope Resolution Order

Secrets follow this resolution order (most specific wins):

1. **Key** - Specific to a single API key
2. **Group** - Shared across all keys in a group
3. **Function** - Specific to this function
4. **Global** - Available to all functions

Example:

```typescript
// Global: DATABASE_URL=sqlite:///default.db
// Function: DATABASE_URL=sqlite:///myfunction.db
// Group: (not set)
// Key: DATABASE_URL=sqlite:///customer-specific.db

export default async function (c, ctx) {
  const dbUrl = await ctx.getSecret("DATABASE_URL");
  // Returns: sqlite:///customer-specific.db (key scope wins)
}
```

### Public Routes (No Authentication)

For routes that don't require API keys, only global and function-scoped secrets are available:

```typescript
// Route configured with: keys: []
export default async function (c, ctx) {
  const globalSecret = await ctx.getSecret("GLOBAL_API_KEY");
  // ✅ Works - function and global scopes available

  const groupSecret = await ctx.getSecret("GROUP_SECRET");
  // ❌ Returns undefined - no authenticated key group

  return c.json({ globalSecret });
}
```

## Error Handling

### Basic Error Handling

```typescript
export default async function (c, ctx) {
  try {
    const data = await fetchDataFromAPI();
    return c.json(data);
  } catch (error) {
    console.error(`[${ctx.requestId}] Error:`, error);

    return c.json({
      error: "Failed to fetch data",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Validation Errors

```typescript
import { z } from "jsr:@std/zod";

const UserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(120).optional(),
});

export default async function (c, ctx) {
  const body = await c.req.json();
  const result = UserSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: "Validation failed",
      issues: result.error.issues,
    }, 400);
  }

  const user = result.data;
  // user is now typed and validated

  return c.json(user, 201);
}
```

### Custom Error Classes

```typescript
class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

class ValidationError extends Error {
  constructor(message: string, public issues: string[]) {
    super(message);
    this.name = "ValidationError";
  }
}

export default async function (c, ctx) {
  try {
    const userId = ctx.params.id;
    const user = await getUser(userId);

    if (!user) {
      throw new NotFoundError(`User ${userId} not found`);
    }

    return c.json(user);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (error instanceof ValidationError) {
      return c.json({ error: error.message, issues: error.issues }, 400);
    }

    console.error(`[${ctx.requestId}] Unexpected error:`, error);
    return c.json({
      error: "Internal server error",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### Graceful Degradation

```typescript
export default async function (c, ctx) {
  // Try to get data from cache, fall back to database
  let data;

  try {
    data = await cache.get(ctx.params.id);
  } catch (error) {
    console.warn(`[${ctx.requestId}] Cache error:`, error);
    // Fall back to database
    try {
      data = await db.get(ctx.params.id);
    } catch (error) {
      console.error(`[${ctx.requestId}] Database error:`, error);
      return c.json({ error: "Service unavailable" }, 503);
    }
  }

  return c.json(data);
}
```

## Organizing Your Code

### Shared Utilities

Create reusable modules in your `code/` directory:

```typescript
// code/lib/database.ts
export class Database {
  constructor(private dbPath: string) {}

  async getUser(id: string) {
    // Implementation...
    return { id, name: "John" };
  }

  async createUser(data: { name: string; email: string }) {
    // Implementation...
    return { id: crypto.randomUUID(), ...data };
  }
}

// code/lib/validators.ts
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateUserId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// code/users/get.ts
import { Database } from "../lib/database.ts";
import { validateUserId } from "../lib/validators.ts";

const db = new Database("./data/users.db");

export default async function (c, ctx) {
  if (!validateUserId(ctx.params.id)) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const user = await db.getUser(ctx.params.id);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
}
```

### Shared Types

```typescript
// code/types.ts
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Post {
  id: string;
  userId: string;
  title: string;
  content: string;
  publishedAt: string;
}

// code/users/get.ts
import type { User } from "../types.ts";

export default async function (c, ctx): Promise<Response> {
  const user: User = await getUser(ctx.params.id);
  return c.json(user);
}
```

### Directory Structure

Organize by feature or resource:

```
code/
  lib/
    database.ts          # Database utilities
    validators.ts        # Input validation
    auth.ts              # Authentication helpers
    logger.ts            # Logging utilities
  types.ts               # Shared TypeScript types
  users/
    get.ts               # GET /users/:id
    create.ts            # POST /users
    update.ts            # PUT /users/:id
    delete.ts            # DELETE /users/:id
    list.ts              # GET /users
  posts/
    get.ts               # GET /posts/:id
    create.ts            # POST /posts
    list.ts              # GET /posts
  webhooks/
    stripe.ts            # POST /webhooks/stripe
    github.ts            # POST /webhooks/github
```

## Complete Examples

### REST API - CRUD Operations

```typescript
// code/users/list.ts - GET /users
export default async function (c, ctx) {
  const page = parseInt(ctx.query.page || "1");
  const limit = parseInt(ctx.query.limit || "20");
  const offset = (page - 1) * limit;

  // Get users from database
  const users = await db.users.findMany({
    skip: offset,
    take: limit,
  });

  const total = await db.users.count();

  return c.json({
    data: users,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}
```

```typescript
// code/users/get.ts - GET /users/:id
export default async function (c, ctx) {
  const userId = ctx.params.id;

  const user = await db.users.findById(userId);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
}
```

```typescript
// code/users/create.ts - POST /users
import { z } from "jsr:@std/zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["user", "admin"]).default("user"),
});

export default async function (c, ctx) {
  const body = await c.req.json();
  const result = CreateUserSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: "Validation failed",
      issues: result.error.issues,
    }, 400);
  }

  // Check if email already exists
  const existing = await db.users.findByEmail(result.data.email);
  if (existing) {
    return c.json({ error: "Email already in use" }, 409);
  }

  const user = await db.users.create({
    id: crypto.randomUUID(),
    ...result.data,
    createdAt: new Date().toISOString(),
  });

  return c.json(user, 201);
}
```

```typescript
// code/users/update.ts - PUT /users/:id
import { z } from "jsr:@std/zod";

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["user", "admin"]).optional(),
});

export default async function (c, ctx) {
  const userId = ctx.params.id;

  const body = await c.req.json();
  const result = UpdateUserSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: "Validation failed",
      issues: result.error.issues,
    }, 400);
  }

  const user = await db.users.update(userId, result.data);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
}
```

```typescript
// code/users/delete.ts - DELETE /users/:id
export default async function (c, ctx) {
  const userId = ctx.params.id;

  const deleted = await db.users.delete(userId);

  if (!deleted) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ message: "User deleted" }, 200);
}
```

### Webhook Handler

```typescript
// code/webhooks/stripe.ts - POST /webhooks/stripe
import Stripe from "npm:stripe";

export default async function (c, ctx) {
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing signature" }, 400);
  }

  // Get webhook secret from secrets
  const webhookSecret = await ctx.getSecret("STRIPE_WEBHOOK_SECRET");
  const apiKey = await ctx.getSecret("STRIPE_API_KEY");

  if (!webhookSecret || !apiKey) {
    console.error(`[${ctx.requestId}] Stripe secrets not configured`);
    return c.json({ error: "Configuration error" }, 500);
  }

  const stripe = new Stripe(apiKey, { apiVersion: "2023-10-16" });

  // Verify webhook signature
  const rawBody = await c.req.text();
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error(`[${ctx.requestId}] Webhook signature verification failed:`, error);
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Handle different event types
  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;
      console.log(`Payment ${paymentIntent.id} succeeded`);
      await handlePaymentSuccess(paymentIntent);
      break;

    case "payment_intent.payment_failed":
      const failedPayment = event.data.object;
      console.log(`Payment ${failedPayment.id} failed`);
      await handlePaymentFailure(failedPayment);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return c.json({ received: true });
}

async function handlePaymentSuccess(payment: any) {
  // Update order status, send confirmation email, etc.
}

async function handlePaymentFailure(payment: any) {
  // Send failure notification, update order status, etc.
}
```

### GitHub Webhook

```typescript
// code/webhooks/github.ts - POST /webhooks/github
import { crypto } from "jsr:@std/crypto";

export default async function (c, ctx) {
  // Verify GitHub signature
  const signature = c.req.header("X-Hub-Signature-256");
  const rawBody = await c.req.text();

  const secret = await ctx.getSecret("GITHUB_WEBHOOK_SECRET");
  if (!secret) {
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const expectedSignature = await generateGitHubSignature(rawBody, secret);

  if (signature !== expectedSignature) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse payload
  const payload = JSON.parse(rawBody);
  const event = c.req.header("X-GitHub-Event");

  console.log(`Received GitHub ${event} event`);

  // Handle different events
  switch (event) {
    case "push":
      await handlePush(payload);
      break;

    case "pull_request":
      await handlePullRequest(payload);
      break;

    case "issues":
      await handleIssue(payload);
      break;

    default:
      console.log(`Unhandled event: ${event}`);
  }

  return c.json({ message: "Webhook processed" });
}

async function generateGitHubSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return `sha256=${hex}`;
}

async function handlePush(payload: any) {
  console.log(`Push to ${payload.ref} by ${payload.pusher.name}`);
  // Trigger deployment, run tests, etc.
}

async function handlePullRequest(payload: any) {
  console.log(`PR #${payload.number}: ${payload.action}`);
  // Run CI checks, post comments, etc.
}

async function handleIssue(payload: any) {
  console.log(`Issue #${payload.issue.number}: ${payload.action}`);
  // Auto-label, assign, etc.
}
```

### Scheduled Task (via cron + curl)

Functions don't have built-in scheduling, but you can trigger them via cron:

```typescript
// code/tasks/cleanup.ts - POST /tasks/cleanup
// Triggered by cron: 0 2 * * * curl -X POST -H "X-API-Key: $KEY" http://localhost:8000/run/tasks/cleanup

export default async function (c, ctx) {
  console.log(`Starting cleanup task at ${new Date().toISOString()}`);

  try {
    // Delete old logs (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedLogs = await db.logs.deleteOlderThan(thirtyDaysAgo);
    console.log(`Deleted ${deletedLogs} old logs`);

    // Delete expired sessions
    const deletedSessions = await db.sessions.deleteExpired();
    console.log(`Deleted ${deletedSessions} expired sessions`);

    // Vacuum database
    await db.vacuum();
    console.log("Database vacuumed");

    return c.json({
      success: true,
      deletedLogs,
      deletedSessions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Cleanup task failed:`, error);
    return c.json({
      success: false,
      error: error.message,
      requestId: ctx.requestId,
    }, 500);
  }
}
```

Set up cron (on the host or in a separate container):

```bash
# /etc/cron.d/crude-functions
# Run cleanup daily at 2 AM
0 2 * * * curl -X POST -H "X-API-Key: your-management-key" http://localhost:8000/run/tasks/cleanup

# Run backup every hour
0 * * * * curl -X POST -H "X-API-Key: your-management-key" http://localhost:8000/run/tasks/backup

# Send daily report at 9 AM
0 9 * * * curl -X POST -H "X-API-Key: your-management-key" http://localhost:8000/run/tasks/daily-report
```

### API Gateway / Proxy

```typescript
// code/proxy/api.ts - ALL /proxy/*
// Forward requests to external API with authentication

export default async function (c, ctx) {
  // Get API credentials from secrets
  const apiKey = await ctx.getSecret("EXTERNAL_API_KEY");
  const apiUrl = await ctx.getSecret("EXTERNAL_API_URL");

  if (!apiKey || !apiUrl) {
    return c.json({ error: "API not configured" }, 500);
  }

  // Build target URL (strip /proxy prefix)
  const path = c.req.path.replace(/^\/proxy/, "");
  const targetUrl = `${apiUrl}${path}`;

  // Forward request
  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": c.req.header("Content-Type") || "application/json",
    },
    body: ["POST", "PUT", "PATCH"].includes(c.req.method)
      ? await c.req.arrayBuffer()
      : undefined,
  });

  // Forward response
  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    },
  });
}
```

### Rate Limiting

```typescript
// code/lib/rate-limit.ts
interface RateLimit {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimit>();

export function checkRateLimit(key: string, limit: number, windowMs: number): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  let rateLimit = rateLimits.get(key);

  // Clean up expired entries
  if (rateLimit && now > rateLimit.resetAt) {
    rateLimits.delete(key);
    rateLimit = undefined;
  }

  // Initialize or increment
  if (!rateLimit) {
    rateLimit = { count: 1, resetAt: now + windowMs };
    rateLimits.set(key, rateLimit);
  } else {
    rateLimit.count++;
  }

  return {
    allowed: rateLimit.count <= limit,
    remaining: Math.max(0, limit - rateLimit.count),
    resetAt: rateLimit.resetAt,
  };
}

// code/api/search.ts - GET /api/search
import { checkRateLimit } from "../lib/rate-limit.ts";

export default async function (c, ctx) {
  // Rate limit by API key group or IP
  const key = ctx.authenticatedKeyGroup || c.req.header("CF-Connecting-IP") || "anonymous";

  // 100 requests per minute
  const limit = checkRateLimit(key, 100, 60 * 1000);

  if (!limit.allowed) {
    return c.json({
      error: "Rate limit exceeded",
      resetAt: new Date(limit.resetAt).toISOString(),
    }, 429);
  }

  // Add rate limit headers
  const response = c.json({
    results: await search(ctx.query.q),
  });

  response.headers.set("X-RateLimit-Limit", "100");
  response.headers.set("X-RateLimit-Remaining", limit.remaining.toString());
  response.headers.set("X-RateLimit-Reset", limit.resetAt.toString());

  return response;
}
```

### Database Connection Pooling

```typescript
// code/lib/db.ts
import { Client } from "npm:pg";

class DatabasePool {
  private pool: Client[] = [];
  private readonly maxSize = 10;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async getConnection(): Promise<Client> {
    // Reuse existing connection
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }

    // Create new connection
    const client = new Client(this.connectionString);
    await client.connect();
    return client;
  }

  async releaseConnection(client: Client) {
    if (this.pool.length < this.maxSize) {
      this.pool.push(client);
    } else {
      await client.end();
    }
  }

  async query(sql: string, params: any[] = []) {
    const client = await this.getConnection();
    try {
      const result = await client.query(sql, params);
      return result;
    } finally {
      await this.releaseConnection(client);
    }
  }
}

// Initialize once (module-level)
let db: DatabasePool | null = null;

export async function getDatabase(ctx: any): Promise<DatabasePool> {
  if (!db) {
    const connectionString = await ctx.getSecret("DATABASE_URL");
    if (!connectionString) {
      throw new Error("DATABASE_URL not configured");
    }
    db = new DatabasePool(connectionString);
  }
  return db;
}

// code/users/list.ts
import { getDatabase } from "../lib/db.ts";

export default async function (c, ctx) {
  const db = await getDatabase(ctx);

  const result = await db.query(
    "SELECT id, name, email FROM users ORDER BY created_at DESC LIMIT $1",
    [20]
  );

  return c.json({ users: result.rows });
}
```

### Image Processing

```typescript
// code/images/thumbnail.ts - GET /images/thumbnail?url=...&width=200&height=200
import { Image } from "npm:imagescript";

export default async function (c, ctx) {
  const imageUrl = ctx.query.url;
  const width = parseInt(ctx.query.width || "200");
  const height = parseInt(ctx.query.height || "200");

  if (!imageUrl) {
    return c.json({ error: "Missing url parameter" }, 400);
  }

  try {
    // Fetch original image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return c.json({ error: "Failed to fetch image" }, 400);
    }

    const buffer = await response.arrayBuffer();

    // Decode and resize
    const image = await Image.decode(new Uint8Array(buffer));
    image.resize(width, height);

    // Encode to JPEG
    const thumbnail = await image.encodeJPEG(80);

    return new Response(thumbnail, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(`[${ctx.requestId}] Image processing failed:`, error);
    return c.json({
      error: "Image processing failed",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

### HTML Form with Server-Side Rendering

```typescript
// code/contact.ts - GET /contact
export default async function (c, ctx) {
  const method = c.req.method;

  // GET - Show form
  if (method === "GET") {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Contact Us</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            label { display: block; margin-top: 15px; font-weight: bold; }
            input, textarea { width: 100%; padding: 8px; margin-top: 5px; }
            button { margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; }
            button:hover { background: #0056b3; }
            .error { color: red; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h1>Contact Us</h1>
          <form method="POST">
            <label>Name <input type="text" name="name" required></label>
            <label>Email <input type="email" name="email" required></label>
            <label>Message <textarea name="message" rows="5" required></textarea></label>
            <button type="submit">Send</button>
          </form>
        </body>
      </html>
    `);
  }

  // POST - Process form
  if (method === "POST") {
    const formData = await c.req.formData();
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const message = formData.get("message") as string;

    // Validate
    if (!name || !email || !message) {
      return c.html(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Error</h1>
            <p>All fields are required</p>
            <a href="/contact">Go back</a>
          </body>
        </html>
      `, 400);
    }

    // Send email (example)
    try {
      await sendEmail({
        to: "support@example.com",
        subject: `Contact form: ${name}`,
        body: `From: ${name} (${email})\n\n${message}`,
      });

      return c.html(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Thank You!</h1>
            <p>We'll get back to you soon.</p>
            <a href="/">Home</a>
          </body>
        </html>
      `);
    } catch (error) {
      console.error(`Failed to send email:`, error);
      return c.html(`
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Error</h1>
            <p>Failed to send message. Please try again.</p>
            <a href="/contact">Go back</a>
          </body>
        </html>
      `, 500);
    }
  }

  return c.json({ error: "Method not allowed" }, 405);
}

async function sendEmail(options: { to: string; subject: string; body: string }) {
  // Implementation...
}
```

## Tips and Best Practices

### 1. Use Request IDs for Logging

Always include the request ID in logs for traceability:

```typescript
console.log(`[${ctx.requestId}] Processing request`);
console.error(`[${ctx.requestId}] Error:`, error);
```

### 2. Validate Input Early

Fail fast on invalid input:

```typescript
if (!ctx.params.id) {
  return c.json({ error: "Missing ID" }, 400);
}

const schema = z.object({ email: z.string().email() });
const result = schema.safeParse(body);
if (!result.success) {
  return c.json({ error: "Invalid input" }, 400);
}
```

### 3. Use Secrets for Sensitive Data

Never hardcode API keys, passwords, or tokens:

```typescript
// ❌ Bad
const apiKey = "sk_live_abc123";

// ✅ Good
const apiKey = await ctx.getSecret("STRIPE_API_KEY");
```

### 4. Return Appropriate Status Codes

Use HTTP status codes correctly:

- `200` - Success
- `201` - Created
- `400` - Bad request (validation error)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (authenticated but not allowed)
- `404` - Not found
- `409` - Conflict (e.g., duplicate email)
- `500` - Internal server error

### 5. Handle Errors Gracefully

Always catch errors and return meaningful responses:

```typescript
try {
  const result = await operation();
  return c.json(result);
} catch (error) {
  console.error(`[${ctx.requestId}] Error:`, error);
  return c.json({ error: "Operation failed", requestId: ctx.requestId }, 500);
}
```

### 6. Use TypeScript Types

Add types for better IDE support and fewer bugs:

```typescript
interface User {
  id: string;
  email: string;
  name: string;
}

export default async function (c, ctx): Promise<Response> {
  const user: User = await getUser(ctx.params.id);
  return c.json(user);
}
```

### 7. Keep Functions Focused

Each function should do one thing well. Split complex logic into multiple routes:

```
✅ Good: /users/create, /users/verify-email, /users/reset-password
❌ Bad: /users/manage (does everything)
```

### 8. Cache Expensive Operations

Cache results when appropriate:

```typescript
const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached(key: string) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  return null;
}

function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
```

### 9. Test Functions Locally

Test functions easily with curl:

```bash
# GET request
curl http://localhost:8000/run/users/123

# POST with JSON
curl -X POST http://localhost:8000/run/users \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}'

# With API key
curl -H "X-API-Key: your-key" http://localhost:8000/run/protected
```

### 10. Monitor and Log

Log important events for debugging:

```typescript
console.log(`[${ctx.requestId}] User ${userId} logged in`);
console.warn(`[${ctx.requestId}] Slow query: ${duration}ms`);
console.error(`[${ctx.requestId}] Failed to process payment:`, error);
```

## What's Next?

- Explore the [Web UI](/web) to manage functions, keys, and secrets
- Check the [API documentation](/api) for programmatic management
- Review [function_handler_design.md](../function_handler_design.md) for technical details
- Look at [CLAUDE.md](../CLAUDE.md) for architecture overview
