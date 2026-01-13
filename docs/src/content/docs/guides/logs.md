---
title: Logs
description: Viewing and managing function execution logs
---

Crude Functions automatically captures all console output from your functions and stores it in the database for debugging and monitoring. This guide explains how the logging system works and how to view and manage logs.

## How Logging Works

### Automatic Console Capture

When your functions execute, Crude Functions intercepts all console output through a component called `StreamInterceptor`. This capture mechanism hooks into:

- **Console methods**: `console.log()`, `console.info()`, `console.warn()`, `console.error()`, `console.debug()`, `console.trace()`
- **Stream output**: Direct writes to `stdout` and `stderr` (captures output from npm packages that write to streams)
- **Execution events**: Function start, completion, and errors

**Key behavior:**

- Output is captured only when code runs within a request context (during function execution)
- System logs (outside function execution) pass through normally to the console
- Captured logs are stored in SQLite for later retrieval
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

| Level | Method | Color | Use Case |
|-------|--------|-------|----------|
| **log** | `console.log()` | Gray | General output |
| **info** | `console.info()` | Blue | Informational messages |
| **warn** | `console.warn()` | Orange | Warnings and potential issues |
| **error** | `console.error()` | Red | Errors and failures |
| **debug** | `console.debug()` | Gray | Debugging information |
| **trace** | `console.trace()` | Light Gray | Stack traces |

### Stream Levels

| Level | Source | Use Case |
|-------|--------|----------|
| **stdout** | Direct stdout writes | Output from npm packages |
| **stderr** | Direct stderr writes | Error output from npm packages |

### Execution Event Levels

| Level | Event | Color | Description |
|-------|-------|-------|-------------|
| **exec_start** | Function started | Green | Function execution begins |
| **exec_end** | Function completed | Green | Function execution completes successfully |
| **exec_reject** | Function failed | Red | Function threw an uncaught error |

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

1. Navigate to the Functions page: `http://localhost:8000/web/functions`
2. Find your function in the list
3. Click the logs icon (📝) in the Actions column
4. Or visit directly: `/web/functions/logs/{functionId}`

![Function logs page screenshot placeholder]

### Logs Page Interface

The logs page displays:

- **Controls bar**:
  - **Back to Functions** button
  - **Show** dropdown: Select page size (50, 100, 250, 500, 1000)
  - **Refresh** button: Reload latest logs
  - **Reset to Newest** button: Return to most recent logs (when paginating)

- **Status line**: Shows count and time range
  ```
  Showing 100 logs (newest): 2026-01-12 09:15:32 to 2026-01-12 10:42:18
  ```

- **Log table**:
  - **Time**: HH:MM:SS.mmm format (click row to see full timestamp)
  - **Level**: Color-coded log level badge
  - **Req ID**: Last 5 characters of request ID (click to copy full ID)
  - **Message**: Log message (truncated if long)

### Viewing Log Details

Click any log row to expand and see:

- Full timestamp with date
- Complete request ID (UUID)
- Full message (no truncation)
- Additional arguments (if any were logged)
- ANSI color codes preserved (colored console output)

**Example: Expanded log entry**

```
Time: 2026-01-12 10:42:18.234
Request ID: 550e8400-e29b-41d4-a716-446655440000
Level: ERROR
Message: Failed to fetch user data
Args: ["Error: Connection timeout", {"userId": 123, "attempt": 3}]
```

### Log Color Coding

Logs are color-coded for quick scanning:

- **ERROR** / **EXEC_REJECT**: Red background
- **WARN**: Orange background
- **INFO**: Blue background
- **EXEC_START** / **EXEC_END**: Green background
- **LOG** / **DEBUG** / **TRACE**: Gray background
- **STDOUT** / **STDERR**: Default background

### Pagination

Logs are displayed newest first with pagination:

1. Initial load shows the most recent logs (default: 100)
2. Click **Load Older Logs →** to view previous logs
3. Continue clicking to paginate through history
4. Click **Reset to Newest** to return to the top

**Performance note:** Loading 1000 logs at once may be slow. Use smaller page sizes (100-250) for better performance.

## Querying Logs via API

For programmatic access, use the Logs API endpoint.

### List Logs with Filtering

```bash
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/logs?functionId=1&limit=50"
```

**Query parameters:**

- `functionId` - Filter by function ID (omit for all functions)
- `level` - Filter by log level (comma-separated: `log,error,warn`)
- `limit` - Results per page (1-1000, default: 50)
- `cursor` - Pagination cursor from previous response

**Response format:**

```json
{
  "data": {
    "logs": [
      {
        "id": 12345,
        "requestId": "550e8400-e29b-41d4-a716-446655440000",
        "routeId": 1,
        "level": "log",
        "message": "User authenticated successfully",
        "args": "[\"userId\",123]",
        "timestamp": "2026-01-12T10:42:18.234Z"
      }
    ],
    "pagination": {
      "limit": 50,
      "hasMore": true,
      "next": "/api/logs?limit=50&cursor=eyJ0aW1lc3RhbXAi..."
    }
  }
}
```

### Filter by Log Level

Query only errors and warnings:

```bash
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/logs?level=error,warn&limit=100"
```

### Pagination Example

```bash
# First page
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/logs?functionId=1&limit=50"

# Next page (use cursor from response)
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/logs?functionId=1&limit=50&cursor=eyJ0aW1lc3RhbXAi..."
```

### Tracing a Specific Request

If you have a request ID (e.g., from an error report), query logs for that specific execution:

```bash
# Note: This uses the service directly, not exposed via API
# Use the web UI logs page and filter by request ID
```

**Web UI method:**

1. Go to function logs page
2. Expand any log entry to see full request ID
3. Copy the request ID
4. Use browser's find feature (Ctrl+F) to locate all logs with that ID

## Log Retention and Automatic Trimming

### Retention Settings

Crude Functions automatically removes old logs based on two settings (configurable in Settings page):

1. **Retention duration**: Keep logs for N days (default: 90 days)
   - Setting: `log.trimming.retention-seconds`
   - Logs older than this are deleted

2. **Max logs per function**: Keep newest N logs per function (default: 2000)
   - Setting: `log.trimming.max-per-function`
   - Excess logs are deleted (oldest first)

### Automatic Trimming

A background job runs periodically (default: every 5 minutes) to enforce retention:

- Interval setting: `log.trimming.interval-seconds`
- Deletes logs older than retention duration
- Trims each function to max log count
- Runs automatically in the background

**Why two limits?**

- **Duration limit**: Protects against disk space issues
- **Count limit**: Prevents high-traffic functions from dominating storage
- Both limits are enforced; whichever is more restrictive applies

### Adjusting Retention Settings

Navigate to `http://localhost:8000/web/settings`:

1. Find "Logs Settings" section
2. Adjust:
   - **Log Retention Days**: How long to keep logs (1-365 days)
   - **Max Logs Per Function**: How many logs to keep per function
   - **Log Trimming Interval**: How often to run cleanup (seconds)
3. Click **Save Settings**

**Recommendations:**

- **Development**: Shorter retention (7 days) to save space
- **Production**: Longer retention (90 days) for incident investigation
- **High-traffic functions**: Higher max logs (5000+) to capture more history
- **Low-traffic functions**: Lower max logs (500-1000) is sufficient

## Deleting Logs

### Delete All Logs for a Function

Use the API to delete all logs for a specific function:

```bash
curl -X DELETE \
  -H "X-API-Key: your-management-key" \
  http://localhost:8000/api/logs/1
```

This removes all logs for function ID `1`, regardless of age.

**Use cases:**

- Clean up after debugging
- Remove sensitive data accidentally logged
- Reset log history before going to production

### Manual Retention Enforcement

To force immediate cleanup (instead of waiting for the scheduled job):

1. Adjust retention settings to be more aggressive
2. Wait for next trimming interval (max 5 minutes)
3. Or restart the server to trigger cleanup on startup

**Note:** There is no "delete all logs" button in the web UI. Use the API or adjust retention settings.

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

**Note:** Set log level to "debug" in Settings to capture debug logs, or use "info" to hide them in production.

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

## Troubleshooting

### Logs Not Appearing

**Check if function is executing:**

1. Verify function is enabled (green checkmark in Functions list)
2. Check that requests are reaching the function (test with curl)
3. Look for `exec_start` log entries (proves function ran)

**Check log level setting:**

1. Go to Settings page
2. Check "Log Level" setting
3. Set to "debug" to capture all logs
4. Set to "info" or "warn" to filter out verbose logs

**Check retention settings:**

1. Logs may have been deleted if too old or too many
2. Adjust retention settings to keep more logs
3. Check "Max Logs Per Function" isn't too low

### Logs Are Incomplete

**Buffer not flushed:**

- Logs are buffered for performance
- They flush after 50ms or 50 entries
- If server crashes, buffered logs may be lost

**Function crashed early:**

- Look for `exec_reject` log entry (shows error)
- Check if error occurred before logs were written
- Add try-catch blocks to log errors before crashing

### High Disk Usage

**Too many logs:**

1. Check Settings > "Max Logs Per Function"
2. Reduce retention days or max logs per function
3. Delete old logs for specific functions via API

**Adjust trimming interval:**

1. Run cleanup more frequently (e.g., every 60 seconds)
2. Setting: `log.trimming.interval-seconds`

### Cannot Find Specific Request

**Use request ID for tracing:**

1. Get request ID from error message or response headers
2. Go to function logs page
3. Use browser's find feature to search for the request ID
4. All logs for that request will be grouped by the same ID

**Logs already deleted:**

- Check retention settings
- Request may be older than retention period
- Increase retention days to keep logs longer

## Related Resources

- [Metrics Guide](/guides/metrics) - Monitoring function performance
- [API Reference: Logs](/reference/api#logs) - Programmatic log access
- [Settings Guide](/guides/settings) - Configuring retention and trimming
