-- API key groups table - organizes API keys into groups
DEFINE TABLE IF NOT EXISTS apiKeyGroup SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE apiKeyGroup TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE apiKeyGroup TYPE option<string>;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE apiKeyGroup TYPE datetime VALUE time::now();

-- Unique name constraint
DEFINE INDEX IF NOT EXISTS unique_apiKeyGroup_name ON apiKeyGroup FIELDS name UNIQUE;

-- When apiKeyGroup is deleted, delete all group-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_group_secrets ON TABLE apiKeyGroup WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "group" AND scopeRef = $before.id
}
