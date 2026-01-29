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
-- - function: record<functionDef> (e.g., functionDef:abc123)
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
