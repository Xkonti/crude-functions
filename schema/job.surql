-- Job queue table - generic queue for background processing with orphan detection.
-- Used by code source sync, cleanup tasks, and other async operations.
-- Features:
--   - Priority-based processing (higher priority processed first)
--   - Orphan detection via processInstanceId (detects jobs from crashed containers)
--   - Unique constraint on active sequential jobs per reference (prevents duplicate work)
--   - Flexible payload/result for job data (may be encrypted by service)
DEFINE TABLE IF NOT EXISTS job SCHEMAFULL TYPE NORMAL;

-- Job type identifier. Used to dispatch to correct handler.
-- Examples: 'source_sync', 'log_cleanup', 'metrics_aggregate'
DEFINE FIELD IF NOT EXISTS type ON TABLE job TYPE string;

-- Job lifecycle state. Transitions: pending -> running -> completed/failed/cancelled
-- Running jobs can be reset to pending on orphan recovery (increments retryCount)
DEFINE FIELD IF NOT EXISTS status ON TABLE job TYPE "pending" | "running" | "completed" | "failed" | "cancelled"
    DEFAULT "pending";

-- Execution mode:
-- - sequential (default): Enforces unique constraint on active jobs per reference
-- - concurrent: Allows multiple active jobs for the same reference
DEFINE FIELD IF NOT EXISTS executionMode ON TABLE job TYPE "sequential" | "concurrent"
    DEFAULT "sequential";

-- Job parameters as JSON string. Structure depends on job type.
-- May be encrypted if sensitive data (e.g., credentials).
-- Stored as string because encryption produces string output.
DEFINE FIELD IF NOT EXISTS payload ON TABLE job TYPE option<string>;

-- Outcome as JSON string. On success: result data. On failure: error details.
DEFINE FIELD IF NOT EXISTS result ON TABLE job TYPE option<string>;

-- UUID of process instance handling this job. Set when status -> running.
-- Used for orphan detection: if process crashes, jobs have mismatched ID.
DEFINE FIELD IF NOT EXISTS processInstanceId ON TABLE job TYPE option<string>;

-- How many times this job has been retried after orphaning.
DEFINE FIELD IF NOT EXISTS retryCount ON TABLE job TYPE int DEFAULT 0;

-- Maximum retry attempts. After retryCount >= maxRetries, job stays failed.
-- Default 1 means: try once, if orphaned retry once, then give up.
DEFINE FIELD IF NOT EXISTS maxRetries ON TABLE job TYPE int DEFAULT 1;

-- Higher priority jobs processed first. Default 0. Manual syncs could use
-- higher priority to jump ahead of scheduled syncs.
DEFINE FIELD IF NOT EXISTS priority ON TABLE job TYPE int DEFAULT 0;

-- Generic entity reference for constraint enforcement and querying.
-- For source_sync jobs: referenceType='codeSource', referenceId=source record ID string
-- Kept as separate fields for flexibility (can reference any entity type)
DEFINE FIELD IF NOT EXISTS referenceType ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS referenceId ON TABLE job TYPE option<string>;

-- Timestamps
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE job TYPE datetime DEFAULT time::now();

-- When job was picked up (status -> running). NONE until started.
DEFINE FIELD IF NOT EXISTS startedAt ON TABLE job TYPE option<datetime>;

-- When job finished (status -> completed/failed/cancelled). NONE until done.
DEFINE FIELD IF NOT EXISTS completedAt ON TABLE job TYPE option<datetime>;

-- When job was requested for cancellation. Set before completedAt.
-- If set while running, handler should detect and stop gracefully.
DEFINE FIELD IF NOT EXISTS cancelledAt ON TABLE job TYPE option<datetime>;

-- Human-readable reason for cancellation.
DEFINE FIELD IF NOT EXISTS cancelReason ON TABLE job TYPE option<string>;

-- Indexes for job queue operations

-- Finding pending jobs to process (priority ordering)
DEFINE INDEX IF NOT EXISTS idx_job_status ON job FIELDS status;

-- Finding jobs by type and status (e.g., all pending source_sync jobs)
DEFINE INDEX IF NOT EXISTS idx_job_type_status ON job FIELDS type, status;

-- Priority ordering when selecting next pending job
-- Note: SurrealDB will use this for queries ordering by priority DESC, createdAt ASC
DEFINE INDEX IF NOT EXISTS idx_job_priority ON job FIELDS status, priority, createdAt;

-- Finding jobs by reference (for duplicate detection and querying)
DEFINE INDEX IF NOT EXISTS idx_job_reference ON job FIELDS referenceType, referenceId, status;

-- Cleanup queries (finding old completed/failed/cancelled jobs by completion time)
DEFINE INDEX IF NOT EXISTS idx_job_completed ON job FIELDS status, completedAt;

-- When a job is deleted, clear activeJobId reference in any schedule pointing to it
DEFINE EVENT IF NOT EXISTS clear_schedule_activeJob ON TABLE job WHEN $event = "DELETE" THEN {
    UPDATE schedule SET activeJobId = NONE WHERE activeJobId = $before.id
};
