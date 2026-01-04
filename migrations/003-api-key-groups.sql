-- API Key Groups table
-- Extracts implicit groups into explicit table for proper FK relationships

-- 1. Create api_key_groups table
CREATE TABLE api_key_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. Migrate existing groups from api_keys
INSERT INTO api_key_groups (name)
SELECT DISTINCT key_group FROM api_keys WHERE key_group IS NOT NULL;

-- 3. Ensure management group always exists
INSERT OR IGNORE INTO api_key_groups (name, description)
VALUES ('management', 'Management API keys');

-- 4. Rebuild api_keys with FK (SQLite requires full table rebuild for FK changes)
CREATE TABLE api_keys_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES api_key_groups(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO api_keys_new (id, group_id, value, description, created_at)
SELECT ak.id, g.id, ak.value, ak.description, ak.created_at
FROM api_keys ak
JOIN api_key_groups g ON g.name = ak.key_group;

DROP TABLE api_keys;
ALTER TABLE api_keys_new RENAME TO api_keys;

-- 5. Recreate indexes
CREATE UNIQUE INDEX idx_api_keys_group_value ON api_keys(group_id, value);
CREATE INDEX idx_api_keys_group ON api_keys(group_id);
