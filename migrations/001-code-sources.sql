-- Code Sources Migration
-- Adds the codeSources table for managing code source directories and sync configuration.

--------------------------------------------------------------------------------
-- Code Sources
--------------------------------------------------------------------------------

-- Code sources table - manages code source directories and sync configuration.
-- Each source corresponds to a top-level directory under code/.
-- Directory structure: code/{source.name}/... (no nesting of sources)
CREATE TABLE IF NOT EXISTS codeSources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Directory name under code/. Must be unique.
  -- Format: lowercase alphanumeric with hyphens/underscores, 1-64 chars.
  -- Examples: "utils", "my-project", "backend_v2"
  name TEXT NOT NULL UNIQUE,

  -- Source type determines which provider handles operations.
  -- CHECK constraint updated when adding new source types.
  type TEXT NOT NULL CHECK(type IN ('manual', 'git')),

  -- Type-specific config as encrypted JSON. Structure depends on type:
  --   manual: {} (empty, reserved for future use)
  --   git: {"url": "https://...", "branch": "main", "authToken": "..."}
  --   future s3: {"bucket": "...", "region": "...", "accessKey": "..."}
  typeSettings TEXT,

  -- Sync config as encrypted JSON. Common across all syncable types:
  --   {"intervalSeconds": 300, "webhookSecret": "abc123"}
  -- intervalSeconds: 0 or null = disabled. Ignored for manual sources.
  -- webhookSecret: per-source secret for webhook triggers.
  syncSettings TEXT,

  -- Sync status tracking
  -- lastSyncStartedAt: when current/last sync began (for "in progress" UI)
  -- lastSyncAt: last SUCCESSFUL sync completion (null if never synced)
  -- lastSyncError: error from last failed sync (cleared on success)
  lastSyncStartedAt TEXT,
  lastSyncAt TEXT,
  lastSyncError TEXT,

  -- Soft-disable: interval/webhook syncs won't trigger, manual sync still works
  enabled INTEGER NOT NULL DEFAULT 1,

  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for finding enabled sources (schedule management, listings)
CREATE INDEX IF NOT EXISTS idx_codeSources_enabled
  ON codeSources(enabled)
  WHERE enabled = 1;

-- Index for type-based queries
CREATE INDEX IF NOT EXISTS idx_codeSources_type ON codeSources(type);
