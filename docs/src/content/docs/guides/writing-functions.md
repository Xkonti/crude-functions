---
title: Writing Functions
description: Complete guide to writing function handlers
---

This guide covers everything you need to write serverless-style functions for Crude Functions. If you're familiar with Express.js, Hono, or similar frameworks, you'll feel right at home.

## Handler Structure

Every function is a TypeScript file in the `code/` directory that exports a default async function:

```typescript
// code/hello.ts
export default async function (c, ctx) {
  return c.json({ message: "Hello, World!" });
}
```

### Parameters

Every handler receives exactly two parameters:

| Parameter | Type | Purpose |
|-----------|------|---------|
| `c` | Hono Context | Request/response handling (like Express `req`/`res`) |
| `ctx` | Function Context | Route metadata, params, query, secrets, request ID |

```typescript
export default async function (c, ctx) {
  // c   = Hono Context - for request/response operations
  // ctx = Function Context - for metadata (params, query, secrets, etc.)

  return c.json({ ok: true });
}
```

## The Hono Context (c)

The `c` parameter is your main interface for reading requests and sending responses.

### Request Properties

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

  return c.json({ method, url, path, authHeader });
}
```

### Reading Request Bodies

**JSON Body:**

```typescript
export default async function (c, ctx) {
  const body = await c.req.json();
  // body = { name: "John", email: "john@example.com" }

  return c.json({ received: body });
}
```

**Form Data:**

```typescript
// multipart/form-data or application/x-www-form-urlencoded
export default async function (c, ctx) {
  const formData = await c.req.formData();
  const name = formData.get("name");
  const email = formData.get("email");

  return c.json({ name, email });
}
```

**Raw Text:**

```typescript
export default async function (c, ctx) {
  const text = await c.req.text();
  return c.json({ received: text });
}
```

**Raw Binary:**

```typescript
export default async function (c, ctx) {
  const buffer = await c.req.arrayBuffer();
  const size = buffer.byteLength;
  return c.json({ size });
}
```

### Path and Query Parameters

**Path parameters:**

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

**Query parameters:**

```typescript
// For URL: /search?q=hello&page=2
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

**JSON responses (most common):**

```typescript
// Success
return c.json({ message: "User created" }, 201);

// Error
return c.json({ error: "Not found" }, 404);

// With custom headers
const response = c.json({ message: "OK" });
response.headers.set("X-Custom-Header", "value");
return response;
```

**Text responses:**

```typescript
return c.text("Hello, World!");
return c.text("Not found", 404);
```

**HTML responses:**

```typescript
return c.html("<h1>Hello</h1>");
return c.html("<h1>Not found</h1>", 404);
```

**Redirects:**

```typescript
return c.redirect("/other-path");
return c.redirect("/login", 301); // Permanent redirect
return c.redirect("https://example.com", 302); // Temporary
```

**Custom responses:**

```typescript
return new Response("Custom body", {
  status: 201,
  headers: {
    "X-Custom-Header": "value",
    "Content-Type": "application/xml",
  },
});
```

**Streaming files:**

```typescript
const file = await Deno.open("/path/to/file.pdf");
return new Response(file.readable, {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="file.pdf"',
  },
});
```

## The Function Context (ctx)

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

  return c.json({ requestId, timestamp, keyGroup });
}
```

### Working with Secrets

**Basic usage:**

```typescript
export default async function (c, ctx) {
  // Get secret (hierarchical resolution: key > group > function > global)
  const apiKey = await ctx.getSecret("STRIPE_API_KEY");

  if (!apiKey) {
    return c.json({ error: "Stripe API key not configured" }, 500);
  }

  // Use the secret
  return c.json({ status: "ok" });
}
```

**Multiple secrets in parallel:**

```typescript
export default async function (c, ctx) {
  const [smtpHost, smtpUser, smtpPass, smtpPort] = await Promise.all([
    ctx.getSecret("SMTP_HOST"),
    ctx.getSecret("SMTP_USER"),
    ctx.getSecret("SMTP_PASS"),
    ctx.getSecret("SMTP_PORT"),
  ]);

  if (!smtpHost || !smtpUser || !smtpPass) {
    return c.json({ error: "SMTP not configured" }, 500);
  }

  return c.json({ configured: true });
}
```

**Scope-specific access:**

```typescript
export default async function (c, ctx) {
  // Get from specific scope
  const globalDefault = await ctx.getSecret("LOG_LEVEL", "global");
  const functionOverride = await ctx.getSecret("LOG_LEVEL", "function");

  // Get complete details across all scopes
  const details = await ctx.getCompleteSecret("LOG_LEVEL");

  return c.json({ globalDefault, details });
}
```

**Secret resolution order:**

Secrets follow this priority (most specific wins):

1. **Key** - Specific to a single API key
2. **Group** - Shared across all keys in a group
3. **Function** - Specific to this function
4. **Global** - Available to all functions

```typescript
// Example: DATABASE_URL
// Global:   sqlite:///default.db
// Function: sqlite:///myfunction.db
// Group:    (not set)
// Key:      sqlite:///customer-specific.db

export default async function (c, ctx) {
  const dbUrl = await ctx.getSecret("DATABASE_URL");
  // Returns: sqlite:///customer-specific.db (key scope wins)
}
```

## Importing Packages

### Relative Imports

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

### NPM Packages

Always use the `npm:` prefix for NPM packages:

```typescript
import { camelCase, snakeCase } from "npm:lodash-es";
import dayjs from "npm:dayjs";
import { nanoid } from "npm:nanoid";
import Stripe from "npm:stripe";

export default async function (c, ctx) {
  const id = nanoid();
  const date = dayjs().format("YYYY-MM-DD");

  return c.json({ id, date });
}
```

**Important:** Short aliases won't work. Use `npm:zod`, not `"zod"`.

### JSR Packages

Use the `jsr:` prefix for JSR packages:

```typescript
import { z } from "jsr:@std/zod";
import * as path from "jsr:@std/path";
import { parse } from "jsr:@std/yaml";

export default async function (c, ctx) {
  const schema = z.object({
    name: z.string(),
    email: z.string().email(),
  });

  const body = await c.req.json();
  const result = schema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Validation failed" }, 400);
  }

  return c.json(result.data);
}
```

### URL Imports

Import packages directly from URLs:

```typescript
import confetti from "https://esm.sh/canvas-confetti";
import { marked } from "https://esm.sh/marked@12.0.0";
import { z } from "https://deno.land/x/zod/mod.ts";

export default async function (c, ctx) {
  const html = marked("# Hello World");
  return c.html(html);
}
```

### Version Pinning

Pin versions for stability:

```typescript
// Recommended: pin exact versions
import { z } from "npm:zod@3.22.4";
import dayjs from "npm:dayjs@1.11.10";

// Also works: semver ranges
import { z } from "npm:zod@^3.22.0";

// Not recommended: unpinned (gets latest, may break)
import { z } from "npm:zod";
```

**Best practice:** Always pin versions in production handlers to avoid unexpected breakage.

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

## TypeScript Types

### Adding Type Hints

```typescript
import type { Context } from "npm:hono";

interface User {
  id: string;
  email: string;
  name: string;
}

export default async function (c: Context, ctx: any): Promise<Response> {
  const user: User = await getUser(ctx.params.id);
  return c.json(user);
}
```

### Request Body Typing

```typescript
interface CreateUserRequest {
  name: string;
  email: string;
  role?: "user" | "admin";
}

export default async function (c, ctx) {
  const body: CreateUserRequest = await c.req.json();

  // TypeScript knows body.name is a string
  console.log(body.name.toLowerCase());

  return c.json({ received: body });
}
```

### Combining with Validation

```typescript
import { z } from "jsr:@std/zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["user", "admin"]).default("user"),
});

type CreateUserRequest = z.infer<typeof CreateUserSchema>;

export default async function (c, ctx) {
  const body = await c.req.json();
  const result = CreateUserSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Validation failed", issues: result.error.issues }, 400);
  }

  const data: CreateUserRequest = result.data;
  // TypeScript knows the exact shape of data

  return c.json(data, 201);
}
```

## Complete Examples

### REST API - User CRUD

**List users:**

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

**Get user by ID:**

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

**Create user:**

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

### Webhook Handler - Stripe

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

### Scheduled Task

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

## Best Practices

### Use Request IDs for Logging

Always include the request ID in logs for traceability:

```typescript
console.log(`[${ctx.requestId}] Processing request`);
console.error(`[${ctx.requestId}] Error:`, error);
```

### Validate Input Early

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

### Use Secrets for Sensitive Data

Never hardcode API keys, passwords, or tokens:

```typescript
// Bad
const apiKey = "sk_live_abc123";

// Good
const apiKey = await ctx.getSecret("STRIPE_API_KEY");
```

### Return Appropriate Status Codes

Use HTTP status codes correctly:

- `200` - Success
- `201` - Created
- `400` - Bad request (validation error)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (authenticated but not allowed)
- `404` - Not found
- `409` - Conflict (e.g., duplicate email)
- `500` - Internal server error

### Handle Errors Gracefully

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

### Keep Functions Focused

Each function should do one thing well. Split complex logic into multiple routes:

```
Good: /users/create, /users/verify-email, /users/reset-password
Bad:  /users/manage (does everything)
```

### Test Functions Locally

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

## Next Steps

- Learn more about [API Keys and Authentication](/guides/authentication)
- Explore [Secrets Management](/guides/secrets)
- Review the [API Reference](/api/reference)
- Check out [Deployment Guide](/guides/deployment)
