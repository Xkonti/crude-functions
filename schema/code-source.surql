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
