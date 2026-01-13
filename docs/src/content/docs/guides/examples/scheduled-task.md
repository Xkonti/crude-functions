---
title: "Example: Scheduled Task"
description: Running automated maintenance tasks with cron
---

Crude Functions doesn't have built-in task scheduling, but you can trigger functions on a schedule using external cron jobs or task schedulers. This pattern is ideal for maintenance tasks, cleanup operations, backups, and periodic reports.

## Overview

This example demonstrates:

- Creating a cleanup/maintenance function
- Protecting the endpoint with API keys
- Triggering via cron + curl
- Proper logging for monitoring
- Database operations within scheduled tasks
- Error handling and reporting

## The Cleanup Function

Create a function that performs regular maintenance tasks like deleting old logs, cleaning up expired sessions, and optimizing the database.

### File: `code/tasks/cleanup.ts`

```typescript
// POST /tasks/cleanup
// Automated cleanup task - triggered by cron

export default async function (c, ctx) {
  console.log(`Starting cleanup task at ${new Date().toISOString()}`);
  console.log(`Request ID: ${ctx.requestId}`);

  const results = {
    deletedLogs: 0,
    deletedSessions: 0,
    deletedFiles: 0,
    databaseVacuumed: false,
    errors: [] as string[],
  };

  try {
    // Delete old logs (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedLogs = await db.logs.deleteOlderThan(thirtyDaysAgo);
    results.deletedLogs = deletedLogs;
    console.log(`Deleted ${deletedLogs} old logs`);

    // Delete expired sessions
    const deletedSessions = await db.sessions.deleteExpired();
    results.deletedSessions = deletedSessions;
    console.log(`Deleted ${deletedSessions} expired sessions`);

    // Delete temporary files older than 7 days
    const tempFilesCutoff = new Date();
    tempFilesCutoff.setDate(tempFilesCutoff.getDate() - 7);

    const tempFiles = await Deno.readDir("./temp");
    let deletedFiles = 0;

    for await (const entry of tempFiles) {
      if (!entry.isFile) continue;

      const filePath = `./temp/${entry.name}`;
      const fileInfo = await Deno.stat(filePath);

      if (fileInfo.mtime && fileInfo.mtime < tempFilesCutoff) {
        await Deno.remove(filePath);
        deletedFiles++;
      }
    }

    results.deletedFiles = deletedFiles;
    console.log(`Deleted ${deletedFiles} temporary files`);

    // Vacuum database to reclaim space
    await db.vacuum();
    results.databaseVacuumed = true;
    console.log("Database vacuumed successfully");

    // Success response
    console.log(`Cleanup completed successfully at ${new Date().toISOString()}`);

    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId,
      results,
    });
  } catch (error) {
    console.error(`Cleanup task failed:`, error);
    results.errors.push(error.message);

    return c.json({
      success: false,
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId,
      results,
      error: error.message,
    }, 500);
  }
}

// Database helper (simplified - you'd import from your lib)
const db = {
  logs: {
    async deleteOlderThan(cutoffDate: Date): Promise<number> {
      // Implementation: DELETE FROM logs WHERE timestamp < cutoffDate
      return 42; // Example count
    },
  },
  sessions: {
    async deleteExpired(): Promise<number> {
      // Implementation: DELETE FROM sessions WHERE expires_at < NOW()
      return 15; // Example count
    },
  },
  async vacuum(): Promise<void> {
    // Implementation: VACUUM
  },
};
```

## Registering the Function

Register the cleanup function via the web UI or API, and protect it with API keys so only your cron job can trigger it.

### Via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click "Create Function"
3. Fill in:
   - **Name**: `cleanup-task`
   - **Route**: `/tasks/cleanup`
   - **Handler**: `tasks/cleanup.ts`
   - **Methods**: `POST`
   - **Description**: `Daily cleanup and maintenance task`
   - **API Key Protection**: Select `management` group (or create a dedicated `cron` group)
4. Click "Save"

### Via API

```bash
curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cleanup-task",
    "route": "/tasks/cleanup",
    "handler": "tasks/cleanup.ts",
    "methods": ["POST"],
    "description": "Daily cleanup and maintenance task",
    "keys": [1]
  }'
```

## Creating an API Key for Cron

Create a dedicated API key for your scheduled tasks. This allows you to:

- Identify cron requests in logs
- Revoke cron access without affecting other keys
- Track scheduled task executions separately

### Generate Cron Key

**Via Web UI:**

1. Go to `http://localhost:8000/web/keys`
2. Click on the `management` group (or create a new `cron` group)
3. Click "Generate Key"
4. Name: `cron-cleanup`
5. Description: `Key for automated cleanup task`
6. Copy the generated key value

**Via API:**

```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 1,
    "name": "cron-cleanup",
    "description": "Key for automated cleanup task"
  }'
```

Response includes the key value (only shown once):

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "cron-cleanup",
    "value": "aGVsbG93b3JsZGhlbGxvd29ybGQ"
  }
}
```

**Save this key value securely** - you'll use it in your crontab.

## Setting Up Cron

Configure cron to trigger your function on a schedule. You can use the system crontab or a dedicated cron file.

### System Crontab

Edit your user's crontab:

```bash
crontab -e
```

Add entries for your scheduled tasks:

```bash
# Daily cleanup at 2:00 AM
0 2 * * * curl -X POST -H "X-API-Key: aGVsbG93b3JsZGhlbGxvd29ybGQ" http://localhost:8000/run/tasks/cleanup

# Hourly backup at :30
30 * * * * curl -X POST -H "X-API-Key: aGVsbG93b3JsZGhlbGxvd29ybGQ" http://localhost:8000/run/tasks/backup

# Weekly report every Monday at 9:00 AM
0 9 * * 1 curl -X POST -H "X-API-Key: aGVsbG93b3JsZGhlbGxvd29ybGQ" http://localhost:8000/run/tasks/weekly-report
```

### Dedicated Cron File

For system-wide scheduled tasks, create a file in `/etc/cron.d/`:

```bash
# /etc/cron.d/crude-functions
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
API_KEY=aGVsbG93b3JsZGhlbGxvd29ybGQ
BASE_URL=http://localhost:8000

# Daily cleanup at 2:00 AM
0 2 * * * root curl -X POST -H "X-API-Key: $API_KEY" $BASE_URL/run/tasks/cleanup

# Hourly backup
30 * * * * root curl -X POST -H "X-API-Key: $API_KEY" $BASE_URL/run/tasks/backup

# Weekly report every Monday at 9:00 AM
0 9 * * 1 root curl -X POST -H "X-API-Key: $API_KEY" $BASE_URL/run/tasks/weekly-report
```

### Docker Container Cron

If running Crude Functions in Docker, you can run cron in a separate container:

```yaml
# docker-compose.yml
version: '3.8'

services:
  crude-functions:
    image: crude-functions:latest
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./code:/app/code

  cron:
    image: alpine:latest
    command: crond -f -l 2
    volumes:
      - ./crontab:/etc/crontabs/root:ro
    depends_on:
      - crude-functions
```

Create `crontab` file:

```bash
# crontab
0 2 * * * curl -X POST -H "X-API-Key: aGVsbG93b3JsZGhlbGxvd29ybGQ" http://crude-functions:8000/run/tasks/cleanup
```

## Testing the Scheduled Task

Before relying on cron, test your function manually.

### Manual Trigger

```bash
curl -X POST http://localhost:8000/run/tasks/cleanup \
  -H "X-API-Key: aGVsbG93b3JsZGhlbGxvd29ybGQ"
```

**Expected response:**

```json
{
  "success": true,
  "timestamp": "2026-01-12T14:30:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "results": {
    "deletedLogs": 42,
    "deletedSessions": 15,
    "deletedFiles": 7,
    "databaseVacuumed": true,
    "errors": []
  }
}
```

### Test Without API Key

Verify that the endpoint is protected:

```bash
curl -X POST http://localhost:8000/run/tasks/cleanup
```

**Expected response:**

```json
{
  "error": "Unauthorized"
}
```

**Status:** 401

### Test with Wrong Key

```bash
curl -X POST http://localhost:8000/run/tasks/cleanup \
  -H "X-API-Key: wrong-key"
```

**Expected response:**

```json
{
  "error": "Unauthorized"
}
```

**Status:** 401

## Monitoring Scheduled Tasks

Check execution logs to verify your scheduled tasks are running correctly.

### View Logs via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Click on "cleanup-task"
3. Go to the Logs tab
4. Filter by:
   - Date range (last 24 hours, last 7 days, etc.)
   - Log level (show only errors, warnings, etc.)
   - Search for specific text

### Query Logs via API

```bash
# Get recent logs for the cleanup function
curl -X GET "http://localhost:8000/api/logs?functionId=1&limit=50" \
  -H "X-API-Key: your-management-key"
```

**Look for:**

- `exec_start` entries showing task execution began
- Log messages from your function (`Starting cleanup task...`)
- `exec_end` entries showing task completion
- Any error messages

### Example Log Output

```json
{
  "data": [
    {
      "id": 1001,
      "timestamp": "2026-01-12T02:00:00.123Z",
      "level": "exec_start",
      "message": "Execution started",
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "functionId": 1
    },
    {
      "id": 1002,
      "timestamp": "2026-01-12T02:00:00.125Z",
      "level": "log",
      "message": "Starting cleanup task at 2026-01-12T02:00:00.125Z",
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "functionId": 1
    },
    {
      "id": 1003,
      "timestamp": "2026-01-12T02:00:01.234Z",
      "level": "log",
      "message": "Deleted 42 old logs",
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "functionId": 1
    },
    {
      "id": 1004,
      "timestamp": "2026-01-12T02:00:02.456Z",
      "level": "exec_end",
      "message": "Execution completed",
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "functionId": 1
    }
  ]
}
```

### Check Metrics

View execution metrics to track performance:

```bash
curl -X GET "http://localhost:8000/api/metrics?resolution=days&functionId=1" \
  -H "X-API-Key: your-management-key"
```

**Metrics include:**

- Average execution time
- Maximum execution time
- Total execution count per day

## Advanced Patterns

### Cleanup with Notifications

Send notifications when cleanup completes or fails:

```typescript
export default async function (c, ctx) {
  console.log(`Starting cleanup at ${new Date().toISOString()}`);

  try {
    // Perform cleanup tasks...
    const results = await performCleanup();

    // Send success notification
    await sendNotification({
      type: 'success',
      subject: 'Daily Cleanup Complete',
      message: `Deleted ${results.deletedLogs} logs, ${results.deletedSessions} sessions`,
    });

    return c.json({ success: true, results });
  } catch (error) {
    console.error('Cleanup failed:', error);

    // Send failure notification
    await sendNotification({
      type: 'error',
      subject: 'Daily Cleanup Failed',
      message: `Error: ${error.message}`,
    });

    return c.json({ success: false, error: error.message }, 500);
  }
}

async function sendNotification(options: {
  type: string;
  subject: string;
  message: string;
}) {
  // Send email, Slack message, etc.
}
```

### Conditional Cleanup

Only perform expensive operations when necessary:

```typescript
export default async function (c, ctx) {
  // Check if cleanup is needed
  const logCount = await db.logs.count();

  if (logCount < 10000) {
    console.log(`Log count (${logCount}) below threshold, skipping cleanup`);
    return c.json({ success: true, skipped: true, reason: 'below threshold' });
  }

  // Proceed with cleanup
  console.log(`Log count (${logCount}) above threshold, performing cleanup`);
  const deleted = await db.logs.deleteOldest(5000);

  return c.json({ success: true, deletedLogs: deleted });
}
```

### Progress Reporting

For long-running tasks, log progress at intervals:

```typescript
export default async function (c, ctx) {
  console.log('Starting large cleanup task');

  const tasks = [
    { name: 'logs', fn: cleanupLogs },
    { name: 'sessions', fn: cleanupSessions },
    { name: 'files', fn: cleanupFiles },
    { name: 'cache', fn: cleanupCache },
    { name: 'database', fn: vacuumDatabase },
  ];

  const results: Record<string, number> = {};

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`[${i + 1}/${tasks.length}] Starting ${task.name} cleanup`);

    const result = await task.fn();
    results[task.name] = result;

    console.log(`[${i + 1}/${tasks.length}] Completed ${task.name}: ${result} items`);
  }

  console.log('All cleanup tasks completed');
  return c.json({ success: true, results });
}
```

### Idempotent Operations

Ensure tasks can be safely retried:

```typescript
export default async function (c, ctx) {
  // Use request ID to track completion
  const completionKey = `cleanup:${new Date().toISOString().slice(0, 10)}`;

  // Check if already run today
  const alreadyRun = await cache.get(completionKey);

  if (alreadyRun) {
    console.log('Cleanup already completed today, skipping');
    return c.json({ success: true, skipped: true, reason: 'already run' });
  }

  // Perform cleanup
  const results = await performCleanup();

  // Mark as completed
  await cache.set(completionKey, 'true', { ttl: 86400 }); // 24 hours

  return c.json({ success: true, results });
}
```

## Cron Expression Reference

Common cron patterns for scheduled tasks:

```bash
# Every minute
* * * * * command

# Every hour at :30
30 * * * * command

# Every day at 2:00 AM
0 2 * * * command

# Every Sunday at 3:00 AM
0 3 * * 0 command

# Every weekday at 9:00 AM
0 9 * * 1-5 command

# First day of every month at midnight
0 0 1 * * command

# Every 6 hours
0 */6 * * * command

# Every 15 minutes
*/15 * * * * command
```

**Format:** `minute hour day month weekday command`

- `*` = every
- `*/N` = every N units
- `N-M` = range from N to M
- `N,M` = specific values N and M

## Troubleshooting

### Cron Not Executing

**Check cron service status:**

```bash
systemctl status cron
```

**View cron logs:**

```bash
# Debian/Ubuntu
grep CRON /var/log/syslog

# RedHat/CentOS
grep CRON /var/log/cron
```

**Test curl command manually:**

```bash
curl -X POST -H "X-API-Key: your-key" http://localhost:8000/run/tasks/cleanup
```

### Execution Logs Missing

Check that your function is logging properly:

```typescript
// Always log at start and end
console.log(`Starting task at ${new Date().toISOString()}`);
// ... task logic ...
console.log(`Completed task at ${new Date().toISOString()}`);
```

Check log retention settings to ensure logs aren't being trimmed too aggressively.

### Function Returns Error

Check error response and logs:

```bash
# Get recent error logs
curl -X GET "http://localhost:8000/api/logs?level=error&limit=20" \
  -H "X-API-Key: your-management-key"
```

Common issues:

- Database connection failures
- File permission errors
- Insufficient disk space
- Timeout on long operations

## Best Practices

1. **Protect endpoints** - Always require API keys for scheduled tasks
2. **Dedicated keys** - Create separate API keys for cron jobs
3. **Log extensively** - Include timestamps, counts, and completion status
4. **Handle errors gracefully** - Return proper status codes and error messages
5. **Monitor regularly** - Check logs and metrics to ensure tasks are running
6. **Test manually first** - Always test with curl before adding to cron
7. **Set up alerts** - Notify on failures using external monitoring
8. **Use idempotency** - Allow safe retries if cron runs multiple times
9. **Limit runtime** - Keep tasks short or implement timeout logic
10. **Document schedule** - Comment crontab entries with purpose and frequency

## Related Documentation

- [API Keys & Authentication](/guides/api-keys) - Protecting functions with API keys
- [Writing Functions](/guides/writing-functions) - Function structure and best practices
- [Logging](/reference/logging) - Understanding execution logs
- [Metrics](/reference/metrics) - Tracking function performance

---

**Next Steps:**

- Create your cleanup function in `code/tasks/cleanup.ts`
- Register the function and protect it with an API key
- Test manually with curl
- Add to crontab with your schedule
- Monitor logs to verify execution
