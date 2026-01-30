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

-- When apiKey is deleted, delete all key-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_key_secrets ON TABLE apiKey WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "key" AND scopeRef = $before.id
};

