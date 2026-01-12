# Advanced Features in Crude Functions

This guide covers advanced features for power users and automation engineers. Topics include secrets management, execution logs, metrics, hot reload behavior, encryption key rotation, REST API usage, and integration patterns.

## Table of Contents

- [Secrets Management](#secrets-management)
- [Using getSecret() in Functions](#using-getsecret-in-functions)
- [Execution Logs](#execution-logs)
- [Metrics and Performance Monitoring](#metrics-and-performance-monitoring)
- [Hot Reload Behavior](#hot-reload-behavior)
- [File Size Limits and Configuration](#file-size-limits-and-configuration)
- [Encryption and Key Rotation](#encryption-and-key-rotation)
- [REST API Reference](#rest-api-reference)
- [Integration Patterns](#integration-patterns)
- [Troubleshooting](#troubleshooting)
- [Performance Characteristics](#performance-characteristics)

---

## Secrets Management

Crude Functions provides a hierarchical secrets system with four scope levels. Secrets are encrypted at rest using AES-256-GCM and support automatic key rotation.

### Secret Scopes

Secrets are resolved in the following order (most specific wins):

1. **Key scope** - Tied to a specific API key
2. **Group scope** - Tied to an API key group
3. **Function scope** - Tied to a specific function
4. **Global scope** - Available to all functions

This allows you to override secrets for specific contexts. For example:

- Store a default `DATABASE_URL` as global
- Override it for staging functions with function-scoped secret
- Override it for specific API keys with key-scoped secret

### Managing Secrets via Web UI

Navigate to the Secrets page in the web UI to:

- View all secrets grouped by scope
- Create, update, and delete secrets
- View which secret value would be used for a specific function (preview mode)
- See all sources for a secret name across scopes

### Managing Secrets via API

See [REST API Reference](#rest-api-reference) below for programmatic secret management.

### Secret Naming Rules

- Must match pattern: `[a-zA-Z0-9_-]+`
- Case-sensitive
- Unique within each scope

### Secret Size Limits

- Maximum plaintext size: 16 KB
- Encrypted size: approximately 21.4 KB
- Attempting to store larger secrets will fail with `OversizedPlaintextError`

### Security Notes

- Secrets are encrypted at rest using AES-256-GCM
- Each secret uses a unique random IV (initialization vector)
- Encryption keys are versioned and support rotation
- Decryption failures are logged with error details

---

## Using getSecret() in Functions

Access secrets in your function handlers using the `ctx.getSecret()` method.

### Basic Usage (Hierarchical Resolution)

```typescript
export default async function(c, ctx) {
  // Hierarchical lookup: Key > Group > Function > Global
  const apiKey = await ctx.getSecret("THIRD_PARTY_API_KEY");

  if (!apiKey) {
    return c.json({ error: "API key not configured" }, 500);
  }

  // Use the secret
  const response = await fetch("https://api.example.com/data", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });

  return c.json(await response.json());
}
```

### Explicit Scope Selection

```typescript
export default async function(c, ctx) {
  // Get secret from specific scope
  const globalKey = await ctx.getSecret("API_KEY", "global");
  const functionKey = await ctx.getSecret("API_KEY", "function");
  const groupKey = await ctx.getSecret("API_KEY", "group");
  const keyKey = await ctx.getSecret("API_KEY", "key");

  // Returns undefined if not found in specified scope
  return c.json({
    hasGlobal: globalKey !== undefined,
    hasFunction: functionKey !== undefined
  });
}
```

### Complete Secret Inspection

```typescript
export default async function(c, ctx) {
  // Get all values across all scopes
  const complete = await ctx.getCompleteSecret("DATABASE_URL");

  if (!complete) {
    return c.json({ error: "No DATABASE_URL found" }, 500);
  }

  // Object shape:
  // {
  //   global?: string,
  //   function?: string,
  //   group?: { value: string, groupId: number, groupName: string },
  //   key?: { value: string, groupId: number, groupName: string,
  //           keyId: number, keyName: string }
  // }

  return c.json({
    sources: Object.keys(complete),
    usingValue: complete.key?.value || complete.group?.value ||
                complete.function || complete.global
  });
}
```

### Best Practices

- Always check for `undefined` before using secrets
- Use hierarchical resolution for simplicity
- Use explicit scopes when you need specific behavior
- Store sensitive values as secrets, never in code
- Rotate secrets regularly using key rotation

---

## Execution Logs

Crude Functions captures all console output from function executions, including special execution lifecycle events.

### Log Levels

- `log`, `debug`, `info`, `warn`, `error`, `trace` - Standard console methods
- `stdout`, `stderr` - Raw stream output
- `exec_start` - Function execution began
- `exec_end` - Function execution completed
- `exec_reject` - Function execution rejected (e.g., invalid API key)

### Viewing Logs via Web UI

1. Navigate to Functions page
2. Click on a function
3. View the Logs tab
4. Filter by log level
5. Use pagination to navigate through logs

### Querying Logs via API

```bash
# Get logs for a specific function
curl -X GET "http://localhost:8000/api/logs?functionId=1&limit=100" \
  -H "X-API-Key: your-management-key"

# Filter by log level (comma-separated)
curl -X GET "http://localhost:8000/api/logs?level=error,warn&limit=50" \
  -H "X-API-Key: your-management-key"

# Use pagination cursor
curl -X GET "http://localhost:8000/api/logs?cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTAxLTEyVDEyOjAwOjAwLjAwMFoiLCJpZCI6MTAwfQ==" \
  -H "X-API-Key: your-management-key"
```

### Log Retention Configuration

Configure log retention via settings:

- `log.trimming.interval-seconds` - How often to trim logs (default: 300)
- `log.trimming.max-per-function` - Max logs per function (default: 2000)
- `log.trimming.retention-seconds` - Max age of logs (default: 7776000 = 90 days)

### Log Batching

Logs are buffered in memory and written in batches for performance:

- `log.batching.max-batch-size` - Max logs per batch (default: 50)
- `log.batching.max-delay-ms` - Max delay before flush (default: 50ms)

### Deleting Logs

```bash
# Delete all logs for a function
curl -X DELETE "http://localhost:8000/api/logs/1" \
  -H "X-API-Key: your-management-key"
```

---

## Metrics and Performance Monitoring

Crude Functions tracks execution metrics at minute, hour, and day resolutions.

### Metric Types

Each metric includes:

- `avgTimeMs` - Weighted average execution time
- `maxTimeMs` - Maximum execution time in the period
- `executionCount` - Number of executions in the period

### Viewing Metrics via Web UI

1. Navigate to Functions page
2. Click on a function
3. View the Metrics tab
4. Select resolution: minutes (last 60), hours (last 24), or days (last 90)
5. View charts and summary statistics

### Querying Metrics via API

```bash
# Get minute-resolution metrics (last 60 minutes)
curl -X GET "http://localhost:8000/api/metrics?resolution=minutes&functionId=1" \
  -H "X-API-Key: your-management-key"

# Get hour-resolution metrics (last 24 hours)
curl -X GET "http://localhost:8000/api/metrics?resolution=hours&functionId=1" \
  -H "X-API-Key: your-management-key"

# Get day-resolution metrics (last N days, configurable)
curl -X GET "http://localhost:8000/api/metrics?resolution=days&functionId=1" \
  -H "X-API-Key: your-management-key"

# Get global metrics (all functions)
curl -X GET "http://localhost:8000/api/metrics?resolution=hours" \
  -H "X-API-Key: your-management-key"
```

Response format:

```json
{
  "data": {
    "metrics": [
      {
        "timestamp": "2026-01-12T10:00:00.000Z",
        "avgTimeMs": 42.5,
        "maxTimeMs": 150,
        "executionCount": 10
      }
    ],
    "functionId": 1,
    "resolution": "minutes",
    "summary": {
      "totalExecutions": 600,
      "avgExecutionTime": 45.2,
      "maxExecutionTime": 350,
      "periodCount": 60
    }
  }
}
```

### Metrics Configuration

- `metrics.aggregation-interval-seconds` - Aggregation frequency (default: 60)
- `metrics.retention-days` - Days to keep metrics (default: 90)

### Performance Optimization

- Metrics are aggregated in background to avoid blocking execution
- Old metrics are automatically trimmed
- Queries are optimized with indexes on timestamp and routeId

---

## Hot Reload Behavior

Crude Functions uses intelligent hot reload to automatically pick up code changes without restarting the server.

### How Hot Reload Works

1. Handler files are loaded dynamically using Deno's dynamic import
2. File modification time (mtime) is tracked in memory
3. On each request, if the file's mtime changed, the handler is reloaded
4. Cache-busting query parameter ensures Deno's module cache is bypassed

### When Handlers Reload

- File content changes (detected via mtime)
- Manual invalidation via API
- Force reload flag is set

### Caching Behavior

- Handlers are cached in memory after first load
- Cache key is the relative handler path
- Cache is invalidated when file mtime changes
- No disk-based caching

### Security Considerations

- Path traversal protection via `resolveAbsolutePath()`
- Symlink validation via `realPath()` check
- All paths must stay within the base code directory
- Absolute paths in handler configuration are rejected

### Testing Hot Reload

```bash
# Edit a handler file
echo 'export default async (c, ctx) => c.json({ updated: true });' > code/test.ts

# Next request will automatically use the new code
curl http://localhost:8000/run/test

# No server restart needed!
```

### Limitations

- Module-level side effects run on each reload
- External dependencies are also reloaded (can be slow)
- Import errors block the specific handler but don't crash the server

---

## File Size Limits and Configuration

### Default Limits

- Maximum file size: **50 MB** (52,428,800 bytes)
- Configurable via `files.max-size-bytes` setting
- Range: 1 KB to 500 MB

### Changing File Size Limit

Via API:

```bash
curl -X PUT "http://localhost:8000/api/settings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-management-key" \
  -d '{
    "settings": {
      "files.max-size-bytes": "104857600"
    }
  }'
```

Via Web UI:

1. Navigate to Settings page
2. Find "Maximum File Size" under Security
3. Update value (in bytes)
4. Save changes

### File Operations

All file operations enforce size limits:

- Upload via Web UI
- Create/update via API
- Direct file writes

---

## Encryption and Key Rotation

Crude Functions uses AES-256-GCM encryption for all sensitive data at rest.

### What Gets Encrypted

- Secrets (all scopes)
- API key values
- Better Auth secret
- Other sensitive settings

### Encryption Architecture

- Algorithm: AES-256-GCM (authenticated encryption)
- IV: 12 bytes, randomly generated per encryption
- Key size: 256 bits (32 bytes)
- Storage format: `VERSION_CHAR + base64(IV || ciphertext || auth_tag)`

### Key Versioning

- Each key has a single-character version: A-Z
- Current key version is prepended to encrypted data
- During rotation, both current and phased_out keys are available
- Old data is automatically re-encrypted to new version

### Automatic Key Rotation

Configuration:

- `encryption.key-rotation.interval-days` - Days between rotations (default: 90)
- `encryption.key-rotation.check-interval-seconds` - Check frequency (default: 10800 = 3 hours)
- `encryption.key-rotation.batch-size` - Records per batch (default: 100)
- `encryption.key-rotation.batch-sleep-ms` - Sleep between batches (default: 100ms)

### Manual Key Rotation

Via API:

```bash
# Check rotation status
curl -X GET "http://localhost:8000/api/encryption-keys/rotation" \
  -H "X-API-Key: your-management-key"

# Trigger manual rotation
curl -X POST "http://localhost:8000/api/encryption-keys/rotation" \
  -H "X-API-Key: your-management-key"
```

Response:

```json
{
  "lastRotationAt": "2025-10-15T08:30:00.000Z",
  "daysSinceRotation": 89,
  "nextRotationAt": "2026-01-13T08:30:00.000Z",
  "rotationIntervalDays": 90,
  "currentVersion": "B",
  "isInProgress": false
}
```

### Rotation Process

1. New encryption keys are generated
2. Rotation lock is acquired (blocks new encrypt/decrypt operations)
3. All encrypted data is re-encrypted in batches:
   - Secrets
   - API keys
   - Settings
4. Better Auth secret is rotated (invalidates all sessions)
5. Keys file is updated atomically
6. Rotation lock is released

### Backup and Recovery

**Important:** The encryption keys file (`data/encryption_keys.json`) must be backed up regularly!

Backup keys file:

```bash
cp data/encryption_keys.json data/encryption_keys.backup.json
```

To restore from backup:

```bash
cp data/encryption_keys.backup.json data/encryption_keys.json
# Restart the server
```

**Warning:** Losing encryption keys means permanent data loss. Secrets and API keys cannot be recovered without the keys file.

---

## REST API Reference

All management API endpoints require authentication via:

- Session cookie (for web UI)
- `X-API-Key` header with a key from the `api.access-groups` setting

Base URL: `http://localhost:8000` (or your configured domain)

### Functions Management

#### List all functions

```bash
GET /api/functions
```

Response:

```json
{
  "functions": [
    {
      "id": 1,
      "name": "hello",
      "handler": "code/hello.ts",
      "route": "/hello",
      "methods": ["GET", "POST"],
      "enabled": true,
      "description": "Hello world function",
      "keys": [1, 2],
      "createdAt": "2026-01-12T10:00:00.000Z",
      "updatedAt": "2026-01-12T10:00:00.000Z"
    }
  ]
}
```

#### Get function by ID

```bash
GET /api/functions/:id
```

#### Create function

```bash
POST /api/functions
Content-Type: application/json

{
  "name": "my-function",
  "handler": "code/my-function.ts",
  "route": "/my-function",
  "methods": ["GET"],
  "description": "My custom function",
  "keys": [1]
}
```

#### Update function

```bash
PUT /api/functions/:id
Content-Type: application/json

{
  "name": "my-function-updated",
  "handler": "code/my-function.ts",
  "route": "/my-function",
  "methods": ["GET", "POST"],
  "description": "Updated description",
  "keys": []
}
```

#### Delete function

```bash
DELETE /api/functions/:id
```

#### Enable/disable function

```bash
PUT /api/functions/:id/enable
PUT /api/functions/:id/disable
```

### API Keys Management

#### List all key groups

```bash
GET /api/key-groups
```

#### Create key group

```bash
POST /api/key-groups
Content-Type: application/json

{
  "name": "my-group",
  "description": "My API key group"
}
```

#### List all keys

```bash
GET /api/keys
GET /api/keys?groupId=1
```

#### Create API key

```bash
POST /api/keys
Content-Type: application/json

{
  "groupId": 1,
  "name": "my-key",
  "description": "My API key"
}
```

Response includes the generated key value (only shown once):

```json
{
  "id": 5,
  "name": "my-key",
  "value": "aGVsbG93b3JsZGhlbGxvd29ybGQ"
}
```

#### Update API key

```bash
PUT /api/keys/:id
Content-Type: application/json

{
  "name": "my-key-updated",
  "description": "Updated description"
}
```

#### Delete API key

```bash
DELETE /api/keys/:id
```

### Secrets Management

#### List all secrets

```bash
GET /api/secrets
GET /api/secrets?scope=global
GET /api/secrets?functionId=1
GET /api/secrets?includeValues=true
```

#### Get secret by ID

```bash
GET /api/secrets/:id
```

#### Search secrets by name

```bash
GET /api/secrets/by-name/:name
GET /api/secrets/by-name/:name?scope=global
```

#### Create secret

```bash
POST /api/secrets
Content-Type: application/json

{
  "name": "DATABASE_URL",
  "value": "postgresql://localhost:5432/mydb",
  "comment": "Production database",
  "scope": "global"
}
```

For scoped secrets:

```bash
# Function scope
{
  "name": "API_KEY",
  "value": "secret-value",
  "scope": "function",
  "functionId": 1
}

# Group scope
{
  "name": "API_KEY",
  "value": "secret-value",
  "scope": "group",
  "groupId": 2
}

# Key scope
{
  "name": "API_KEY",
  "value": "secret-value",
  "scope": "key",
  "keyId": 5
}
```

#### Update secret

```bash
PUT /api/secrets/:id
Content-Type: application/json

{
  "value": "new-value",
  "comment": "Updated comment"
}
```

#### Delete secret

```bash
DELETE /api/secrets/:id
```

### Logs Management

#### Query logs

```bash
GET /api/logs?functionId=1&limit=100
GET /api/logs?level=error,warn&limit=50
GET /api/logs?cursor=xyz&limit=100
```

#### Delete logs for function

```bash
DELETE /api/logs/:functionId
```

### Metrics Management

#### Query metrics

```bash
GET /api/metrics?resolution=minutes&functionId=1
GET /api/metrics?resolution=hours
GET /api/metrics?resolution=days&functionId=1
```

### Files Management

#### List files

```bash
GET /api/files
```

#### Get file contents

```bash
GET /api/files/:path
```

Example:

```bash
GET /api/files/code/hello.ts
```

#### Create/update file

```bash
PUT /api/files/:path
Content-Type: text/plain

export default async function(c, ctx) {
  return c.json({ message: "Hello" });
}
```

#### Delete file

```bash
DELETE /api/files/:path
```

### Settings Management

#### Get all settings

```bash
GET /api/settings
```

#### Update settings

```bash
PUT /api/settings
Content-Type: application/json

{
  "settings": {
    "log.level": "debug",
    "metrics.retention-days": "60"
  }
}
```

### Encryption Key Rotation

#### Get rotation status

```bash
GET /api/encryption-keys/rotation
```

#### Trigger manual rotation

```bash
POST /api/encryption-keys/rotation
```

---

## Integration Patterns

### Webhooks

Use Crude Functions to handle webhooks from external services:

```typescript
export default async function(c, ctx) {
  // Verify webhook signature
  const signature = c.req.header("X-Webhook-Signature");
  const secret = await ctx.getSecret("WEBHOOK_SECRET");

  // Parse payload
  const payload = await c.req.json();

  // Process webhook
  console.log("Webhook received:", payload);

  // Return 200 OK
  return c.json({ received: true });
}
```

Configure the function route to match your webhook URL and require API key authentication.

### Scheduled Jobs (Cron)

Use external cron or task scheduler to trigger functions:

```bash
# crontab entry
0 * * * * curl -X POST http://localhost:8000/run/hourly-task \
  -H "X-API-Key: your-key"
```

Function:

```typescript
export default async function(c, ctx) {
  console.log("Running hourly task...");

  // Perform task
  const result = await performTask();

  return c.json({ status: "completed", result });
}
```

### Reverse Proxy Setup

Use Nginx or similar to proxy Crude Functions:

```nginx
server {
  listen 80;
  server_name functions.example.com;

  location / {
    proxy_pass http://localhost:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `BETTER_AUTH_BASE_URL` environment variable:

```bash
BETTER_AUTH_BASE_URL=https://functions.example.com
```

### CI/CD Pipeline

Automate deployments using the REST API:

```bash
#!/bin/bash
# deploy.sh

API_KEY="your-management-key"
BASE_URL="http://localhost:8000"

# Update function code
curl -X PUT "$BASE_URL/api/files/code/my-function.ts" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary @my-function.ts

# Update function configuration
curl -X PUT "$BASE_URL/api/functions/1" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-function",
    "handler": "code/my-function.ts",
    "route": "/my-function",
    "methods": ["GET", "POST"]
  }'

# Check logs for errors
curl -X GET "$BASE_URL/api/logs?functionId=1&level=error&limit=10" \
  -H "X-API-Key: $API_KEY"
```

### Monitoring Integration

Export metrics to external monitoring systems:

```bash
#!/bin/bash
# export-metrics.sh

API_KEY="your-management-key"
BASE_URL="http://localhost:8000"

# Get metrics for all functions
curl -X GET "$BASE_URL/api/metrics?resolution=hours" \
  -H "X-API-Key: $API_KEY" \
  | jq '.data.metrics[]' \
  | while read -r metric; do
    # Send to monitoring system (e.g., Prometheus, DataDog)
    echo "$metric" | send-to-monitoring
  done
```

---

## Troubleshooting

### Function Returns 404

**Problem:** Request to `/run/my-function` returns 404

**Solutions:**

1. Check function is enabled: `GET /api/functions/:id`
2. Verify route path matches: Check `route` field
3. Verify HTTP method is allowed: Check `methods` field
4. Check handler file exists: `GET /api/files/code/my-function.ts`

### Handler Load Errors

**Problem:** Function returns 500 with "Handler not found" or syntax error

**Solutions:**

1. Check handler path is correct in function configuration
2. Verify file exists in code directory
3. Check for syntax errors in handler file
4. Ensure handler exports default function: `export default async (c, ctx) => { ... }`
5. Check imports use correct Deno specifiers:
   - NPM: `npm:package-name`
   - JSR: `jsr:@scope/package`
   - URLs: `https://esm.sh/package`

### API Key Authentication Fails

**Problem:** Request returns 401 Unauthorized

**Solutions:**

1. Verify API key exists: `GET /api/keys/:id`
2. Check key belongs to required group
3. Ensure header format: `X-API-Key: your-key-value`
4. Verify function's `keys` field includes the group ID
5. Check API key hasn't been deleted or rotated

### Secret Not Found

**Problem:** `ctx.getSecret()` returns `undefined`

**Solutions:**

1. Check secret exists: `GET /api/secrets/by-name/:name`
2. Verify scope is correct
3. For function-scoped secrets, check functionId matches
4. For group/key-scoped secrets, check API key group matches
5. Check for decryption errors in secret record

### Logs Not Appearing

**Problem:** Console output doesn't show in logs

**Solutions:**

1. Check log level setting: Must be at or below message level
2. Verify logs aren't being trimmed too aggressively
3. Check log batching delay hasn't caused buffering
4. Force flush: Wait 50ms (default batch delay) and refresh

### Metrics Missing

**Problem:** No metrics data for function

**Solutions:**

1. Check function has been executed recently
2. Verify metrics aggregation is running (check logs)
3. Check retention period hasn't expired data
4. Verify metric resolution matches data availability

### Encryption Errors

**Problem:** "Decryption failed" or "Wrong key" errors

**Solutions:**

1. Check encryption keys file exists: `data/encryption_keys.json`
2. Verify keys file hasn't been corrupted
3. Restore from backup if keys were lost
4. Check key rotation isn't in progress
5. Verify file permissions on keys file

### Performance Issues

**Problem:** Slow response times or high memory usage

**Solutions:**

1. Check metrics for execution times
2. Review logs for slow operations
3. Optimize handler code (avoid blocking operations)
4. Reduce log verbosity if excessive
5. Adjust log/metrics batching settings
6. Consider increasing batch sleep during key rotation

---

## Performance Characteristics

### Request Handling

- Cold start (first request): 50-200ms (dynamic import + execution)
- Warm requests: 1-10ms overhead + handler execution time
- Hot reload check: <1ms (mtime comparison)
- API key validation: <5ms (database lookup)

### Database Operations

- Secrets retrieval: <5ms (indexed queries)
- Log writes: Batched, <1ms per log (amortized)
- Metrics writes: Background, no impact on request latency
- Settings reads: Cached, <1ms

### Memory Usage

- Base process: ~50-100 MB
- Per handler (cached): ~1-5 MB
- Log buffer: ~1 MB (50 logs × ~20 KB)
- Database connections: ~10 MB

### Scalability Limits

- Functions: No hard limit (thousands supported)
- Concurrent requests: Limited by system resources
- Logs per function: 2,000 by default (configurable)
- Metrics history: 90 days by default (configurable)
- Secrets per scope: No hard limit (thousands supported)

### Optimization Tips

1. **Keep handlers small** - Large handlers take longer to reload
2. **Use secrets efficiently** - Cache values in handler-level variables
3. **Minimize console output** - Excessive logging impacts performance
4. **Enable only needed functions** - Disabled functions don't consume resources
5. **Adjust batch sizes** - Larger batches = fewer writes, more latency
6. **Monitor metrics** - Use API to track performance trends
7. **Regular cleanup** - Delete old logs and metrics periodically

---

## Configuration Reference

### Environment Variables

```bash
PORT=8000
BETTER_AUTH_BASE_URL=http://localhost:8000  # Optional, for OAuth
```

### Database Settings

All stored in `settings` table, manageable via API or Web UI:

#### Logging

- `log.level` - Minimum log level (debug/info/warn/error/none)
- `log.trimming.interval-seconds` - Trim frequency (1-86400)
- `log.trimming.max-per-function` - Max logs per function (100-100000)
- `log.trimming.retention-seconds` - Max log age (0-31536000)
- `log.batching.max-batch-size` - Logs per batch (1-500)
- `log.batching.max-delay-ms` - Flush delay (10-5000)

#### Metrics

- `metrics.aggregation-interval-seconds` - Aggregation frequency (10-3600)
- `metrics.retention-days` - Retention period (1-365)

#### Encryption

- `encryption.key-rotation.check-interval-seconds` - Check frequency (3600-86400)
- `encryption.key-rotation.interval-days` - Rotation interval (1-365)
- `encryption.key-rotation.batch-size` - Records per batch (10-1000)
- `encryption.key-rotation.batch-sleep-ms` - Sleep between batches (0-5000)

#### Security

- `api.access-groups` - Comma-separated group IDs for management API
- `files.max-size-bytes` - Max file size (1024-524288000)

#### General

- `server.name` - Display name in UI

---

## Additional Resources

- Main Documentation: See other files in `.ai/` directory
- Source Code: Review service implementations in `src/`
- Tests: See `*_test.ts` files for usage examples
- CLAUDE.md: Development guide and architecture overview

For questions or issues, review the codebase or consult the development team.
