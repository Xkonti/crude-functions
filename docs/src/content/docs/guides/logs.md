---
title: Logs
description: Viewing and managing function execution logs
---

Crude Functions automatically captures all console output from your functions and stores it in the database for debugging and monitoring. This guide explains how the logging system works and how to view and manage logs.

## How Logging Works

### Automatic Console Capture

When your functions execute, Crude Functions intercepts all console output. This capture mechanism hooks into:

- **Console methods**: `console.log()`, `console.info()`, `console.warn()`, `console.error()`, `console.debug()`, `console.trace()`
- **Stream output**: Direct writes to `stdout` and `stderr` (captures output from NPM/JSR packages that write to streams)
- **Execution events**: Function start, completion, and errors

**Key behavior:**

- Output is captured only when code runs within a request context (during function execution)
- System logs (outside function execution) pass through normally to the console
- Captured logs are stored in the database for later retrieval
- Logs are buffered and written in batches for performance

### Request ID Tracking

Every function execution is assigned a unique request ID (UUID). This ID:

- Links all logs from a single function execution together
- Allows tracing a request end-to-end
- Appears in log entries for correlation
- Can be accessed in handlers via `ctx.requestId`

**Example: Using request ID in your function**

```typescript
export default async function (c, ctx) {
  console.log(`Processing request ${ctx.requestId}`);

  // Call external API
  const response = await fetch("https://api.example.com/data", {
    headers: {
      "X-Request-ID": ctx.requestId, // Pass to external service
    },
  });

  return c.json({ data: await response.json() });
}
```

### Buffered Storage

Logs use a buffered writing strategy:

- Logs are collected in memory (default: 50 logs per batch)
- Buffer flushes automatically after a delay (default: 50ms)
- Buffer flushes immediately when batch size is reached
- Reduces database writes for better performance

These settings can be configured in the Settings page.

## Log Levels

Crude Functions captures different log levels, each with a specific purpose:

### Standard Console Levels

| Level | Method | Use Case |
|-------|--------|----------|
| **log** | `console.log()` | General output |
| **info** | `console.info()` | Informational messages |
| **warn** | `console.warn()` | Warnings and potential issues |
| **error** | `console.error()` | Errors and failures |
| **debug** | `console.debug()` | Debugging information |
| **trace** | `console.trace()` | Stack traces |

### Stream Levels

| Level | Source | Use Case |
|-------|--------|----------|
| **stdout** | Direct stdout writes | Output from npm packages |
| **stderr** | Direct stderr writes | Error output from npm packages |

### Execution Event Levels

| Level | Event | Description |
|-------|-------|-------------|
| **exec_start** | Function started | Function execution begins |
| **exec_end** | Function completed | Function execution completes successfully |
| **exec_reject** | Function failed | Function threw an uncaught error |

### Example: Using Different Log Levels

```typescript
export default async function (c, ctx) {
  console.info("Starting user creation process");

  const body = await c.req.json();

  console.debug("Received body:", body);

  if (!body.email) {
    console.warn("Missing email field in request");
    return c.json({ error: "Email required" }, 400);
  }

  try {
    const user = await createUser(body);
    console.log("User created:", user.id);
    return c.json({ user });
  } catch (error) {
    console.error("Failed to create user:", error);
    return c.json({ error: "Creation failed" }, 500);
  }
}
```

**Result in logs:**

```
[INFO]  Starting user creation process
[DEBUG] Received body: {"email":"user@example.com","name":"John"}
[LOG]   User created: abc123
```

## Viewing Logs in the Web UI

### Accessing Function Logs

1. Navigate to the Functions management page ⚡
2. Find your function in the list
3. Click the logs 📝 button in the Actions column
4. Or visit directly: `/web/functions/logs/{functionId}`

### Logs Page Interface

The logs page displays:

- **Controls bar**:
  - **Back to Functions** button
  - **Show** dropdown: Select page size
  - **Refresh** button: Reload latest logs
  - **Reset to Newest** button: Return to most recent logs (when paginating)

- **Status line**: Shows count and time range

  ```
  Showing 100 logs (newest): 2026-01-12 09:15:32 to 2026-01-12 10:42:18
  ```

- **Log table**:
  - **Time**: HH:MM:SS.mmm format (hover to see full timestamp)
  - **Level**: Color-coded log level badge
  - **Req ID**: Last 5 characters of request ID - hover to view full ID, click to copy it
  - **Message**: Log message - click to expand the row and see all lines of the log message

## Log Retention and Automatic Trimming

### Retention Settings

Crude Functions automatically removes old logs based on two settings (configurable in Settings page):

1. **Retention duration**: Keep logs for N days (default: 90 days)
   - Setting: `log.trimming.retention-seconds`
   - Logs older than this are deleted

2. **Max logs per function**: Keep newest N logs per function (default: 2000)
   - Setting: `log.trimming.max-per-function`
   - Excess logs are deleted (oldest first)

## Logging Best Practices

### Use Appropriate Log Levels

```typescript
// ✅ Good: Use correct levels
console.info("User logged in");           // Informational
console.warn("Rate limit approaching");   // Warning
console.error("Database connection failed"); // Error
console.debug("Cache hit ratio: 87%");    // Debug detail

// ❌ Bad: Everything as console.log
console.log("User logged in");
console.log("Rate limit approaching");
console.log("Database connection failed");
```

### Include Request Context

```typescript
export default async function (c, ctx) {
  // ✅ Good: Include request ID and context
  console.info(`[${ctx.requestId}] Processing order ${orderId}`);

  // ❌ Bad: No context
  console.log("Processing order");
}
```

### Log Structured Data

```typescript
// ✅ Good: Log objects for detail
console.log("User created:", {
  id: user.id,
  email: user.email,
  createdAt: user.createdAt
});

// ❌ Bad: String concatenation
console.log("User created: " + user.id + " " + user.email);
```

### Avoid Logging Secrets

```typescript
// ❌ NEVER: Log sensitive data
console.log("API key:", apiKey);
console.log("User password:", password);
console.log("Database URL:", await ctx.getSecret("DATABASE_URL"));

// ✅ Good: Log without sensitive details
console.log("API request authenticated");
console.log("User password updated");
console.log("Connected to database");
```

### Use Debug Logs for Detail

```typescript
export default async function (c, ctx) {
  console.info("Fetching user data");

  // Debug logs for detailed troubleshooting
  console.debug("Query params:", ctx.query);
  console.debug("Headers:", c.req.header());

  const user = await fetchUser(userId);
  console.debug("User data:", user);

  return c.json({ user });
}
```

### Log Errors with Context

```typescript
try {
  const result = await riskyOperation();
} catch (error) {
  // ✅ Good: Log error with context
  console.error("Failed to process payment:", {
    error: error.message,
    orderId: orderId,
    userId: ctx.params.userId,
    timestamp: new Date().toISOString(),
  });
  throw error;
}
```
