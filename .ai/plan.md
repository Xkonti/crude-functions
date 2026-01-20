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

### Sync Job Behavior

Sync operations use the existing job queue and scheduling infrastructure:

- **One sync at a time per source** - enforced via job queue's sequential mode
- **Orphaned jobs** (from crashed container) retry once automatically
- **Failed jobs stay failed** - interval/webhook syncs continue normally regardless of past errors

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

- [ ] Job queue pattern (JobQueueService, JobProcessorService)
- [ ] Scheduling pattern (SchedulingService for interval-based triggering)
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

**codeSources table:**

```sql
CREATE TABLE IF NOT EXISTS codeSources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Directory name under code/. Must be unique because each source maps to
  -- exactly one directory, and directory names must be unique on filesystem.
  name TEXT NOT NULL UNIQUE,

  -- Source type determines which provider handles sync operations.
  -- CHECK constraint prevents invalid types at DB level. When adding new
  -- source types (s3, ftp), this constraint must be updated.
  type TEXT NOT NULL CHECK(type IN ('manual', 'git')),

  -- Type-specific configuration as encrypted JSON. Encrypted because it may
  -- contain auth tokens (git), access keys (s3), etc. Examples:
  --   git: {"url": "https://...", "branch": "main", "authToken": "..."}
  --   manual: {} (empty, reserved for future use)
  -- Storing as JSON avoids schema changes when adding new source types.
  typeSettings TEXT,

  -- Sync configuration as encrypted JSON. Encrypted because webhookSecret
  -- is sensitive. Format: {"intervalSeconds": 300, "webhookSecret": "..."}
  -- For manual sources: intervalSeconds is ignored (nothing to sync FROM),
  -- but webhookSecret could be used if external system notifies of changes.
  syncSettings TEXT,

  -- When the current/last sync attempt started. Separate from lastSyncAt
  -- because we need to show "sync in progress since X" in UI, and detect
  -- hung syncs (started long ago, never completed).
  lastSyncStartedAt TEXT,

  -- Last SUCCESSFUL sync completion. NULL for manual sources (they don't
  -- sync from anywhere) or sources that have never synced successfully.
  lastSyncAt TEXT,

  -- Error message from last failed sync attempt. Cleared on successful sync.
  lastSyncError TEXT,

  -- Soft-disable without deleting. Disabled sources won't run interval/webhook
  -- syncs, but manual sync still allowed for debugging.
  enabled INTEGER NOT NULL DEFAULT 1,

  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**jobQueue table:**

The generic job queue infrastructure already exists in `migrations/000-init.sql`. Use `JobQueueService` from `src/jobs/job_queue_service.ts` for all job management operations.

Key features for source sync:
- Enforce "one active job per entity" via `referenceType='code_source'` and `referenceId=source.id`
- Priority support (manual syncs can use higher priority)
- Orphan detection via process instance ID (handled by `JobProcessorService`)
- Encrypted payload support (pass `encryptionService` to `JobQueueService`)

For source sync jobs, use:
```typescript
await jobQueueService.enqueue({
  type: 'source_sync',
  payload: { sourceId: 123 },
  referenceType: 'code_source',
  referenceId: 123,
  priority: 0, // or higher for manual sync
});
```

**Manual Source Behavior Notes:**

For implementers - manual sources have special semantics:

1. **No interval sync**: `intervalSeconds` in syncSettings is ignored. There's nothing to sync FROM - local filesystem IS the source of truth.
2. **`lastSyncAt` is NULL**: Manual sources never "sync" so this stays NULL. (Or could indicate last filesystem validation scan if that feature is added.)
3. **Webhook may be used**: Even manual sources might want webhook notification - e.g., CI/CD could notify when deploying new files.
4. **Application must validate**: On create/update, validate that manual sources don't have intervalSeconds set (or warn user it's ignored).

**Job Cleanup Strategy:**

Consider adding a background task to delete old completed/failed jobs (similar to `LogTrimmingService` pattern). Use `JobQueueService.deleteCompleted()` and `JobQueueService.deleteFailed()` methods. Suggested retention: 7 days for completed, 30 days for failed (for debugging).

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

**Existing Services (use these):**

| Service | Location | Responsibility |
|---------|----------|----------------|
| **JobQueueService** | `src/jobs/job_queue_service.ts` | Generic queue, orphan detection, process tracking |
| **JobProcessorService** | `src/jobs/job_processor_service.ts` | Background job processing with handler registration |
| **SchedulingService** | `src/scheduling/scheduling_service.ts` | Time-based job scheduling (interval triggers) |
| **InstanceIdService** | `src/instance/instance_id_service.ts` | Unique process instance ID for orphan detection |

**New Services (to create):**

| Service | Location | Responsibility |
|---------|----------|----------------|
| **CodeSourceService** | `src/sources/code_source_service.ts` | CRUD for sources, directory management, encryption |
| **SyncService** | `src/sources/sync_service.ts` | Orchestrates syncs, delegates to providers |
| **GitSyncProvider** | `src/sources/git_sync_provider.ts` | Clone/pull/checkout using isomorphic-git |
| **ManualSourceProvider** | `src/sources/manual_source_provider.ts` | Scoped file operations for manual sources |

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

**Job Processing:**

Use `JobProcessorService` for background job processing. Register a handler for `'source_sync'` jobs:

```typescript
jobProcessorService.registerHandler('source_sync', async (job) => {
  const { sourceId } = job.payload;
  await syncService.syncSource(sourceId);
  return { synced: true };
});

jobProcessorService.start(); // Starts polling and handles orphans automatically
```

Orphan detection is automatic on service start and during polling.

**Sync Queuing:**

```typescript
// JobQueueService enforces unique constraint via referenceType + referenceId
// If active job exists, enqueue() throws DuplicateActiveJobError
try {
  await jobQueueService.enqueue({
    type: 'source_sync',
    payload: { sourceId },
    referenceType: 'code_source',
    referenceId: sourceId,
  });
} catch (error) {
  if (error instanceof DuplicateActiveJobError) {
    // Already queued or running - safe to ignore
  }
}
```

**Interval Scheduling:**

Use `SchedulingService` for interval-based sync triggers. When a source is created/updated with `intervalSeconds > 0`, create a schedule:

```typescript
// Create interval schedule for a source
await schedulingService.createSchedule({
  name: `source_sync_${sourceId}`,
  type: 'sequential_interval',  // Waits for job completion before scheduling next
  intervalMs: source.syncSettings.intervalSeconds * 1000,
  jobType: 'source_sync',
  jobPayload: { sourceId },
  jobReferenceType: 'code_source',
  jobReferenceId: sourceId,
  isPersistent: true,
});

// When source is updated, update or recreate the schedule
// When source is deleted, delete the schedule
await schedulingService.deleteSchedule(scheduleId);
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

1. Add `codeSources` table to `000-init.sql`
2. Implement `CodeSourceService`
3. Update `TestSetupBuilder` to support source services

### Phase 2: Sync Infrastructure

1. Implement `GitSyncProvider` (with isomorphic-git)
2. Implement `ManualSourceProvider`
3. Implement `SyncService`
4. Register `source_sync` handler with `JobProcessorService`

### Phase 3: API & Integration

1. Create `source_routes.ts`
2. Create `webhook_routes.ts`
3. Update `file_routes.ts` for source-scoping
4. Update `main.ts` to initialize source services
5. Set up interval schedules via `SchedulingService` when sources are created/updated

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

- `migrations/000-init.sql` - Add `codeSources` table
- `main.ts` - Initialize source services, register `source_sync` job handler
- `src/files/file_service.ts` - Enforce source-scoped paths
- `src/web/code_pages.ts` - Source-aware file browsing
- `src/test/test_setup_builder.ts` - Add source service support

**Create:**

- `src/sources/code_source_service.ts`
- `src/sources/sync_service.ts`
- `src/sources/git_sync_provider.ts`
- `src/sources/manual_source_provider.ts`
- `src/sources/source_routes.ts`
- `src/sources/webhook_routes.ts`
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
