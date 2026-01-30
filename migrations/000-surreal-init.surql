-- SurrealDB Bootstrap Migration
-- Creates the system namespace/database and schema version tracking
--
-- This migration runs with root credentials.
-- The connection should be established to system/system before running.

DEFINE NAMESPACE IF NOT EXISTS system;
DEFINE DATABASE IF NOT EXISTS system;

DEFINE TABLE IF NOT EXISTS schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON TABLE schema_version TYPE int;
UPSERT schema_version:current SET version = 0;

DEFINE TABLE IF NOT EXISTS setting SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS name ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS isEncrypted ON TABLE setting TYPE bool;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE setting TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE setting TYPE datetime VALUE time::now();
DEFINE INDEX unique_setting ON setting FIELDS name UNIQUE;

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

DEFINE TABLE IF NOT EXISTS verification SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS identifier ON TABLE verification TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE verification TYPE string;
DEFINE FIELD IF NOT EXISTS expiresAt ON TABLE verification TYPE datetime;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE verification TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE verification TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS idx_verification_identifier ON verification FIELDS identifier;

DEFINE TABLE IF NOT EXISTS codeSource SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS name ON TABLE codeSource TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE codeSource TYPE string; -- "manual" or "git"
DEFINE FIELD IF NOT EXISTS enabled ON TABLE codeSource TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS typeSettings ON TABLE codeSource TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS syncSettings ON TABLE codeSource TYPE object FLEXIBLE DEFAULT {};
DEFINE FIELD IF NOT EXISTS lastSyncStartedAt ON TABLE codeSource TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS lastSyncAt ON TABLE codeSource TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS lastSyncError ON TABLE codeSource TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE codeSource TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE codeSource TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS unique_codeSource_name ON codeSource FIELDS name UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_codeSource_enabled ON codeSource FIELDS enabled;
DEFINE INDEX IF NOT EXISTS idx_codeSource_type ON codeSource FIELDS type;

DEFINE TABLE IF NOT EXISTS apiKeyGroup SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS name ON TABLE apiKeyGroup TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE apiKeyGroup TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS unique_apiKeyGroup_name ON apiKeyGroup FIELDS name UNIQUE;

DEFINE TABLE IF NOT EXISTS apiKey SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS groupId ON TABLE apiKey TYPE record<apiKeyGroup>;
DEFINE FIELD IF NOT EXISTS name ON TABLE apiKey TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE apiKey TYPE string;  -- encrypted
DEFINE FIELD IF NOT EXISTS valueHash ON TABLE apiKey TYPE string;  -- for O(1) lookup
DEFINE FIELD IF NOT EXISTS description ON TABLE apiKey TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE apiKey TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE apiKey TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS unique_apiKey_group_name ON apiKey FIELDS groupId, name UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_apiKey_group_hash ON apiKey FIELDS groupId, valueHash;

DEFINE TABLE IF NOT EXISTS secret SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS name ON TABLE secret TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE secret TYPE string;
DEFINE FIELD IF NOT EXISTS comment ON TABLE secret TYPE option<string>;
DEFINE FIELD IF NOT EXISTS scopeType ON TABLE secret TYPE "global" | "function" | "group" | "key";
DEFINE FIELD IF NOT EXISTS scopeRef ON TABLE secret TYPE option<record>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE secret TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE secret TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS unique_secret_name_scope ON secret FIELDS name, scopeType, scopeRef UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_secret_scopeType ON secret FIELDS scopeType;
DEFINE INDEX IF NOT EXISTS idx_secret_scopeRef ON secret FIELDS scopeRef;

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
DEFINE INDEX IF NOT EXISTS unique_functionDef_name ON functionDef FIELDS name UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_functionDef_path ON functionDef FIELDS routePath;

DEFINE TABLE IF NOT EXISTS executionMetric SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionMetric TYPE option<record<functionDef>>;
DEFINE FIELD IF NOT EXISTS type ON TABLE executionMetric TYPE int;
DEFINE FIELD IF NOT EXISTS avgTime ON TABLE executionMetric TYPE duration;
DEFINE FIELD IF NOT EXISTS maxTime ON TABLE executionMetric TYPE duration;
DEFINE FIELD IF NOT EXISTS executionCount ON TABLE executionMetric TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionMetric TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionMetric TYPE datetime VALUE time::now() READONLY;
DEFINE INDEX IF NOT EXISTS idx_metric_type_timestamp ON executionMetric FIELDS type, timestamp;
DEFINE INDEX IF NOT EXISTS idx_metric_function_type_timestamp ON executionMetric FIELDS functionId, type, timestamp;

DEFINE TABLE IF NOT EXISTS metricsState SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS key ON TABLE metricsState TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE metricsState TYPE datetime;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE metricsState TYPE datetime VALUE time::now();

DEFINE TABLE IF NOT EXISTS executionLog SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS requestId ON TABLE executionLog TYPE string;
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionLog TYPE option<record<functionDef>>;
DEFINE FIELD IF NOT EXISTS level ON TABLE executionLog TYPE
    "log" | "debug" | "info" | "warn" | "error" | "trace" |
    "stdout" | "stderr" |
    "exec_start" | "exec_end" | "exec_reject";
DEFINE FIELD IF NOT EXISTS message ON TABLE executionLog TYPE string;
DEFINE FIELD IF NOT EXISTS args ON TABLE executionLog TYPE option<string>;
DEFINE FIELD IF NOT EXISTS sequence ON TABLE executionLog TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionLog TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionLog TYPE datetime VALUE time::now() READONLY;
DEFINE INDEX IF NOT EXISTS idx_log_requestId ON executionLog FIELDS requestId;
DEFINE INDEX IF NOT EXISTS idx_log_function_timestamp ON executionLog FIELDS functionId, timestamp;
DEFINE INDEX IF NOT EXISTS idx_log_timestamp ON executionLog FIELDS timestamp;
DEFINE INDEX IF NOT EXISTS idx_log_function_level ON executionLog FIELDS functionId, level;

DEFINE TABLE IF NOT EXISTS job SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS type ON TABLE job TYPE string;
DEFINE FIELD IF NOT EXISTS status ON TABLE job TYPE "pending" | "running" | "completed" | "failed" | "cancelled"
    DEFAULT "pending";
DEFINE FIELD IF NOT EXISTS executionMode ON TABLE job TYPE "sequential" | "concurrent"
    DEFAULT "sequential";
DEFINE FIELD IF NOT EXISTS payload ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS result ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS processInstanceId ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS retryCount ON TABLE job TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS maxRetries ON TABLE job TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS priority ON TABLE job TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS referenceType ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS referenceId ON TABLE job TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE job TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS startedAt ON TABLE job TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS completedAt ON TABLE job TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS cancelledAt ON TABLE job TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS cancelReason ON TABLE job TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_job_status ON job FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_job_type_status ON job FIELDS type, status;
DEFINE INDEX IF NOT EXISTS idx_job_priority ON job FIELDS status, priority, createdAt;
DEFINE INDEX IF NOT EXISTS idx_job_reference ON job FIELDS referenceType, referenceId, status;
DEFINE INDEX IF NOT EXISTS idx_job_completed ON job FIELDS status, completedAt;

DEFINE TABLE IF NOT EXISTS schedule SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS name ON TABLE schedule TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE schedule TYPE option<string>;
DEFINE FIELD IF NOT EXISTS type ON TABLE schedule TYPE "one_off" | "dynamic" | "sequential_interval" | "concurrent_interval";
DEFINE FIELD IF NOT EXISTS status ON TABLE schedule TYPE "active" | "paused" | "completed" | "error"
    DEFAULT "active";
DEFINE FIELD IF NOT EXISTS isPersistent ON TABLE schedule TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS nextRunAt ON TABLE schedule TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS intervalMs ON TABLE schedule TYPE option<int>;
DEFINE FIELD IF NOT EXISTS jobType ON TABLE schedule TYPE string;
DEFINE FIELD IF NOT EXISTS jobPayload ON TABLE schedule TYPE option<string>;
DEFINE FIELD IF NOT EXISTS jobPriority ON TABLE schedule TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS jobMaxRetries ON TABLE schedule TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS jobExecutionMode ON TABLE schedule TYPE "sequential" | "concurrent"
    DEFAULT "sequential";
DEFINE FIELD IF NOT EXISTS jobReferenceType ON TABLE schedule TYPE option<string>;
DEFINE FIELD IF NOT EXISTS jobReferenceId ON TABLE schedule TYPE option<string>;
DEFINE FIELD IF NOT EXISTS activeJobId ON TABLE schedule TYPE option<record<job>>;
DEFINE FIELD IF NOT EXISTS consecutiveFailures ON TABLE schedule TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS maxConsecutiveFailures ON TABLE schedule TYPE int DEFAULT 5;
DEFINE FIELD IF NOT EXISTS lastError ON TABLE schedule TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE schedule TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE schedule TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lastTriggeredAt ON TABLE schedule TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS lastCompletedAt ON TABLE schedule TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS unique_schedule_name ON schedule FIELDS name UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_schedule_nextRunAt ON schedule FIELDS status, nextRunAt;
DEFINE INDEX IF NOT EXISTS idx_schedule_activeJobId ON schedule FIELDS activeJobId;
DEFINE INDEX IF NOT EXISTS idx_schedule_persistent ON schedule FIELDS isPersistent;

DEFINE EVENT IF NOT EXISTS delete_group_secrets ON TABLE apiKeyGroup WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "group" AND scopeRef = $before.id
};
DEFINE EVENT IF NOT EXISTS delete_key_secrets ON TABLE apiKey WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "key" AND scopeRef = $before.id
};
DEFINE EVENT IF NOT EXISTS delete_functionDef ON TABLE functionDef WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "function" AND scopeRef = $before.id;
    DELETE executionLog WHERE functionId = $before.id;
};
DEFINE EVENT IF NOT EXISTS clear_schedule_activeJob ON TABLE job WHEN $event = "DELETE" THEN {
    UPDATE schedule SET activeJobId = NONE WHERE activeJobId = $before.id
};
