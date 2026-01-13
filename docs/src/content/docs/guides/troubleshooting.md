---
title: Troubleshooting
description: Common issues and solutions
---

This guide covers common problems you might encounter when deploying and running Crude Functions, along with practical solutions.

## Installation Issues

### Port Already in Use

**Symptom:**

```
Error: Address already in use (OS error 98)
```

Or when using Docker:

```
Error starting userland proxy: listen tcp4 0.0.0.0:8000: bind: address already in use
```

**Cause:** Another service is already using port 8000.

**Solution:**

Find what's using the port:

```bash
# Linux/macOS
lsof -i :8000

# Or using netstat
netstat -tuln | grep 8000

# Or using ss
ss -tuln | grep 8000
```

Option 1 - Stop the conflicting service:

```bash
# Kill the process using the port
kill <PID>
```

Option 2 - Change the port in your docker-compose.yml:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8001:8000  # Changed host port to 8001
    volumes:
      - ./data:/app/data
      - ./code:/app/code
```

Option 3 - Set the PORT environment variable:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    environment:
      - PORT=3000
    ports:
      - 3000:3000  # Both must match
    volumes:
      - ./data:/app/data
      - ./code:/app/code
```

### Permission Denied on Data Directory

**Symptom:**

```
Error: Permission denied (os error 13)
EACCES: permission denied, open './data/database.db'
```

**Cause:** Docker container cannot write to the `./data` directory due to file permissions.

**Solution:**

Check directory ownership:

```bash
ls -la data/
```

Option 1 - Fix permissions (Docker Compose):

```bash
# Stop the container
docker compose down

# Fix ownership (standard image runs as root, hardened as non-root)
# For hardened image (UID 65532)
sudo chown -R 65532:65532 data/

# Or make it world-writable (less secure but works)
sudo chmod -R 777 data/

# Restart
docker compose up -d
```

Option 2 - Use named volumes instead of bind mounts:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000
    volumes:
      - crude-data:/app/data  # Named volume
      - ./code:/app/code
    restart: unless-stopped

volumes:
  crude-data:  # Define the volume
```

### Database Locked Error

**Symptom:**

```
Error: database is locked
```

**Cause:** Multiple processes trying to access the database, or WAL mode not enabled correctly.

**Solution:**

Check if multiple containers are running:

```bash
docker ps | grep crude-functions
```

Stop all instances:

```bash
docker compose down
docker ps -a | grep crude-functions | awk '{print $1}' | xargs docker rm -f
```

Ensure only one instance is running:

```bash
docker compose up -d
docker compose logs -f
```

If problem persists, check database file integrity:

```bash
# Install sqlite3
sudo apt install sqlite3  # Debian/Ubuntu
brew install sqlite3      # macOS

# Check database
sqlite3 data/database.db "PRAGMA integrity_check;"
```

### Volume Mount Issues

**Symptom:**

- Files created in `code/` don't appear in container
- Changes to files aren't reflected
- Database not persisting between restarts

**Cause:** Volume mounts are incorrectly configured or paths are wrong.

**Solution:**

Verify volume mounts are correct:

```bash
docker inspect <container_id> | grep -A 10 Mounts
```

Ensure paths are relative to docker-compose.yml:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    volumes:
      # Relative paths (recommended)
      - ./data:/app/data
      - ./code:/app/code

      # Absolute paths also work
      # - /home/user/crude-functions/data:/app/data
      # - /home/user/crude-functions/code:/app/code
```

Create directories before starting:

```bash
mkdir -p data code
docker compose up -d
```

On Windows with WSL2, ensure paths use forward slashes:

```yaml
volumes:
  - ./data:/app/data  # Correct
  # NOT: .\data:/app/data
```

## Authentication Issues

### Cannot Access Web UI - "Unauthorized"

**Symptom:**

Redirected to login page even after entering credentials, or "Unauthorized" error.

**Cause:** Session expired, cookies blocked, or authentication misconfigured.

**Solution:**

Clear browser cookies:

1. Open browser DevTools (F12)
2. Go to Application > Cookies
3. Delete all cookies for `localhost:8000`
4. Refresh and try logging in again

Check BETTER_AUTH_BASE_URL is correct:

```bash
# View logs for auth redirects
docker compose logs | grep -i "better.*auth"

# If behind a reverse proxy, set the base URL
```

Update docker-compose.yml:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    environment:
      - BETTER_AUTH_BASE_URL=https://functions.company.com
    ports:
      - 8000:8000
    volumes:
      - ./data:/app/data
      - ./code:/app/code
```

Enable third-party cookies (if required by your browser):

- Chrome: Settings > Privacy and security > Cookies > Allow all cookies
- Firefox: Settings > Privacy & Security > Enhanced Tracking Protection > Standard

### API Key Authentication Fails

**Symptom:**

```json
{"error": "Unauthorized"}
```

When calling API endpoints with `X-API-Key` header.

**Cause:** API key is invalid, belongs to wrong group, or group lacks access.

**Solution:**

Verify the API key exists and is correct:

```bash
# List all API keys
curl -H "X-API-Key: <your-key>" http://localhost:8000/api/keys

# Or check via web UI: /web/keys
```

Check which groups can access management API:

```bash
# Get current api.access-groups setting
curl -H "X-API-Key: <your-key>" http://localhost:8000/api/settings | jq '.data."api.access-groups"'
```

Ensure your API key's group is in the allowed list:

1. Go to `/web/settings`
2. Find "API Access Groups" setting
3. Ensure your key's group is checked
4. Click Save

Or via API:

```bash
# Get list of key groups
curl -H "X-API-Key: <your-key>" http://localhost:8000/api/key-groups

# Update api.access-groups to include your group ID
curl -X PUT \
  -H "X-API-Key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"settings": {"api.access-groups": "1,3"}}' \
  http://localhost:8000/api/settings
```

### Locked Out - No Valid API Key

**Symptom:**

Lost access to management API, no valid API keys in allowed groups.

**Cause:** Accidentally removed all keys from allowed groups or deleted the only management key.

**Solution:**

Use web UI session authentication (doesn't require API keys):

1. Log in via web UI: `/web`
2. Navigate to Settings
3. Add your key group to "API Access Groups"
4. Save

If you can't access web UI either:

1. Stop the container: `docker compose down`
2. Directly edit the database:

```bash
sqlite3 data/database.db

-- Find the management group ID
SELECT id, name FROM key_groups WHERE name = 'management';

-- Update api.access-groups setting to include it
UPDATE settings SET value = '<management_group_id>' WHERE name = 'api.access-groups';

-- Exit
.quit
```

3. Restart: `docker compose up -d`

### Setup Page Not Accessible After First User

**Symptom:**

Cannot access `/web` setup page to create additional users.

**Cause:** Setup page is automatically disabled after the first user is created (by design).

**Solution:**

Use the existing admin account to add users:

1. Log in with the first user account
2. Navigate to `/web/users`
3. Click "Add User"
4. Enter email and password
5. Click "Create User"

Or via API:

```bash
curl -X POST \
  -H "X-API-Key: <management-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "secure-password",
    "name": "New User"
  }' \
  http://localhost:8000/api/users
```

## Function Issues

### Module Not Found

**Symptom:**

```
Error: Module not found
Cannot find module "zod"
```

**Cause:** Missing package specifier prefix (npm:, jsr:, https://).

**Solution:**

Add the correct prefix to your imports:

```typescript
// Wrong
import { z } from "zod";

// Correct - NPM packages
import { z } from "npm:zod";
import dayjs from "npm:dayjs";
import { nanoid } from "npm:nanoid";

// Correct - JSR packages
import * as path from "jsr:@std/path";

// Correct - URL imports
import { marked } from "https://esm.sh/marked@12.0.0";
```

See [Writing Functions](/guides/writing-functions#importing-packages) for details.

### Hot-Reload Not Working

**Symptom:**

Changes to function code don't take effect without restarting the container.

**Cause:** File modification time not updating, volume mount issues, or caching.

**Solution:**

Verify the file was actually saved:

```bash
# Check file modification time
ls -la code/your-function.ts
```

Force a change:

```bash
# Update file timestamp
touch code/your-function.ts

# Or make a trivial edit (add a comment, whitespace)
```

Check Docker volume mount:

```bash
# Verify files are visible in container
docker exec <container_name> ls -la /app/code/

# Compare timestamps
docker exec <container_name> stat /app/code/your-function.ts
stat code/your-function.ts
```

If timestamps don't match, recreate volumes:

```bash
docker compose down
docker compose up -d --force-recreate
```

On Windows with Docker Desktop, ensure file watching is enabled:

- Docker Desktop > Settings > Resources > File Sharing
- Add the project directory

### Syntax Errors in Functions

**Symptom:**

```
SyntaxError: Unexpected token
```

Or function doesn't load at all.

**Cause:** TypeScript syntax errors in your handler file.

**Solution:**

Check container logs for specific errors:

```bash
docker compose logs -f
```

Common syntax issues:

```typescript
// Missing default export
export async function handler(c, ctx) {  // Wrong
  return c.json({});
}

export default async function (c, ctx) {  // Correct
  return c.json({});
}

// Missing async keyword
export default function (c, ctx) {  // Wrong
  return c.json({});
}

export default async function (c, ctx) {  // Correct
  return c.json({});
}

// Missing return statement
export default async function (c, ctx) {
  c.json({ message: "Hello" });  // Wrong - nothing returned
}

export default async function (c, ctx) {
  return c.json({ message: "Hello" });  // Correct
}
```

Use Deno's check command to validate syntax:

```bash
# Install Deno locally
curl -fsSL https://deno.land/install.sh | sh

# Check your function
deno check code/your-function.ts
```

### Function Timeouts

**Symptom:**

Function execution takes too long and times out.

**Cause:** Long-running operation, infinite loop, or blocking I/O.

**Solution:**

Add logging to identify bottlenecks:

```typescript
export default async function (c, ctx) {
  console.log(`[${ctx.requestId}] Starting execution`);

  const start = Date.now();
  const data = await fetchData();
  console.log(`[${ctx.requestId}] Data fetched in ${Date.now() - start}ms`);

  const processed = await processData(data);
  console.log(`[${ctx.requestId}] Data processed in ${Date.now() - start}ms`);

  return c.json(processed);
}
```

Optimize slow operations:

```typescript
// Add timeouts to external API calls
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch(url, { signal: controller.signal });
  return c.json(await response.json());
} catch (error) {
  if (error.name === 'AbortError') {
    return c.json({ error: 'Request timeout' }, 504);
  }
  throw error;
} finally {
  clearTimeout(timeout);
}
```

Use streaming for large responses:

```typescript
// Instead of buffering entire response
const data = await fetchLargeData();  // Bad for large data
return c.json(data);

// Stream the response
const stream = createDataStream();  // Good for large data
return new Response(stream, {
  headers: { "Content-Type": "application/json" }
});
```

### Shell Commands Fail in Hardened Image

**Symptom:**

```
Error: No such file or directory (os error 2)
```

When trying to run shell commands via `Deno.Command()`.

**Cause:** Hardened image has no shell (`/bin/sh` doesn't exist).

**Solution:**

Option 1 - Switch to standard image:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest  # Standard image
    ports:
      - 8000:8000
    volumes:
      - ./data:/app/data
      - ./code:/app/code
```

Option 2 - Avoid shell commands (recommended):

```typescript
// Instead of shell command
const process = new Deno.Command("sh", {
  args: ["-c", "ls -la"]
});

// Use Deno APIs directly
const files = [];
for await (const entry of Deno.readDir(".")) {
  files.push(entry.name);
}
```

Option 3 - Use pure TypeScript alternatives:

- File operations: `Deno.readFile()`, `Deno.writeFile()`
- HTTP requests: `fetch()`
- JSON processing: `JSON.parse()`, `JSON.stringify()`
- Archives: Use NPM packages like `npm:jszip`

See [Deployment - Image Variants](/guides/deployment#image-variants) for more details.

### NPM Package with Native Bindings Fails

**Symptom:**

```
Error loading shared library
Error: Cannot find module
```

When importing NPM packages with native dependencies.

**Cause:** Hardened image lacks native libraries, or package requires compilation.

**Solution:**

Option 1 - Use pure JavaScript alternatives:

```typescript
// Instead of native sharp (image processing)
import sharp from "npm:sharp";  // May fail

// Use pure JS imagescript
import { Image } from "npm:imagescript";  // Works
```

Option 2 - Switch to standard image (see above)

Option 3 - Use JSR packages (often pure TypeScript):

```typescript
// JSR packages are typically pure TS/JS
import * as csv from "jsr:@std/csv";
import * as yaml from "jsr:@std/yaml";
```

Check package documentation for "browser" or "pure" versions.

## Debugging Strategies

### Enable Debug Logging

Increase log verbosity to troubleshoot issues:

```bash
# Via web UI: /web/settings
# Set "Log Level" to "debug"

# Or via API
curl -X PUT \
  -H "X-API-Key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"settings": {"log.level": "debug"}}' \
  http://localhost:8000/api/settings
```

Add debug logging to functions:

```typescript
export default async function (c, ctx) {
  console.debug(`[${ctx.requestId}] Request params:`, ctx.params);
  console.debug(`[${ctx.requestId}] Request query:`, ctx.query);
  console.debug(`[${ctx.requestId}] Request headers:`, Object.fromEntries(c.req.raw.headers));

  const body = await c.req.json();
  console.debug(`[${ctx.requestId}] Request body:`, body);

  // Your logic...

  console.debug(`[${ctx.requestId}] Returning response`);
  return c.json({ ok: true });
}
```

### View Container Logs

Docker logs show server startup, errors, and system events:

```bash
# Follow logs in real-time
docker compose logs -f

# Last 100 lines
docker compose logs --tail=100

# Search for errors
docker compose logs | grep -i error

# Search for specific function
docker compose logs | grep "your-function.ts"
```

### View Function Execution Logs

Function logs are captured separately and viewable in the web UI:

1. Navigate to `/web/functions`
2. Click on your function
3. Switch to "Logs" tab
4. Filter by log level or search

Or via API:

```bash
# Get logs for specific function
curl -H "X-API-Key: <your-key>" \
  "http://localhost:8000/api/logs?functionId=1&level=error&limit=50"

# Get all error logs
curl -H "X-API-Key: <your-key>" \
  "http://localhost:8000/api/logs?level=error"
```

### Inspect Function Execution

Add detailed logging at key points:

```typescript
export default async function (c, ctx) {
  const startTime = Date.now();
  console.log(`[${ctx.requestId}] Starting execution`);

  try {
    console.log(`[${ctx.requestId}] Input:`, {
      params: ctx.params,
      query: ctx.query,
      method: c.req.method,
    });

    const result = await performOperation();
    console.log(`[${ctx.requestId}] Operation result:`, result);

    const response = c.json(result);
    console.log(`[${ctx.requestId}] Execution time: ${Date.now() - startTime}ms`);
    return response;

  } catch (error) {
    console.error(`[${ctx.requestId}] Error after ${Date.now() - startTime}ms:`, error);
    return c.json({
      error: error.message,
      requestId: ctx.requestId
    }, 500);
  }
}
```

### Test Functions with curl

Test functions outside the web UI:

```bash
# Simple GET
curl http://localhost:8000/run/hello

# GET with query parameters
curl "http://localhost:8000/run/search?q=test&limit=10"

# POST with JSON
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}' \
  http://localhost:8000/run/users

# With API key
curl -H "X-API-Key: your-key" \
  http://localhost:8000/run/protected

# With custom headers
curl -H "Authorization: Bearer token123" \
  -H "X-Custom-Header: value" \
  http://localhost:8000/run/api

# Verbose output (see request/response details)
curl -v http://localhost:8000/run/hello

# Include response headers
curl -i http://localhost:8000/run/hello

# Save response to file
curl -o response.json http://localhost:8000/run/data
```

### Exec Into Container

For deeper inspection (standard image only):

```bash
# Standard image
docker exec -it <container_name> sh

# Inside container
ls -la /app/code/
cat /app/code/your-function.ts
deno --version
```

For hardened image (no shell):

```bash
# Can't exec - no shell available
# Use Docker logs and file inspection from host instead
```

## Performance Issues

### High Memory Usage

**Symptom:**

Container using excessive memory, system becomes slow.

**Cause:** Memory leaks, large data buffering, or too many concurrent requests.

**Solution:**

Monitor container memory:

```bash
docker stats <container_name>
```

Check for memory leaks in functions:

```typescript
// Avoid holding references to large objects
const cache = new Map();  // Grows indefinitely - bad

// Use LRU cache or clear periodically
function cleanCache() {
  if (cache.size > 1000) {
    cache.clear();
  }
}
```

Stream large responses instead of buffering:

```typescript
// Bad - loads entire file into memory
export default async function (c, ctx) {
  const file = await Deno.readFile("large-file.json");
  return c.json(JSON.parse(new TextDecoder().decode(file)));
}

// Good - streams the file
export default async function (c, ctx) {
  const file = await Deno.open("large-file.json");
  return new Response(file.readable, {
    headers: { "Content-Type": "application/json" }
  });
}
```

Reduce log retention:

```bash
curl -X PUT \
  -H "X-API-Key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.trimming.max-per-function": "500",
      "log.trimming.retention-seconds": "604800"
    }
  }' \
  http://localhost:8000/api/settings
```

### Slow Function Execution

**Symptom:**

Functions take a long time to respond.

**Cause:** Inefficient code, slow external APIs, or database queries.

**Solution:**

Use metrics to identify slow functions:

1. Navigate to `/web/functions`
2. Click on function
3. Switch to "Metrics" tab
4. Look for high average execution times

Add timing logs:

```typescript
export default async function (c, ctx) {
  const timings: Record<string, number> = {};

  const start = Date.now();

  const data = await fetchData();
  timings.fetch = Date.now() - start;

  const processed = await process(data);
  timings.process = Date.now() - start - timings.fetch;

  console.log(`[${ctx.requestId}] Timings:`, timings);

  return c.json(processed);
}
```

Optimize database queries:

```typescript
// Bad - N+1 query problem
for (const userId of userIds) {
  const user = await db.getUser(userId);  // One query per user
  users.push(user);
}

// Good - batch query
const users = await db.getUsersById(userIds);  // Single query
```

Cache expensive operations:

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

export default async function (c, ctx) {
  const cacheKey = `user:${ctx.params.id}`;

  let user = getCached(cacheKey);
  if (!user) {
    user = await db.getUser(ctx.params.id);
    setCache(cacheKey, user, 60000);  // Cache for 1 minute
  }

  return c.json(user);
}
```

### Database Growing Too Large

**Symptom:**

`data/database.db` file size keeps increasing.

**Cause:** Log accumulation, metrics retention, or no cleanup.

**Solution:**

Reduce retention periods:

```bash
curl -X PUT \
  -H "X-API-Key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.trimming.max-per-function": "1000",
      "log.trimming.retention-seconds": "2592000",
      "metrics.retention-days": "30"
    }
  }' \
  http://localhost:8000/api/settings
```

Manually delete old logs:

```bash
curl -X DELETE \
  -H "X-API-Key: <your-key>" \
  http://localhost:8000/api/logs/1  # Delete logs for function ID 1
```

Vacuum the database to reclaim space:

```bash
# Stop container
docker compose down

# Vacuum database
sqlite3 data/database.db "VACUUM;"

# Restart
docker compose up -d
```

Check database size breakdown:

```bash
sqlite3 data/database.db "SELECT name, SUM(pgsize) as size FROM dbstat GROUP BY name ORDER BY size DESC;"
```

## Common Mistakes

### Using Relative Paths in Handler Registration

**Symptom:**

Function not found, or wrong handler executed.

**Cause:** Handler path is incorrect or includes `/app/code/`.

**Solution:**

Handler path should be relative to the `code/` directory:

```bash
# File location: ./code/users/get.ts

# Wrong
handler: "/app/code/users/get.ts"
handler: "./code/users/get.ts"
handler: "code/users/get.ts"

# Correct
handler: "users/get.ts"
```

### Forgetting to Return Response

**Symptom:**

Function executes but returns nothing, or returns `undefined`.

**Cause:** Missing `return` statement.

**Solution:**

Always return a response:

```typescript
// Wrong
export default async function (c, ctx) {
  c.json({ message: "Hello" });  // Nothing returned
}

// Correct
export default async function (c, ctx) {
  return c.json({ message: "Hello" });
}
```

### Hardcoding Secrets in Code

**Symptom:**

Secrets exposed in logs, version control, or error messages.

**Cause:** Embedding sensitive values directly in handler code.

**Solution:**

Use the secrets system:

```typescript
// Wrong
const apiKey = "sk_live_abc123def456";

// Correct
const apiKey = await ctx.getSecret("STRIPE_API_KEY");

if (!apiKey) {
  return c.json({ error: "API key not configured" }, 500);
}
```

See [Secrets Management](/guides/secrets) for details.

### Not Handling Errors

**Symptom:**

Functions crash, users see generic error messages, no debugging information.

**Cause:** Exceptions not caught and handled properly.

**Solution:**

Wrap operations in try-catch:

```typescript
export default async function (c, ctx) {
  try {
    const data = await fetchData();
    return c.json(data);
  } catch (error) {
    console.error(`[${ctx.requestId}] Error:`, error);
    return c.json({
      error: "Failed to fetch data",
      requestId: ctx.requestId
    }, 500);
  }
}
```

See [Writing Functions - Error Handling](/guides/writing-functions#error-handling) for patterns.

### Blocking the Event Loop

**Symptom:**

Server becomes unresponsive, all functions slow down.

**Cause:** Synchronous operations or CPU-intensive tasks.

**Solution:**

Avoid synchronous blocking operations:

```typescript
// Bad - blocks event loop
function heavyComputation() {
  let result = 0;
  for (let i = 0; i < 1000000000; i++) {
    result += i;
  }
  return result;
}

// Good - yield to event loop periodically
async function heavyComputation() {
  let result = 0;
  for (let i = 0; i < 1000000000; i++) {
    result += i;
    if (i % 1000000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return result;
}
```

Or move CPU-intensive work to a separate service.

### Mixing Up Request and Response

**Symptom:**

Functions fail with type errors or unexpected behavior.

**Cause:** Using response methods on request, or vice versa.

**Solution:**

Use `c.req` for request, `c.json()`/`c.text()`/`c.html()` for response:

```typescript
export default async function (c, ctx) {
  // Request - read data
  const body = await c.req.json();
  const header = c.req.header("Authorization");

  // Response - send data
  return c.json({ message: "Success" });
  // Or: return c.text("Success");
  // Or: return c.html("<h1>Success</h1>");
}
```

## Getting More Help

If you're still experiencing issues:

1. **Check container logs:** `docker compose logs -f`
2. **Enable debug logging:** Set log level to "debug" in Settings
3. **Review function logs:** Navigate to `/web/functions`, select function, view "Logs" tab
4. **Check metrics:** Look for patterns in execution times and error rates
5. **Test with curl:** Isolate whether the issue is in the function or client
6. **Verify configuration:** Review Settings page for correct values
7. **Inspect database:** Use sqlite3 to query the database directly if needed

## Related Topics

- [Deployment](/guides/deployment) - Installation and Docker configuration
- [Writing Functions](/guides/writing-functions) - Function development best practices
- [Configuration](/guides/configuration) - Environment variables and settings
- [Logs](/guides/logs) - Viewing and managing execution logs
- [Metrics](/guides/metrics) - Performance monitoring and analysis
