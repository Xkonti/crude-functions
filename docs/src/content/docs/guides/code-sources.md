---
title: Code Sources
description: Managing code sources, Git integration, and sync strategies
---

Code sources are the foundation of how Crude Functions organizes code files. Each source represents a directory containing TypeScript/JavaScript files that can be used within deployed function endpoints.

## What are Code Sources?

A code source represents a collection of related files stored in a subdirectory within `code` directory of the Docker container. Each source has:

- **ID** - Auto-generated unique identifier used in API endpoints
- **Name** - Human-readable unique name (used as the directory name)
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

- **HTTPS Git URL** (e.g., `https://github.com/user/repo.git`)
- For private repos: Personal access token
- One of: branch name, tag name, or commit SHA

:::note[HTTPS URLs Only]
Only HTTPS URLs are supported. SSH URLs (`git@github.com:user/repo.git`) and the `git://` protocol are not supported.

This is because Crude Functions uses [isomorphic-git](https://isomorphic-git.org/), a pure JavaScript Git implementation that only supports HTTP/HTTPS protocols.

**For private repositories**, use a personal access token in the "Authentication Token" field instead of SSH keys.
:::

1. Navigate to `http://localhost:9000/web/code`
2. Click "Create New Source"
3. Choose the git source
3. Fill in the form:
   - **Name**: `production-api`
   - **Git URL**: `https://github.com/yourorg/functions.git` (HTTPS only, no SSH)
   - **Reference Type**: Branch / Tag / Commit
   - **Reference Value**: `main` (branch)
   - **Auth Token**: Personal access token (required for private repos)
   - **Sync Settings**: (optional, interval of 300s is a decent default)
4. Click "Create Source"

The source is created and an initial sync is triggered automatically.

### Setting Up GitHub Personal Access Token

For private repositories, you'll need a personal access token (PAT). Since SSH URLs are not supported, this is the only way to authenticate with private repositories.

**Creating a token:**

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Click "Generate new token (classic)" or use Fine-grained tokens
3. For classic tokens, select scope: `repo` (read access is sufficient)
4. For fine-grained tokens, grant "Contents" read access to the specific repository
5. Copy the generated token and paste it in the "Authentication Token" field

**Other Git providers:**

- **GitLab**: Use a Project Access Token or Personal Access Token with `read_repository` scope
- **Bitbucket**: Use an App Password with repository read permissions
- **Azure DevOps**: Use a Personal Access Token with Code (Read) scope

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
# Replace 'SOURCE_ID' with your source's ID (from creation response or source listing)
curl -X POST http://localhost:9000/api/sources/SOURCE_ID/sync \
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
- **Payload URL**: `https://your-server.com/api/sources/SOURCE_ID/webhook?secret=your-secure-random-string`
  - Replace `SOURCE_ID` with your source's ID (found in web UI or from creation response)
- **Content type**: `application/json`
- **Events**: Just the push event
- **Active**: ✓

**GitLab Example:**

- Go to repository Settings → Webhooks
- **URL**: `https://your-server.com/api/sources/SOURCE_ID/webhook`
  - Replace `SOURCE_ID` with your source's ID
- **Secret token**: `your-secure-random-string`
- **Trigger**: Push events
- **Enable**: ✓
