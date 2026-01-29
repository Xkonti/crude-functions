-- Schedules table - stores scheduled job definitions.
-- Schedules create jobs in the job table when their trigger time arrives.
-- Features:
--   - Multiple schedule types: one_off, dynamic, sequential_interval, concurrent_interval
--   - Transient vs persistent schedules (transient cleared on startup)
--   - Efficient timeout-based triggering via nextRunAt index
--   - Reference tracking for completion callbacks (dynamic/sequential schedules)
DEFINE TABLE IF NOT EXISTS schedule SCHEMAFULL TYPE NORMAL;

-- Unique schedule name (used as identifier for API operations)
DEFINE FIELD IF NOT EXISTS name ON TABLE schedule TYPE string;

-- Human-readable description
DEFINE FIELD IF NOT EXISTS description ON TABLE schedule TYPE option<string>;

-- Schedule type determines execution behavior:
--   one_off: Execute once at nextRunAt, then status -> completed
--   dynamic: After job completes, handler returns next time via result
--   sequential_interval: Wait for job completion, then schedule next after intervalMs
--   concurrent_interval: Enqueue at every interval regardless of running jobs
DEFINE FIELD IF NOT EXISTS type ON TABLE schedule TYPE "one_off" | "dynamic" | "sequential_interval" | "concurrent_interval";

-- Current status:
--   active: Schedule is enabled and will trigger
--   paused: Schedule is disabled, will not trigger until resumed
--   completed: One-off schedule that has executed (or cancelled)
--   error: Schedule encountered too many failures
DEFINE FIELD IF NOT EXISTS status ON TABLE schedule TYPE "active" | "paused" | "completed" | "error"
    DEFAULT "active";

-- Persistence flag: false = transient (cleared on startup), true = persistent
DEFINE FIELD IF NOT EXISTS isPersistent ON TABLE schedule TYPE bool DEFAULT true;

-- Next scheduled execution time. NONE if paused or completed.
DEFINE FIELD IF NOT EXISTS nextRunAt ON TABLE schedule TYPE option<datetime>;

-- Interval in milliseconds for interval-based schedules. NONE for one_off/dynamic.
DEFINE FIELD IF NOT EXISTS intervalMs ON TABLE schedule TYPE option<int>;

-- Job configuration: type to enqueue when schedule triggers
DEFINE FIELD IF NOT EXISTS jobType ON TABLE schedule TYPE string;

-- Job payload as JSON string. Passed to job when enqueued.
-- May be encrypted if sensitive data.
DEFINE FIELD IF NOT EXISTS jobPayload ON TABLE schedule TYPE option<string>;

-- Job priority (passed to job.enqueue)
DEFINE FIELD IF NOT EXISTS jobPriority ON TABLE schedule TYPE int DEFAULT 0;

-- Job max retries (passed to job.enqueue)
DEFINE FIELD IF NOT EXISTS jobMaxRetries ON TABLE schedule TYPE int DEFAULT 1;

-- Job execution mode: sequential or concurrent
DEFINE FIELD IF NOT EXISTS jobExecutionMode ON TABLE schedule TYPE "sequential" | "concurrent"
    DEFAULT "sequential";

-- Reference type for job (for duplicate detection in sequential mode)
DEFINE FIELD IF NOT EXISTS jobReferenceType ON TABLE schedule TYPE option<string>;

-- Reference ID for job (string representation - numbers converted to strings)
DEFINE FIELD IF NOT EXISTS jobReferenceId ON TABLE schedule TYPE option<string>;

-- Currently active job ID (for tracking completion in dynamic/sequential schedules)
-- NONE when no job is running
DEFINE FIELD IF NOT EXISTS activeJobId ON TABLE schedule TYPE option<record<job>>;

-- Consecutive failure count (for error detection)
DEFINE FIELD IF NOT EXISTS consecutiveFailures ON TABLE schedule TYPE int DEFAULT 0;

-- Max consecutive failures before schedule enters error state
DEFINE FIELD IF NOT EXISTS maxConsecutiveFailures ON TABLE schedule TYPE int DEFAULT 5;

-- Error message if status is 'error'
DEFINE FIELD IF NOT EXISTS lastError ON TABLE schedule TYPE option<string>;

-- Timestamps
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE schedule TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE schedule TYPE datetime VALUE time::now();

-- Last time the schedule successfully triggered
DEFINE FIELD IF NOT EXISTS lastTriggeredAt ON TABLE schedule TYPE option<datetime>;

-- Last time a job completed for this schedule
DEFINE FIELD IF NOT EXISTS lastCompletedAt ON TABLE schedule TYPE option<datetime>;

-- Indexes for scheduling operations

-- Unique schedule name
DEFINE INDEX IF NOT EXISTS unique_schedule_name ON schedule FIELDS name UNIQUE;

-- Finding schedules that need to trigger (ordered by time)
-- Used by getNextScheduledTime() to efficiently find soonest schedule
DEFINE INDEX IF NOT EXISTS idx_schedule_nextRunAt ON schedule FIELDS status, nextRunAt;

-- Finding schedules waiting for job completion
DEFINE INDEX IF NOT EXISTS idx_schedule_activeJobId ON schedule FIELDS activeJobId;

-- Cleanup of transient schedules on startup
DEFINE INDEX IF NOT EXISTS idx_schedule_persistent ON schedule FIELDS isPersistent;
