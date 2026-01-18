# Code Sources Overhaul - Research & Design Plan

## Overview

This plan outlines the research and design work needed before implementing the "Code Sources" feature - a major overhaul of how code files are managed in Crude Functions.

---

## Requirements (Confirmed)

### Code Source Types (Initial Scope)

1. **manual** - User-editable via web UI/API (current behavior, scoped to directory)
2. **git** - Sync from remote git repo with configurable branch/tag/commit

### Architecture Rules

- Sources are **top-level directories only** under `code/` (no nesting)
- **No loose files** in `code/` root - only source directories
- Database schema changes go directly into `000-init.sql` (no migrations needed)

### Git Source Details

- Support **branch, tag, or commit hash** selection
- **HTTPS tokens only** for auth (no SSH key management)
- **Full repo sync** (no sparse checkout)
- On sync failure: **keep old files**, log error, continue normally

### Sync Mechanisms

1. **Manual sync** - Always available via API/button
2. **Interval sync** - Simple interval in seconds (e.g., 300 = every 5 minutes)
3. **Webhook sync** - Per-source configurable secret token (or none)

### Job Queue System

- Generic job queue stored in database
- **Queue** sync jobs when one is already running
- Track **process instance ID** (UUID at startup) to detect orphaned jobs
- **Orphaned jobs** (from crashed container) retry once
- **Failed jobs stay failed** (no auto-retry)
- Interval/webhook syncs continue normally regardless of past errors

### Web UI

- **Full browsing** of all source directories (read-only)
- **Only manual sources** are editable via API/web UI

### Database Storage

- JSON columns for type-specific and sync settings
- **Encrypted** storage for credentials (using existing VersionedEncryptionService)

---

## Research Items

### 1. Git Integration Library

- [ ] Evaluate `isomorphic-git` (npm:isomorphic-git) for Deno compatibility
- [ ] Test clone/pull/checkout operations
- [ ] Verify HTTPS auth token handling
- [ ] Check memory usage for large repos

### 2. Existing Patterns to Follow

- [ ] Background service pattern (LogTrimmingService, MetricsAggregationService)
- [ ] Encryption patterns (VersionedEncryptionService, SecretsService)
- [ ] Service ownership pattern (DatabaseService access)
- [ ] TestSetupBuilder for testing

### 3. Handler Loading Impact

- [ ] Verify HandlerLoader works with source-prefixed paths
- [ ] Test cache invalidation when git sync changes files
- [ ] Confirm route rebuild triggers on file changes

---

## Design Components

### 1. Database Schema

**code_sources table:**

```sql
CREATE TABLE IF NOT EXISTS codeSources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- Directory name under code/
  type TEXT NOT NULL CHECK(type IN ('manual', 'git')),
  typeSettings TEXT,                   -- JSON, encrypted: git URL, branch, token
  syncSettings TEXT,                   -- JSON, encrypted: interval, webhook secret
  lastSyncAt TEXT,                     -- Last successful sync timestamp
  lastSyncError TEXT,                  -- Last sync error (if any)
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**job_queue table:**

```sql
CREATE TABLE IF NOT EXISTS jobQueue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                  -- 'source_sync', etc.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  payload TEXT,                        -- JSON: job parameters
  result TEXT,                         -- JSON: result or error
  processInstanceId TEXT,              -- UUID of handling process
  retryCount INTEGER NOT NULL DEFAULT 0,
  maxRetries INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  sourceId INTEGER REFERENCES codeSources(id) ON DELETE CASCADE,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  startedAt TEXT,
  completedAt TEXT
);
```

**Type Settings (encrypted JSON):**

```typescript
// Git source
interface GitTypeSettings {
  url: string;           // HTTPS git URL
  branch?: string;       // Default: main
  tag?: string;          // Mutually exclusive with branch
  commit?: string;       // Specific SHA
  authToken?: string;    // HTTPS token
}

// Manual source
interface ManualTypeSettings {}  // Empty, reserved

// Sync settings (all types)
interface SyncSettings {
  intervalSeconds?: number;   // 0 = disabled
  webhookSecret?: string;     // Per-source secret
}
```

### 2. Service Architecture

| Service | Location | Responsibility |
|---------|----------|----------------|
| **CodeSourceService** | `src/sources/code_source_service.ts` | CRUD for sources, directory management, encryption |
| **JobQueueService** | `src/jobs/job_queue_service.ts` | Generic queue, orphan detection, process tracking |
| **SyncService** | `src/sources/sync_service.ts` | Orchestrates syncs, delegates to providers |
| **GitSyncProvider** | `src/sources/git_sync_provider.ts` | Clone/pull/checkout using isomorphic-git |
| **ManualSourceProvider** | `src/sources/manual_source_provider.ts` | Scoped file operations for manual sources |
| **SyncSchedulerService** | `src/sources/sync_scheduler_service.ts` | Background interval checking, job processing |

### 3. API Endpoints

**Source Management:**

- `GET /api/sources` - List all sources
- `GET /api/sources/:id` - Get source details
- `POST /api/sources` - Create source
- `PUT /api/sources/:id` - Update source
- `DELETE /api/sources/:id` - Delete source
- `POST /api/sources/:id/sync` - Trigger manual sync
- `GET /api/sources/:id/status` - Get sync status

**Webhook:**

- `POST /api/sources/:id/webhook` - Receive webhook (validates secret)

**Files (source-scoped):**

- `GET /api/sources/:sourceId/files` - List files
- `GET /api/sources/:sourceId/files/:path` - Get file
- `PUT /api/sources/:sourceId/files/:path` - Write (manual only)
- `DELETE /api/sources/:sourceId/files/:path` - Delete (manual only)

### 4. Web UI Pages

| Route | Purpose |
|-------|---------|
| `/web/sources` | List sources with status, sync buttons |
| `/web/sources/create` | Create new source form |
| `/web/sources/:id` | Edit source, view sync history |
| `/web/code` | Source selector + file browser |
| `/web/code/:sourceName` | Files in specific source |

### 5. Key Implementation Patterns

**Orphan Detection:**

```typescript
// On startup and periodically:
// - Find jobs with status='running' and processInstanceId != current
// - If retryCount < maxRetries: reset to 'pending', increment retry
// - Otherwise: mark as 'failed'
```

**Sync Queuing:**

```typescript
// When sync triggered:
// - If no active job for source: create and process immediately
// - If job running: queue new job (will run after)
```

**Path Scoping:**

```typescript
// All file operations prefixed with source name:
// "handler.ts" → "manual/handler.ts"
// Handler paths in routes include source: "my-repo/lib/handler.ts"
```

---

## Implementation Phases

### Phase 1: Database & Core Services

1. Add tables to `000-init.sql`
2. Implement `CodeSourceService`
3. Implement `JobQueueService`
4. Add TestSetupBuilder extensions

### Phase 2: Sync Infrastructure

1. Implement `GitSyncProvider` (with isomorphic-git)
2. Implement `ManualSourceProvider`
3. Implement `SyncService`
4. Implement `SyncSchedulerService`

### Phase 3: API & Integration

1. Create `source_routes.ts`
2. Create `webhook_routes.ts`
3. Update `file_routes.ts` for source-scoping
4. Integrate into `main.ts`

### Phase 4: Web UI

1. Create `sources_pages.ts`
2. Update `code_pages.ts` for source browsing
3. Update navigation/dashboard

### Phase 5: Testing & Polish

1. Write comprehensive tests
2. Bootstrap default "manual" source on fresh install
3. Update documentation

---

## Critical Files to Modify/Create

**Modify:**

- `migrations/000-init.sql` - Add code_sources and jobQueue tables
- `main.ts` - Initialize new services, generate process ID
- `src/files/file_service.ts` - Enforce source-scoped paths
- `src/web/code_pages.ts` - Source-aware file browsing

**Create:**

- `src/sources/code_source_service.ts`
- `src/sources/sync_service.ts`
- `src/sources/git_sync_provider.ts`
- `src/sources/manual_source_provider.ts`
- `src/sources/sync_scheduler_service.ts`
- `src/sources/source_routes.ts`
- `src/sources/webhook_routes.ts`
- `src/jobs/job_queue_service.ts`
- `src/web/sources_pages.ts`

---

## Verification Plan

1. **Unit Tests** - Each service with TestSetupBuilder
2. **Integration Tests** - Full sync flow from API to files
3. **Manual Testing:**
   - Create manual source, upload/edit files
   - Create git source pointing to public repo, trigger sync
   - Verify interval sync fires on schedule
   - Test webhook trigger (use curl)
   - Verify orphan detection after simulated crash
   - Confirm handler loading works with source-prefixed paths

---

## Deliverable

After research and design validation, write comprehensive implementation plan to:
**`.ai/code-sources-implementation-plan.md`**

Plan will include:

- Complete database schema
- Service interfaces and method signatures
- API specifications
- Step-by-step implementation instructions
- Test scenarios
