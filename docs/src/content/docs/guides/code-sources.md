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

1. Navigate to `http://localhost:9000/web/code`
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

1. Navigate to `http://localhost:9000/web/code`
2. Click "Create New Source"
3. Choose the git source
3. Fill in the form:
   - **Name**: `production-api`
   - **Git URL**: `https://github.com/yourorg/functions.git`
   - **Reference Type**: Branch / Tag / Commit
   - **Reference Value**: `main` (branch)
   - **Auth Token**: (optional, for private repos)
   - **Sync Settings**: (optional, interval of 300s is a decent default)
4. Click "Create Source"

The source is created and an initial sync is triggered automatically.

### Setting Up GitHub Personal Access Token

For private repositories, you'll need a token with read access:

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` - only read-only access is needed
4. Copy the generated token

## Sync Strategies

Git sources support three sync methods that can be used together:

### 1. Manual Sync (Button/API)

Trigger sync on-demand via web UI or API call.

**Via Web UI:**

1. Go to code management page
2. Find your git source
3. Click "Sync Now" button

**Via API:**

```bash
curl -X POST http://localhost:9000/api/sources/1/sync \
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

Automatically sync on a regular schedule described in seconds. If there are changes that were made to the repo on the selected branch or tag, they will be automatically pulled.

### 3. Webhook Sync (Push-triggered)

Sync whenever the webhook is triggered. This is commonly used within Git providers to trigger Crude Functions to pull recent changes immediately after they happen.

Webhooks accept an optional **secret** - when set, Crude Functions will look for the specified secret inside `X-Webhook-Secret` header or within a `secret` query param:

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
