---
title: Code Sources
description: Managing code sources, Git integration, and sync strategies
---

Code sources are the foundation of how Crude Functions organizes code files. Each source represents a directory containing TypeScript/JavaScript files that can be used within deployed function endpoints.

## What are Code Sources?

A code source represents a collection of related files stored in a subdirectory within `code` directory of the Docker container. Each source has:

- **Name** - Unique identifier (also the directory name)
- **Type** - Either "manual" or "git" (more types coming soon)
- **Files** - Handler scripts and shared utilities
- **Sync Settings** - Configuration for automatic updates (git sources only)

**Directory structure:**

```
code/
├── my-api/           ← Manual source
│   ├── users.ts
│   └── posts.ts
├── webhooks/         ← Git source (synced from GitHub)
│   ├── github.ts
│   ├── stripe.ts
│   └── helpers/
│       └── validators.ts
└── internal/         ← Another manual source
    └── admin.ts
```

This structure lets you organize functions by project, environment, or team, and choose how each collection of code is managed.

## Source Types

### Manual Sources

Manual sources are editable via the web UI or API. You directly upload, create, edit, and delete files. While convenient for small handlers, it's not the most practical solution when it comes to larger projects.

### Git Sources

Git sources automatically sync files from a Git repository. Files inside git code sources are read-only - they can't be modified via Web UI nor API. You commit changes to your repository and trigger a sync.

**Capabilities:**

- ✅ Automatic sync from repository
- ✅ Branch/tag/commit targeting
- ✅ Private repository support (auth tokens)
- ✅ Webhook triggers

## Creating a Manual Source

1. Navigate to `http://localhost:8000/web/code`
2. Click "Create New Source"
3. Fill in the form:
   - **Name**: `my-api` (alphanumeric, hyphens, underscores, 1-64 chars)
   - **Type**: Select "Manual"
4. Click "Create"

The source is immediately ready for file uploads.

## Creating a Git Source

### Requirements

- HTTPS Git URL (e.g., `https://github.com/user/repo.git`)
- For private repos: Personal access token or deploy key
- One of: branch name, tag name, or commit SHA

1. Navigate to `http://localhost:8000/web/code`
2. Click "Create New Source"
3. Choose the git source
3. Fill in the form:
   - **Name**: `production-api`
   - **Git URL**: `https://github.com/yourorg/functions.git`
   - **Reference Type**: Branch / Tag / Commit
   - **Reference Value**: `main` (branch)
   - **Auth Token**: (optional, for private repos)
   -
4. Click "Create Source"

The source is created and an initial sync is triggered automatically.

### Via API

```bash
curl -X POST http://localhost:8000/api/sources \
  -H "X-API-Key: your-management-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-api",
    "type": "git",
    "typeSettings": {
      "url": "https://github.com/yourorg/functions.git",
      "branch": "main",
      "authToken": "ghp_xxxxxxxxxxxx"
    },
    "syncSettings": {
      "intervalSeconds": 300,
      "webhookEnabled": true,
      "webhookSecret": "your-secure-random-string"
    },
    "enabled": true
  }'
```

**Git Type Settings:**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | HTTPS git URL |
| `branch` | No* | Branch name (default: "main") |
| `tag` | No* | Tag name (e.g., "v1.0.0") |
| `commit` | No* | Full commit SHA |
| `authToken` | No | Personal access token for private repos |

*Only one of branch/tag/commit can be specified. If none provided, defaults to `main` branch.

### Setting Up GitHub Personal Access Token

For private repositories, you'll need a token with read access:

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` (Full control of private repositories)
4. Copy the generated token
5. Use it in `typeSettings.authToken`

**Security**: Tokens are encrypted at rest using AES-256-GCM.

## Sync Strategies

Git sources support three sync methods that can be used together:

### 1. Manual Sync (Button/API)

Trigger sync on-demand via web UI or API call.

**When to use:**

- Testing after code changes
- Deploying specific updates
- One-time sync needs

**Via Web UI:**

1. Go to code management page
2. Find your git source
3. Click "Sync Now" button

**Via API:**

```bash
curl -X POST http://localhost:8000/api/sources/1/sync \
  -H "X-API-Key: your-management-api-key"
```

**Response:**

```json
{
  "message": "Sync triggered",
  "jobId": 42
}
```

### 2. Interval Sync (Scheduled)

Automatically sync on a regular schedule.

**When to use:**

- Regular polling for updates
- Development environments
- Non-critical deployments

**Configuration:**

```bash
curl -X PUT http://localhost:8000/api/sources/1 \
  -H "X-API-Key: your-management-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "syncSettings": {
      "intervalSeconds": 300
    }
  }'
```

**Common intervals:**

- `60` - Every minute (frequent updates)
- `300` - Every 5 minutes (balanced)
- `1800` - Every 30 minutes (low frequency)
- `0` - Disabled (no automatic sync)

**Note**: Setting `intervalSeconds` to 0 or omitting it disables automatic syncing.

### 3. Webhook Sync (Push-triggered)

Sync immediately when code is pushed to repository.

**When to use:**

- Production deployments
- Immediate updates needed
- CI/CD integration

**Setup:**

1. **Enable webhooks** (via Web UI checkbox or API):

```bash
curl -X PUT http://localhost:8000/api/sources/1 \
  -H "X-API-Key: your-management-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "syncSettings": {
      "webhookEnabled": true,
      "webhookSecret": "your-secure-random-string"
    }
  }'
```

**Note:** The `webhookSecret` is optional. If not set, the webhook endpoint accepts any request when enabled. For production use, always configure a secret.

2. **Configure webhook in Git provider**:

**GitHub Example:**

- Go to repository Settings → Webhooks → Add webhook
- **Payload URL**: `https://your-server.com/api/sources/1/webhook?secret=your-secure-random-string`
- **Content type**: `application/json`
- **Events**: Just the push event
- **Active**: ✓

**GitLab Example:**

- Go to repository Settings → Webhooks
- **URL**: `https://your-server.com/api/sources/1/webhook`
- **Secret token**: `your-secure-random-string`
- **Trigger**: Push events
- **Enable**: ✓

**Alternative**: Pass secret in header `X-Webhook-Secret` instead of query param.

**Security**: Webhook secrets use constant-time comparison to prevent timing attacks. Webhooks are disabled by default and must be explicitly enabled.

## Managing Files

### In Manual Sources

Files in manual sources can be created, edited, and deleted via web UI or API.

**Upload a file (Web UI):**

1. Navigate to code management page
2. Click on source name to view files
3. Click "Upload New File"
4. Select file or paste content
5. Click "Save"

**Upload a file (API):**

```bash
# JSON format (text files)
curl -X PUT http://localhost:8000/api/sources/my-api/files/hello.ts \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "export default async function(c, ctx) { return c.json({hello: \"world\"}); }",
    "encoding": "utf-8"
  }'

# Multipart form-data
curl -X PUT http://localhost:8000/api/sources/my-api/files/hello.ts \
  -H "X-API-Key: your-key" \
  -F "file=@local-hello.ts"

# Raw binary
curl -X PUT http://localhost:8000/api/sources/my-api/files/data.bin \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @local-data.bin
```

**List files:**

```bash
curl http://localhost:8000/api/sources/my-api/files \
  -H "X-API-Key: your-key"
```

**Delete a file:**

```bash
curl -X DELETE http://localhost:8000/api/sources/my-api/files/old-handler.ts \
  -H "X-API-Key: your-key"
```

### In Git Sources

Files in git sources are **read-only** via the API/UI. To modify them:

1. Make changes in your Git repository
2. Commit and push
3. Trigger sync (manual, interval, or webhook)
4. Files update automatically

**You can read but not write:**

```bash
# ✅ Read file content
curl http://localhost:8000/api/sources/production-api/files/handler.ts \
  -H "X-API-Key: your-key"

# ❌ Edit file (will fail with 403 Forbidden)
curl -X PUT http://localhost:8000/api/sources/production-api/files/handler.ts \
  -H "X-API-Key: your-key" \
  -d '{"content": "..."}'
```

## Monitoring Sync Status

### Last Sync Information

Each git source tracks sync history:

- **lastSyncAt** - Last successful sync timestamp
- **lastSyncStartedAt** - Current sync start time (null if not syncing)
- **lastSyncError** - Error message from last failed sync

**Check sync status (API):**

```bash
curl http://localhost:8000/api/sources/1/status \
  -H "X-API-Key: your-key"
```

**Response:**

```json
{
  "isSyncable": true,
  "isEditable": false,
  "lastSyncAt": "2026-01-21T10:30:00.000Z",
  "lastSyncStartedAt": null,
  "lastSyncError": null,
  "isSyncing": false
}
```

### Web UI Status

The code management page shows status indicators:

- 🟢 **Last sync: [timestamp]** - Successful sync
- 🔵 **Syncing...** - Sync in progress
- 🟡 **Never synced** - New source, not synced yet
- 🔴 **Error: [message]** - Last sync failed

## Source Naming Rules

Source names must follow these constraints:

- **Pattern**: Alphanumeric (a-z, A-Z, 0-9), hyphens (-), underscores (_)
- **Length**: 1-64 characters
- **Start**: Must begin with alphanumeric (not hyphen or underscore)
- **Case**: Case-sensitive (MyAPI ≠ myapi)
- **Unique**: No duplicate names allowed

**Valid examples:**

```
my-api
UserFunctions
backend_v2
prod-api-2026
```

**Invalid examples:**

```
_internal       # Cannot start with underscore
my.api          # Period not allowed
api functions   # Space not allowed
-webhooks       # Cannot start with hyphen
```

## Using Sources in Function Routes

When registering a function, the handler path must include the source name:

```
format: sourceName/path/to/file.ts
```

**Examples:**

| Handler Path | Description |
|--------------|-------------|
| `my-api/users.ts` | File `users.ts` in `my-api` source |
| `webhooks/github.ts` | File `github.ts` in `webhooks` source |
| `prod/lib/utils.ts` | File in subdirectory (not directly callable) |

**Function configuration:**

```json
{
  "name": "list-users",
  "handler": "my-api/users.ts",
  "route": "/users",
  "methods": ["GET"]
}
```

## Best Practices

### Development Workflow

1. **Start with manual sources** for prototyping
2. **Test thoroughly** before moving to git
3. **Use git sources** for production deployments
4. **Enable webhooks** for instant updates

### Organizing Code

**Separate by environment:**

```
code/
├── development/    # Manual source for dev/test
├── staging/        # Git source (staging branch)
└── production/     # Git source (main branch)
```

**Separate by purpose:**

```
code/
├── public-api/     # External-facing endpoints
├── internal/       # Internal tools
└── webhooks/       # Third-party integrations
```

### Security

- **Use webhook secrets** for git sources (prevent unauthorized sync triggers)
- **Use auth tokens** for private repositories
- **Rotate tokens regularly** (both git auth and webhook secrets)
- **Limit API key access** to management endpoints
- **Monitor sync errors** for authentication failures

### Performance

- **Avoid very short intervals** (< 60 seconds) - causes unnecessary load
- **Use webhooks** instead of polling when possible
- **Keep sources small** - separate large codebases into multiple sources
- **Monitor sync duration** - large repos may need longer intervals

## Troubleshooting

### Sync Failures

**Error: "Authentication failed"**

- Check auth token is valid and has correct permissions
- For GitHub: Token needs `repo` scope
- Token may have expired - generate new one

**Error: "Repository not found"**

- Verify URL is correct (should be HTTPS format)
- Check repository exists and is accessible
- For private repos, ensure auth token is provided

**Error: "Branch not found"**

- Verify branch/tag/commit exists in repository
- Check spelling (case-sensitive)
- Try using full commit SHA instead

### File Not Found in Functions

If a function handler can't be found:

1. Check handler path format: `sourceName/fileName.ts`
2. Verify file exists in source (check web UI or API)
3. For git sources: Check sync status (may not have synced yet)
4. Check function is enabled in function management

### Git Source Not Updating

1. **Check sync status**: Is sync enabled? (`enabled: true`)
2. **Check interval**: Is `intervalSeconds > 0` or webhook configured?
3. **Check last sync error**: May reveal authentication or connectivity issues
4. **Trigger manual sync**: Test if sync works at all
5. **Check webhook**: Is webhook secret correct? Is webhook active in git provider?

## API Reference

### Source Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sources` | List all sources |
| GET | `/api/sources/:id` | Get source details |
| POST | `/api/sources` | Create new source |
| PUT | `/api/sources/:id` | Update source configuration |
| DELETE | `/api/sources/:id` | Delete source and files |
| POST | `/api/sources/:id/sync` | Trigger manual sync |
| GET | `/api/sources/:id/status` | Get sync status |
| POST | `/api/sources/:id/webhook` | Webhook trigger endpoint |

### File Operations Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sources/:sourceName/files` | List files in source |
| GET | `/api/sources/:sourceName/files/:path` | Get file content |
| PUT | `/api/sources/:sourceName/files/:path` | Create/update file (manual only) |
| DELETE | `/api/sources/:sourceName/files/:path` | Delete file (manual only) |

**Note**: All file operations require the source to exist. Write operations require source to be editable (manual sources only).

## Next Steps

Now that you understand code sources, explore:

- [Your First Function](/guides/your-first-function) - Create and deploy a function using a code source
- [API Keys](/guides/api-keys) - Protect your management and execution endpoints
- [Secrets](/guides/secrets) - Store sensitive configuration securely
- [API Endpoints](/reference/api) - Complete REST API reference
