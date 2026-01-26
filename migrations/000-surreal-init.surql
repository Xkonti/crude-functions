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
