---
title: Configuration & Settings
description: Environment variables and system settings
---

Crude Functions uses a minimal configuration approach. Most settings are stored in the database and managed through the web UI, while only a few environment variables control core server behavior.

## Configuration Overview

Crude Functions has two types of configuration:

1. **Environment Variables** - Set before server startup, control core infrastructure
2. **Database Settings** - Stored in the database, configurable at runtime via web UI or API

### What Requires Server Restart?

**Environment variables** require a server restart to take effect:

- `PORT`
- `AUTH_BASE_URL`

**Database settings** take effect immediately or after a short delay (no restart needed):

- Most settings apply immediately when changed
- Log level changes apply within seconds (periodic refresh)
- Metrics and log trimming intervals apply on next scheduled run
- Encryption key rotation settings apply on next check interval

## Environment Variables

Environment variables are set in your `.env` file or docker-compose.yml. Crude Functions requires minimal environment configuration.

### Available Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | `8000` | No |
| `AUTH_BASE_URL` | Base URL for authentication redirects | Auto-detected | No |

### PORT

The HTTP port the server listens on.

**Default:** `8000`

**When to change:**

- Port 8000 is already in use
- Corporate policy requires specific ports
- Running multiple instances locally

**Example:**

```bash
# .env
PORT=3000
```

```yaml
# docker-compose.yml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    environment:
      - PORT=3000
    ports:
      - 3000:3000  # Map host:container
```

### AUTH_BASE_URL

The base URL used for authentication redirects and callbacks. Better Auth uses this to construct redirect URLs during login/logout flows.

**Default:** Auto-detected from request headers (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`)

**When to set manually:**

- Behind a reverse proxy with complex routing
- Auto-detection fails (rare)
- Using a custom domain
- Development with tunneling tools (ngrok, cloudflared)

**Format:** Full URL including protocol, no trailing slash

**Examples:**

```bash
# .env

# Production behind reverse proxy
AUTH_BASE_URL=https://functions.company.com

# Development
AUTH_BASE_URL=http://localhost:8000

# Ngrok tunnel
AUTH_BASE_URL=https://abc123.ngrok.io
```

**Auto-detection behavior:**

The server inspects these headers in order:

1. `X-Forwarded-Proto` + `X-Forwarded-Host`
2. `X-Forwarded-Proto` + `Host`
3. `http://` + `Host`

Most reverse proxies (nginx, Caddy, Traefik) set these headers correctly. Manual configuration is only needed for edge cases.

## Database Settings

All other configuration is stored in the database and managed through the web UI Settings page or API. Settings are organized into categories.

### Settings Categories

Database settings are grouped into five categories:

- **General** - Server display name and basic configuration
- **Logging** - Log capture, retention, and trimming
- **Metrics** - Execution metrics aggregation and retention
- **Encryption** - Automatic key rotation configuration
- **Security** - API access control and file size limits

### Complete Settings Reference

| Setting | Category | Default | Description |
|---------|----------|---------|-------------|
| `server.name` | General | `"Crude Functions"` | Display name shown in web UI title and navigation |
| `log.level` | Logging | `"info"` | Minimum log level to capture (debug, info, warn, error, none) |
| `log.trimming.interval-seconds` | Logging | `300` | How often to trim old logs (5 minutes) |
| `log.trimming.max-per-function` | Logging | `2000` | Maximum number of logs to keep per function |
| `log.trimming.retention-seconds` | Logging | `7776000` | How long to keep logs (90 days). Set to 0 to disable time-based deletion |
| `log.batching.max-batch-size` | Logging | `50` | Maximum logs to buffer before writing to database |
| `log.batching.max-delay-ms` | Logging | `50` | Maximum delay before flushing buffered logs |
| `metrics.aggregation-interval-seconds` | Metrics | `60` | How often to aggregate metrics (1 minute) |
| `metrics.retention-days` | Metrics | `90` | Days to retain aggregated metrics |
| `encryption.key-rotation.check-interval-seconds` | Encryption | `10800` | How often to check if key rotation is needed (3 hours) |
| `encryption.key-rotation.interval-days` | Encryption | `90` | Days between automatic key rotations |
| `encryption.key-rotation.batch-size` | Encryption | `100` | Records to re-encrypt per batch during rotation |
| `encryption.key-rotation.batch-sleep-ms` | Encryption | `100` | Sleep between re-encryption batches (milliseconds) |
| `api.access-groups` | Security | ID of `management` group | API key groups allowed to access management API endpoints |
| `files.max-size-bytes` | Security | `52428800` | Maximum allowed file size (50 MB) |

## Managing Settings via Web UI

Navigate to **Settings** in the sidebar to access the settings management page.

:::tip[Screenshot Placeholder]
*TODO: Add screenshot showing the Settings page with categories*
:::

### Viewing Settings

Settings are displayed in collapsible sections by category:

- **General** - Server name customization
- **Logging** - Log capture and retention controls
- **Metrics** - Metrics aggregation and retention
- **Encryption** - Key rotation automation
- **Security** - API access and file size limits

Each setting shows:

- Label and description
- Current value
- Input type (text, number, dropdown, checkbox group)
- Validation constraints (min/max for numbers, allowed values for dropdowns)

### Changing Settings

1. Navigate to **Settings** in the sidebar
2. Expand the category you want to modify
3. Update the value:
   - **Text fields** - Enter the new value
   - **Number fields** - Use spinner or type value (respects min/max)
   - **Dropdowns** - Select from allowed values
   - **Checkbox groups** - Select multiple items (e.g., API key groups)
4. Click **Save** at the bottom of the category section
5. Changes take effect immediately (or on next scheduled interval)

:::tip[Screenshot Placeholder]
*TODO: Add screenshot showing editing a setting with validation*
:::

### Resetting to Defaults

To reset a setting to its default value:

1. Navigate to the setting in the web UI
2. Clear the current value
3. Enter the default value from the table above
4. Click **Save**

Alternatively, use the API to reset settings programmatically (see below).

## Managing Settings via API

Settings can be managed programmatically using the `/api/settings` endpoints.

### Get All Settings

```bash
curl -H "X-API-Key: your-management-key" \
  http://localhost:8000/api/settings
```

**Response:**

```json
{
  "data": {
    "server.name": "Crude Functions",
    "log.level": "info",
    "log.trimming.interval-seconds": "300",
    "log.trimming.max-per-function": "2000",
    "metrics.retention-days": "90",
    "api.access-groups": "1",
    "encryption.key-rotation.interval-days": "90"
  }
}
```

### Update Multiple Settings

Update one or more settings atomically in a single transaction:

```bash
curl -X PUT \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.level": "debug",
      "metrics.retention-days": "30",
      "server.name": "My Functions"
    }
  }' \
  http://localhost:8000/api/settings
```

**Request body:**

```json
{
  "settings": {
    "setting.name": "value",
    "another.setting": "value"
  }
}
```

**Response:**

```json
{
  "data": {
    "message": "Settings updated successfully"
  }
}
```

All settings are updated together. If any setting is invalid, the entire update is rolled back.

### Setting Value Types

All settings are stored as strings in the database. The web UI and your application code are responsible for parsing them appropriately:

- **Numbers:** Store as string (`"300"`), parse with `parseInt()` or `parseFloat()`
- **Booleans:** Not directly supported - use numbers (`"0"` or `"1"`) or strings (`"true"` or `"false"`)
- **Lists:** Store comma-separated values (`"1,2,3"`) or use `api.access-groups` format (comma-separated IDs)
- **Text:** Store as-is

**Example - Parsing settings:**

```typescript
// In application code
const retentionDays = parseInt(await settingsService.getGlobalSetting("metrics.retention-days") || "90");
const logLevel = await settingsService.getGlobalSetting("log.level") || "info";
```

## Settings Categories Explained

### General Settings

**Server Name** (`server.name`)

Customize the display name shown in the web UI:

- Page title (browser tab)
- Navigation header
- Login page

Default: `"Crude Functions"`

**Example:** Change to `"My Company Functions"` or `"Dev Functions"` to distinguish between environments.

### Logging Settings

Control how function execution logs are captured, stored, and retained.

**Log Level** (`log.level`)

Minimum severity level to capture from function handlers:

- `"debug"` - Capture everything including `console.debug()`
- `"info"` - Capture `console.info()`, `console.log()`, `console.warn()`, `console.error()`
- `"warn"` - Capture `console.warn()` and `console.error()`
- `"error"` - Capture only `console.error()`
- `"none"` - Disable log capture

Default: `"info"`

Changes apply within seconds (periodic refresh).

**Log Trimming Interval** (`log.trimming.interval-seconds`)

How often to run the log cleanup process. Logs exceeding the max-per-function or retention period are deleted.

Range: 1-86400 seconds (1 second - 24 hours)
Default: `300` (5 minutes)

**Max Logs Per Function** (`log.trimming.max-per-function`)

Maximum number of log entries to keep per function. Oldest logs are deleted first when the limit is exceeded.

Range: 100-100000
Default: `2000`

**Log Retention Period** (`log.trimming.retention-seconds`)

Maximum age of logs before automatic deletion. Logs older than this are deleted during trimming.

Range: 0-31536000 seconds (0 - 365 days)
Default: `7776000` (90 days)
Special: Set to `0` to disable time-based deletion (only count-based trimming applies)

**Log Batch Size** (`log.batching.max-batch-size`)

Maximum number of logs to buffer in memory before writing to database. Higher values reduce database writes but increase memory usage.

Range: 1-500
Default: `50`

**Log Batch Delay** (`log.batching.max-delay-ms`)

Maximum delay before flushing buffered logs to database. Even if batch size isn't reached, logs are written after this delay.

Range: 10-5000 milliseconds
Default: `50` (50ms)

### Metrics Settings

Control execution metrics aggregation and retention.

**Metrics Aggregation Interval** (`metrics.aggregation-interval-seconds`)

How often to aggregate raw execution metrics into time-series data. Aggregation runs in background.

Range: 10-3600 seconds (10 seconds - 1 hour)
Default: `60` (1 minute)

Lower values provide more granular metrics but increase database writes.

**Metrics Retention Period** (`metrics.retention-days`)

How long to keep aggregated metrics before automatic deletion.

Range: 1-365 days
Default: `90`

### Encryption Settings

Configure automatic encryption key rotation for API keys, secrets, and encrypted settings.

**Key Rotation Check Interval** (`encryption.key-rotation.check-interval-seconds`)

How often to check if key rotation is due. If rotation is needed, it starts automatically.

Range: 3600-86400 seconds (1-24 hours)
Default: `10800` (3 hours)

**Key Rotation Interval** (`encryption.key-rotation.interval-days`)

Days between automatic key rotations. When this period elapses, all encrypted data is re-encrypted with new keys.

Range: 1-365 days
Default: `90`

**Key Rotation Batch Size** (`encryption.key-rotation.batch-size`)

Number of records to re-encrypt per batch during rotation. Smaller batches reduce resource usage but increase rotation time.

Range: 10-1000
Default: `100`

**Key Rotation Batch Sleep** (`encryption.key-rotation.batch-sleep-ms`)

Milliseconds to sleep between re-encryption batches. Adds delay to reduce resource spikes during rotation.

Range: 0-5000 milliseconds
Default: `100`

Set to `0` for fastest rotation (no delay).

### Security Settings

**API Access Groups** (`api.access-groups`)

Controls which API key groups can access management endpoints (`/api/functions`, `/api/keys`, `/api/settings`, etc.).

Format: Comma-separated group IDs (e.g., `"1,3,5"`)
Default: ID of the `management` group (created automatically)

**Example:**

- Allow only `management` group: `"1"`
- Allow `management` and `admin` groups: `"1,3"`

**In the web UI:**

The setting is displayed as a checkbox group showing all available API key groups. Select the groups that should have management access.

:::tip[Screenshot Placeholder]
*TODO: Add screenshot showing API Access Groups checkbox selection*
:::

**Maximum File Size** (`files.max-size-bytes`)

Maximum allowed file size for code files uploaded via `/api/files` endpoints or web UI.

Range: 1024-524288000 bytes (1 KB - 500 MB)
Default: `52428800` (50 MB)

Files exceeding this limit are rejected with a 400 error.

## Setting Update Behavior

### Immediate Effect

These settings apply immediately when changed:

- `server.name` - Next page load
- `api.access-groups` - Next API request
- `files.max-size-bytes` - Next file upload

### Periodic Refresh

These settings apply on the next scheduled interval:

- `log.level` - Refreshed every few seconds
- `log.trimming.*` - Apply on next trimming run
- `metrics.aggregation-interval-seconds` - Apply on next aggregation run
- `metrics.retention-days` - Apply on next cleanup
- `encryption.key-rotation.*` - Apply on next rotation check

### No Restart Required

Changing database settings **never** requires a server restart. The settings service reads from the database dynamically.

## Backup and Restore

Settings are stored in the `settings` table in `data/database.db`. Backing up the database preserves all settings.

### Backup Settings

```bash
# Stop the container
docker compose down

# Backup data directory (includes database and settings)
tar -czf crude-functions-backup-$(date +%Y%m%d).tar.gz data/

# Restart
docker compose up -d
```

### Restore Settings

```bash
# Stop the container
docker compose down

# Restore from backup
tar -xzf crude-functions-backup-20260112.tar.gz

# Restart
docker compose up -d
```

All settings are restored along with the database.

### Export Settings via API

```bash
# Export all settings to JSON
curl -H "X-API-Key: your-management-key" \
  http://localhost:8000/api/settings > settings-backup.json
```

### Import Settings via API

```bash
# Restore from JSON backup
curl -X PUT \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d @settings-backup.json \
  http://localhost:8000/api/settings
```

## Bootstrap Process

On first startup, Crude Functions automatically creates all settings with default values if they don't exist. This happens during the initialization flow in `main.ts`:

1. Database opens
2. Migrations run
3. SettingsService initializes
4. `bootstrapGlobalSettings()` creates missing settings

**What this means:**

- Fresh installations get default settings automatically
- Upgrading preserves your existing settings
- New settings added in updates are created with defaults
- No manual setup required

## Common Configuration Scenarios

### Development Environment

```bash
# .env
PORT=3000
AUTH_BASE_URL=http://localhost:3000

# Settings via API
curl -X PUT \
  -H "X-API-Key: mgmt-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.level": "debug",
      "server.name": "Dev Functions",
      "metrics.retention-days": "7"
    }
  }' \
  http://localhost:3000/api/settings
```

### Production Environment

```bash
# .env
PORT=8000
AUTH_BASE_URL=https://functions.company.com

# Settings via API
curl -X PUT \
  -H "X-API-Key: mgmt-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.level": "info",
      "server.name": "Production Functions",
      "metrics.retention-days": "90",
      "log.trimming.max-per-function": "5000"
    }
  }' \
  https://functions.company.com/api/settings
```

### High-Volume Environment

```bash
# Optimize for performance
curl -X PUT \
  -H "X-API-Key: mgmt-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.batching.max-batch-size": "100",
      "log.batching.max-delay-ms": "100",
      "log.trimming.interval-seconds": "600",
      "metrics.aggregation-interval-seconds": "300"
    }
  }' \
  http://localhost:8000/api/settings
```

### Resource-Constrained Environment

```bash
# Reduce retention and batch sizes
curl -X PUT \
  -H "X-API-Key: mgmt-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "log.trimming.max-per-function": "500",
      "log.trimming.retention-seconds": "604800",
      "metrics.retention-days": "7",
      "log.batching.max-batch-size": "25"
    }
  }' \
  http://localhost:8000/api/settings
```

## Troubleshooting

### Settings Not Taking Effect

**Possible causes:**

1. Cached in browser (for web UI changes)
2. Waiting for next scheduled interval (for periodic settings)
3. Invalid value rejected silently

**Solution:**

- Refresh the browser (Ctrl+F5)
- Wait for next scheduled interval (check setting description)
- Verify setting was saved: `GET /api/settings`
- Check server logs for validation errors

### Cannot Access Settings Page

**Cause:** Not authenticated or session expired

**Solution:**

- Log in to web UI: `/web`
- Verify session is active
- Use API with valid management key instead

### API Access Groups Not Working

**Cause:** `api.access-groups` setting is misconfigured

**Solution:**

- Verify group IDs are correct: `GET /api/key-groups`
- Ensure format is comma-separated IDs: `"1,3,5"`
- Default to management group: Get ID from `GET /api/key-groups`, set `"<id>"`

### Log Level Changes Not Applying

**Cause:** Periodic refresh delay

**Solution:**

- Wait 10-15 seconds for refresh
- Restart server to force immediate refresh (only if urgent)
- Verify setting saved: `GET /api/settings`

## Related Topics

- [First-Time Setup](/guides/first-time-setup) - Initial configuration during setup
- [API Keys](/guides/api-keys) - Managing API access groups
- [Secrets Management](/guides/secrets) - Encryption and key rotation
- [Deployment](/guides/deployment) - Production configuration and reverse proxy setup
- [API Reference](/reference/api) - Full settings API documentation
