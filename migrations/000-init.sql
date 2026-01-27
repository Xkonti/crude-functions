-- Crude Functions - Initial Schema
-- Consolidated from migrations 000-007

-- Schema version tracking table
CREATE TABLE IF NOT EXISTS schemaVersion (
  version INTEGER NOT NULL
);

--------------------------------------------------------------------------------
-- Execution Logs and Metrics
-- NOTE: Routes have been migrated to SurrealDB.
-- The routeId columns below will temporarily store string IDs (SurrealDB RecordIds)
-- where integers were before. This is a transitional state - logs and metrics
-- will be migrated to SurrealDB separately.
--------------------------------------------------------------------------------

-- Execution logs table - stores captured console output from function handlers
-- NOTE: routeId now stores SurrealDB RecordId strings (was INTEGER FK to routes)
CREATE TABLE IF NOT EXISTS executionLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestId TEXT NOT NULL,
  routeId TEXT,  -- SurrealDB RecordId string (e.g., "abc123xyz")
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  args TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executionLogs_requestId ON executionLogs(requestId);
CREATE INDEX IF NOT EXISTS idx_executionLogs_routeId ON executionLogs(routeId, id);
CREATE INDEX IF NOT EXISTS idx_executionLogs_route_level ON executionLogs(routeId, level, id);
CREATE INDEX IF NOT EXISTS idx_executionLogs_timestamp ON executionLogs(timestamp);

-- Execution metrics table - stores execution timing data for analytics
-- NOTE: routeId now stores SurrealDB RecordId strings (was INTEGER)
-- routeId is NULL for global metrics (combined across all functions)
CREATE TABLE IF NOT EXISTS executionMetrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routeId TEXT,  -- SurrealDB RecordId string, NULL for global metrics
  type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
  avgTimeMs REAL NOT NULL,
  maxTimeMs INTEGER NOT NULL,
  executionCount INTEGER NOT NULL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executionMetrics_routeId ON executionMetrics(routeId);
CREATE INDEX IF NOT EXISTS idx_executionMetrics_type_route_timestamp
  ON executionMetrics(type, COALESCE(routeId, -1), timestamp);
CREATE INDEX IF NOT EXISTS idx_executionMetrics_timestamp ON executionMetrics(timestamp);

-- Metrics aggregation state - tracks watermarks for aggregation progress
CREATE TABLE IF NOT EXISTS metricsState (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

--------------------------------------------------------------------------------
-- Job Queue
--------------------------------------------------------------------------------

-- Job queue table - generic queue for background processing with orphan detection
-- Used by code source sync, cleanup tasks, and other async operations.
-- Features:
--   - Priority-based processing (higher priority processed first)
--   - Orphan detection via processInstanceId (detects jobs from crashed containers)
--   - Unique constraint on active jobs per reference (prevents duplicate work)
--   - JSON payload/result for flexible job data
CREATE TABLE IF NOT EXISTS jobQueue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Job type identifier. Used to dispatch to correct handler.
  -- Examples: 'source_sync', 'log_cleanup', 'metrics_aggregate'
  type TEXT NOT NULL,
  -- Job lifecycle state. Transitions: pending -> running -> completed/failed/cancelled
  -- Running jobs can be reset to pending on orphan recovery (increments retryCount)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  -- Execution mode: sequential (default) or concurrent.
  -- Sequential: enforces unique constraint on active jobs per reference.
  -- Concurrent: allows multiple active jobs for same reference.
  executionMode TEXT NOT NULL DEFAULT 'sequential'
    CHECK(executionMode IN ('sequential', 'concurrent')),
  -- Job parameters as JSON. Structure depends on job type.
  -- May be encrypted if sensitive data (e.g., credentials).
  payload TEXT,
  -- Outcome as JSON. On success: result data. On failure: error details.
  result TEXT,
  -- UUID of process instance handling this job. Set when status -> running.
  -- Used for orphan detection: if process crashes, jobs have mismatched ID.
  processInstanceId TEXT,
  -- How many times this job has been retried after orphaning.
  retryCount INTEGER NOT NULL DEFAULT 0,
  -- Maximum retry attempts. After retryCount >= maxRetries, job stays failed.
  -- Default 1 means: try once, if orphaned retry once, then give up.
  maxRetries INTEGER NOT NULL DEFAULT 1,
  -- Higher priority jobs processed first. Default 0. Manual syncs could use
  -- higher priority to jump ahead of scheduled syncs.
  priority INTEGER NOT NULL DEFAULT 0,
  -- Generic entity reference for constraint enforcement and querying.
  -- For source_sync jobs: referenceType='code_source', referenceId=source.id
  referenceType TEXT,
  referenceId INTEGER,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  -- When job was picked up (status -> running). NULL until started.
  startedAt TEXT,
  -- When job finished (status -> completed/failed/cancelled). NULL until done.
  completedAt TEXT,
  -- When job was requested for cancellation. Set before completedAt.
  -- If set while running, handler should detect and stop gracefully.
  cancelledAt TEXT,
  -- Human-readable reason for cancellation.
  cancelReason TEXT
);

-- Index for finding pending jobs to process (ordered by priority, then creation time)
CREATE INDEX IF NOT EXISTS idx_jobQueue_status ON jobQueue(status);

-- Index for finding jobs by type and status
CREATE INDEX IF NOT EXISTS idx_jobQueue_type_status ON jobQueue(type, status);

-- Index for priority ordering when selecting next pending job
CREATE INDEX IF NOT EXISTS idx_jobQueue_priority
  ON jobQueue(status, priority DESC, createdAt ASC);

-- CRITICAL: Enforce "one active job per entity" at database level for sequential jobs.
-- Prevents race conditions where multiple sequential jobs queue for same entity.
-- Partial index: only constrains rows where executionMode is 'sequential' AND
-- status is pending/running AND referenceId is set.
-- Concurrent jobs bypass this constraint, allowing multiple active jobs per reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobQueue_reference_active
  ON jobQueue(referenceType, referenceId)
  WHERE status IN ('pending', 'running') AND referenceId IS NOT NULL AND executionMode = 'sequential';

-- Index for cleanup queries (finding old completed/failed/cancelled jobs)
CREATE INDEX IF NOT EXISTS idx_jobQueue_completed
  ON jobQueue(status, completedAt)
  WHERE status IN ('completed', 'failed', 'cancelled');

--------------------------------------------------------------------------------
-- Scheduling
--------------------------------------------------------------------------------

-- Schedules table - stores scheduled job definitions
-- Schedules create jobs in jobQueue when their trigger time arrives.
-- Features:
--   - Multiple schedule types: one_off, dynamic, sequential_interval, concurrent_interval
--   - Transient vs persistent schedules (transient cleared on startup)
--   - Efficient timeout-based triggering via nextRunAt index
--   - Reference tracking for completion callbacks (dynamic/sequential schedules)
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Unique schedule name (used as identifier for API operations)
  name TEXT NOT NULL UNIQUE,
  -- Human-readable description
  description TEXT,
  -- Schedule type determines execution behavior:
  --   one_off: Execute once at nextRunAt, then status -> completed
  --   dynamic: After job completes, handler returns next time via result
  --   sequential_interval: Wait for job completion, then schedule next after intervalMs
  --   concurrent_interval: Enqueue at every interval regardless of running jobs
  type TEXT NOT NULL CHECK(type IN ('one_off', 'dynamic', 'sequential_interval', 'concurrent_interval')),
  -- Current status:
  --   active: Schedule is enabled and will trigger
  --   paused: Schedule is disabled, will not trigger until resumed
  --   completed: One-off schedule that has executed (or cancelled)
  --   error: Schedule encountered too many failures
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'error')),
  -- Persistence flag: 0 = transient (cleared on startup), 1 = persistent
  isPersistent INTEGER NOT NULL DEFAULT 1,
  -- Next scheduled execution time (ISO8601). NULL if paused or completed.
  nextRunAt TEXT,
  -- Interval in milliseconds for interval-based schedules. NULL for one_off/dynamic.
  intervalMs INTEGER,
  -- Job type to enqueue when schedule triggers
  jobType TEXT NOT NULL,
  -- Job payload as JSON. Passed to job when enqueued.
  jobPayload TEXT,
  -- Job priority (passed to jobQueue.enqueue)
  jobPriority INTEGER NOT NULL DEFAULT 0,
  -- Job max retries (passed to jobQueue.enqueue)
  jobMaxRetries INTEGER NOT NULL DEFAULT 1,
  -- Job execution mode: sequential or concurrent
  jobExecutionMode TEXT NOT NULL DEFAULT 'sequential'
    CHECK(jobExecutionMode IN ('sequential', 'concurrent')),
  -- Reference type for job (for duplicate detection in sequential mode)
  jobReferenceType TEXT,
  -- Reference ID for job
  jobReferenceId INTEGER,
  -- Currently active job ID (for tracking completion in dynamic/sequential schedules)
  -- NULL when no job is running
  activeJobId INTEGER,
  -- Consecutive failure count (for error detection)
  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  -- Max consecutive failures before schedule enters error state
  maxConsecutiveFailures INTEGER NOT NULL DEFAULT 5,
  -- Error message if status is 'error'
  lastError TEXT,
  -- Timestamps
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Last time the schedule successfully triggered
  lastTriggeredAt TEXT,
  -- Last time a job completed for this schedule
  lastCompletedAt TEXT
);

-- Index for finding schedules that need to trigger (ordered by time)
-- Used by getNextScheduledTime() to efficiently find soonest schedule
CREATE INDEX IF NOT EXISTS idx_schedules_nextRunAt
  ON schedules(nextRunAt)
  WHERE status = 'active' AND nextRunAt IS NOT NULL;

-- Index for finding schedules waiting for job completion
CREATE INDEX IF NOT EXISTS idx_schedules_activeJobId
  ON schedules(activeJobId)
  WHERE activeJobId IS NOT NULL;

-- Index for cleanup of transient schedules
CREATE INDEX IF NOT EXISTS idx_schedules_transient
  ON schedules(isPersistent)
  WHERE isPersistent = 0;

