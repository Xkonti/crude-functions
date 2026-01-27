-- SurrealDB Bootstrap Migration
-- Creates the system namespace/database and schema version tracking
--
-- This migration runs with root credentials.
-- The connection should be established to system/system before running.

-- TODO: Make it parametrized somehow
DEFINE NAMESPACE IF NOT EXISTS system;
DEFINE DATABASE IF NOT EXISTS system;

-- Schema version tracking table
DEFINE TABLE IF NOT EXISTS schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON TABLE schema_version TYPE int;

-- Create the initial version record
-- Using a fixed ID 'current' for easy lookup
UPSERT schema_version:current SET version = 0;


--------------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------------

-- Settings table - stores application settings (global and in future per-user)
DEFINE TABLE IF NOT EXISTS setting SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS isEncrypted ON TABLE setting TYPE bool;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE setting TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE setting TYPE datetime VALUE time::now();

DEFINE INDEX unique_setting ON setting FIELDS name UNIQUE;

--------------------------------------------------------------------------------
-- Better Auth Tables
--------------------------------------------------------------------------------

-- User table - core user accounts
-- Note: `id` field is implicit in SurrealDB (type `record`, auto-created)
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS emailVerified ON TABLE user TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS name ON TABLE user TYPE option<string>;
DEFINE FIELD IF NOT EXISTS image ON TABLE user TYPE option<string>;
DEFINE FIELD IF NOT EXISTS role ON TABLE user TYPE option<string>;
DEFINE FIELD IF NOT EXISTS banned ON TABLE user TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS banReason ON TABLE user TYPE option<string>;
DEFINE FIELD IF NOT EXISTS banExpires ON TABLE user TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE user TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE user TYPE datetime VALUE time::now();

DEFINE INDEX IF NOT EXISTS unique_user_email ON user FIELDS email UNIQUE;

-- Session table - active user sessions
DEFINE TABLE IF NOT EXISTS session SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS userId ON TABLE session TYPE record<user>;
DEFINE FIELD IF NOT EXISTS expiresAt ON TABLE session TYPE datetime;
DEFINE FIELD IF NOT EXISTS token ON TABLE session TYPE string;
DEFINE FIELD IF NOT EXISTS ipAddress ON TABLE session TYPE option<string>;
DEFINE FIELD IF NOT EXISTS userAgent ON TABLE session TYPE option<string>;
DEFINE FIELD IF NOT EXISTS impersonatedBy ON TABLE session TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE session TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE session TYPE datetime VALUE time::now();

DEFINE INDEX IF NOT EXISTS unique_session_token ON session FIELDS token UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_session_userId ON session FIELDS userId;

-- Account table - credentials and OAuth provider links
DEFINE TABLE IF NOT EXISTS account SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS userId ON TABLE account TYPE record<user>;
DEFINE FIELD IF NOT EXISTS accountId ON TABLE account TYPE string;
DEFINE FIELD IF NOT EXISTS providerId ON TABLE account TYPE string;
DEFINE FIELD IF NOT EXISTS accessToken ON TABLE account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS refreshToken ON TABLE account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS idToken ON TABLE account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS accessTokenExpiresAt ON TABLE account TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS refreshTokenExpiresAt ON TABLE account TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS scope ON TABLE account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS password ON TABLE account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE account TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE account TYPE datetime VALUE time::now();

DEFINE INDEX IF NOT EXISTS unique_account_provider ON account FIELDS providerId, accountId UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_account_userId ON account FIELDS userId;

-- Verification table - email verification and password reset tokens
DEFINE TABLE IF NOT EXISTS verification SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS identifier ON TABLE verification TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE verification TYPE string;
DEFINE FIELD IF NOT EXISTS expiresAt ON TABLE verification TYPE datetime;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE verification TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE verification TYPE option<datetime>;

DEFINE INDEX IF NOT EXISTS idx_verification_identifier ON verification FIELDS identifier;

--------------------------------------------------------------------------------
-- Code Sources
--------------------------------------------------------------------------------

-- Code sources table - manages code directories under code/
DEFINE TABLE IF NOT EXISTS codeSource SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE codeSource TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE codeSource TYPE string; -- "manual" or "git"
DEFINE FIELD IF NOT EXISTS enabled ON TABLE codeSource TYPE bool DEFAULT true;

-- Type-specific settings (FLEXIBLE allows varying structures by source type)
-- Fields include: url, branch, tag, commit, authToken (encrypted by provider)
DEFINE FIELD IF NOT EXISTS typeSettings ON TABLE codeSource TYPE object FLEXIBLE DEFAULT {};

-- Sync settings (common across syncable types)
-- Fields include: intervalSeconds, webhookEnabled, webhookSecret (encrypted by service)
DEFINE FIELD IF NOT EXISTS syncSettings ON TABLE codeSource TYPE object FLEXIBLE DEFAULT {};

-- Sync status tracking
DEFINE FIELD IF NOT EXISTS lastSyncStartedAt ON TABLE codeSource TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS lastSyncAt ON TABLE codeSource TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS lastSyncError ON TABLE codeSource TYPE option<string>;

-- Timestamps
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE codeSource TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE codeSource TYPE datetime VALUE time::now();

-- Indexes
DEFINE INDEX IF NOT EXISTS unique_codeSource_name ON codeSource FIELDS name UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_codeSource_enabled ON codeSource FIELDS enabled;
DEFINE INDEX IF NOT EXISTS idx_codeSource_type ON codeSource FIELDS type;

--------------------------------------------------------------------------------
-- API Key Groups
--------------------------------------------------------------------------------

-- API key groups table - organizes API keys into groups
DEFINE TABLE IF NOT EXISTS apiKeyGroup SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE apiKeyGroup TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE apiKeyGroup TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now();

-- Unique name constraint
DEFINE INDEX IF NOT EXISTS unique_apiKeyGroup_name ON apiKeyGroup FIELDS name UNIQUE;

--------------------------------------------------------------------------------
-- API Keys
--------------------------------------------------------------------------------

-- API keys table - stores encrypted API keys
DEFINE TABLE IF NOT EXISTS apiKey SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS groupId ON TABLE apiKey TYPE record<apiKeyGroup>;
DEFINE FIELD IF NOT EXISTS name ON TABLE apiKey TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE apiKey TYPE string;  -- encrypted
DEFINE FIELD IF NOT EXISTS valueHash ON TABLE apiKey TYPE string;  -- for O(1) lookup
DEFINE FIELD IF NOT EXISTS description ON TABLE apiKey TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE apiKey TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE apiKey TYPE datetime VALUE time::now();

-- Unique constraint: name must be unique within a group
DEFINE INDEX IF NOT EXISTS unique_apiKey_group_name ON apiKey FIELDS groupId, name UNIQUE;

-- Index for hash-based lookups (O(1) key validation)
DEFINE INDEX IF NOT EXISTS idx_apiKey_group_hash ON apiKey FIELDS groupId, valueHash;

--------------------------------------------------------------------------------
-- Secrets
--------------------------------------------------------------------------------

-- Secrets table - stores encrypted secrets with flexible scoping
DEFINE TABLE IF NOT EXISTS secret SCHEMAFULL TYPE NORMAL;

-- Core fields
DEFINE FIELD IF NOT EXISTS name ON TABLE secret TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE secret TYPE string;  -- encrypted
DEFINE FIELD IF NOT EXISTS comment ON TABLE secret TYPE option<string>;

-- Scope type as string literal
DEFINE FIELD IF NOT EXISTS scopeType ON TABLE secret TYPE "global" | "function" | "group" | "key";

-- Scope reference as record:
-- - global: NONE (null)
-- - function: record (e.g., function:123 - synthetic record for SQLite route ID)
-- - group: record<apiKeyGroup>
-- - key: record<apiKey>
DEFINE FIELD IF NOT EXISTS scopeRef ON TABLE secret TYPE option<record>;

-- Timestamps
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE secret TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE secret TYPE datetime VALUE time::now();

-- Unique index: no duplicate secrets with same name in same scope
DEFINE INDEX IF NOT EXISTS unique_secret_name_scope ON secret FIELDS name, scopeType, scopeRef UNIQUE;

-- Indexes for efficient lookups
DEFINE INDEX IF NOT EXISTS idx_secret_scopeType ON secret FIELDS scopeType;
DEFINE INDEX IF NOT EXISTS idx_secret_scopeRef ON secret FIELDS scopeRef;

--------------------------------------------------------------------------------
-- Function Definitions
--------------------------------------------------------------------------------

-- Function definitions table - stores function configurations
-- (Renamed from 'route' to 'functionDef' for clarity)
DEFINE TABLE IF NOT EXISTS functionDef SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE functionDef TYPE option<string>;
DEFINE FIELD IF NOT EXISTS handler ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS routePath ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS methods ON TABLE functionDef TYPE array<string>;
DEFINE FIELD IF NOT EXISTS keys ON TABLE functionDef TYPE option<array<string>>;  -- API key group IDs
DEFINE FIELD IF NOT EXISTS enabled ON TABLE functionDef TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE functionDef TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE functionDef TYPE datetime VALUE time::now();

-- Unique name constraint
DEFINE INDEX IF NOT EXISTS unique_functionDef_name ON functionDef FIELDS name UNIQUE;

-- Index for route path lookups (used by FunctionRouter)
DEFINE INDEX IF NOT EXISTS idx_functionDef_path ON functionDef FIELDS routePath;

--------------------------------------------------------------------------------
-- Execution Metrics
--------------------------------------------------------------------------------

-- Execution metrics table - stores execution timing data for functions
-- Designed for high-frequency inserts from function executions
DEFINE TABLE IF NOT EXISTS executionMetric SCHEMAFULL TYPE NORMAL;

-- Function reference (optional - NONE for global/combined metrics)
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionMetric TYPE option<record<functionDef>>;

-- Metric type as integer for efficiency:
-- 0 = execution (raw), 1 = minute, 2 = hour, 3 = day (aggregated)
DEFINE FIELD IF NOT EXISTS type ON TABLE executionMetric TYPE int;

-- Timing data using duration type (enables future in-database processing)
DEFINE FIELD IF NOT EXISTS avgTime ON TABLE executionMetric TYPE duration;
DEFINE FIELD IF NOT EXISTS maxTime ON TABLE executionMetric TYPE duration;

-- Execution count (for aggregation weighting)
DEFINE FIELD IF NOT EXISTS executionCount ON TABLE executionMetric TYPE int DEFAULT 1;

-- Timestamp for the metric (when execution occurred or aggregation window start)
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionMetric TYPE datetime DEFAULT time::now();

-- Record creation timestamp
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionMetric TYPE datetime VALUE time::now() READONLY;

-- Indexes optimized for aggregation queries
-- Primary: type + timestamp range for watermark-based aggregation windows
DEFINE INDEX IF NOT EXISTS idx_metric_type_timestamp ON executionMetric FIELDS type, timestamp;

-- Per-function metrics lookup by type and time range
DEFINE INDEX IF NOT EXISTS idx_metric_function_type_timestamp ON executionMetric FIELDS functionId, type, timestamp;

--------------------------------------------------------------------------------
-- Metrics Aggregation State
--------------------------------------------------------------------------------

-- Metrics state table - tracks aggregation watermarks
-- Uses fixed record IDs for O(1) access: metricsState:lastProcessedMinute, etc.
DEFINE TABLE IF NOT EXISTS metricsState SCHEMAFULL TYPE NORMAL;

-- Marker key (stored for clarity, ID is the primary access pattern)
DEFINE FIELD IF NOT EXISTS key ON TABLE metricsState TYPE string;

-- Marker value (datetime for watermark timestamps)
DEFINE FIELD IF NOT EXISTS value ON TABLE metricsState TYPE datetime;

-- Last update timestamp
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE metricsState TYPE datetime VALUE time::now();

--------------------------------------------------------------------------------
-- Console/Execution Logs
--------------------------------------------------------------------------------

-- Execution logs table - stores captured console output from function handlers
-- Designed for batched inserts (50 entries at a time)
DEFINE TABLE IF NOT EXISTS executionLog SCHEMAFULL TYPE NORMAL;

-- Request identifier (UUID for correlating logs within a single execution)
DEFINE FIELD IF NOT EXISTS requestId ON TABLE executionLog TYPE string;

-- Function reference (optional - orphaned logs may have NONE functionId)
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionLog TYPE option<record<functionDef>>;

-- Log level
DEFINE FIELD IF NOT EXISTS level ON TABLE executionLog TYPE
    "log" | "debug" | "info" | "warn" | "error" | "trace" |
    "stdout" | "stderr" |
    "exec_start" | "exec_end" | "exec_reject";

-- Log message
DEFINE FIELD IF NOT EXISTS message ON TABLE executionLog TYPE string;

-- Additional arguments (JSON-serialized, optional)
DEFINE FIELD IF NOT EXISTS args ON TABLE executionLog TYPE option<string>;

-- Sequence number within batch for ordering (replaces microsecond timestamp hack)
DEFINE FIELD IF NOT EXISTS sequence ON TABLE executionLog TYPE int DEFAULT 0;

-- Timestamp when log was captured
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionLog TYPE datetime DEFAULT time::now();

-- Record creation timestamp
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionLog TYPE datetime VALUE time::now() READONLY;

-- Indexes for query patterns
-- Logs by request (debugging a specific execution)
DEFINE INDEX IF NOT EXISTS idx_log_requestId ON executionLog FIELDS requestId;

-- Logs by function with time-based pagination (newest first)
DEFINE INDEX IF NOT EXISTS idx_log_function_timestamp ON executionLog FIELDS functionId, timestamp;

-- Global time-based pagination
DEFINE INDEX IF NOT EXISTS idx_log_timestamp ON executionLog FIELDS timestamp;

-- Level filtering within function
DEFINE INDEX IF NOT EXISTS idx_log_function_level ON executionLog FIELDS functionId, level;

--------------------------------------------------------------------------------
-- Cascade Delete Events
--------------------------------------------------------------------------------

-- When apiKeyGroup is deleted, delete all group-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_group_secrets ON TABLE apiKeyGroup WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "group" AND scopeRef = $before.id
};

-- When apiKey is deleted, delete all key-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_key_secrets ON TABLE apiKey WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "key" AND scopeRef = $before.id
};

-- When functionDef is deleted, delete all function-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_functionDef_secrets ON TABLE functionDef WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "function" AND scopeRef = $before.id
};
