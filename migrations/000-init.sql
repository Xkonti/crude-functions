-- Crude Functions - Initial Schema
-- Consolidated from migrations 000-007

-- Schema version tracking table
CREATE TABLE IF NOT EXISTS schemaVersion (
  version INTEGER NOT NULL
);

--------------------------------------------------------------------------------
-- Better Auth Tables
--------------------------------------------------------------------------------

-- Users table - stores user accounts with authentication metadata
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  image TEXT,
  role TEXT,
  banned INTEGER DEFAULT 0,
  banReason TEXT,
  banExpires TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);

-- Sessions table - stores active user sessions with metadata
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  ipAddress TEXT,
  userAgent TEXT,
  impersonatedBy TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
CREATE INDEX IF NOT EXISTS idx_session_userId ON session(userId);

-- Accounts table - stores credentials and OAuth provider links
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON account(providerId, accountId);
CREATE INDEX IF NOT EXISTS idx_account_userId ON account(userId);

-- Verification table - stores email verification and password reset tokens
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

--------------------------------------------------------------------------------
-- API Key Management
--------------------------------------------------------------------------------

-- API Key Groups table - manages key groupings
CREATE TABLE IF NOT EXISTS apiKeyGroups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ensure management group always exists
INSERT OR IGNORE INTO apiKeyGroups (name, description)
VALUES ('management', 'Management API keys');

-- API Keys table - stores API keys with group relationships
CREATE TABLE IF NOT EXISTS apiKeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupId INTEGER NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  valueHash TEXT,
  description TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_apiKeys_group_name ON apiKeys(groupId, name);
CREATE INDEX IF NOT EXISTS idx_apiKeys_group ON apiKeys(groupId);
CREATE INDEX IF NOT EXISTS idx_apiKeys_hash ON apiKeys(groupId, valueHash);

--------------------------------------------------------------------------------
-- Routes and Function Execution
--------------------------------------------------------------------------------

-- Routes table - stores function routes with their configuration
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  handler TEXT NOT NULL,
  route TEXT NOT NULL,
  methods TEXT NOT NULL,  -- JSON array: ["GET", "POST"]
  keys TEXT,              -- JSON array: [1, 2] (group IDs) or NULL
  enabled INTEGER NOT NULL DEFAULT 1,  -- 1 = enabled, 0 = disabled
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routes_route ON routes(route);

-- Execution logs table - stores captured console output from function handlers
CREATE TABLE IF NOT EXISTS executionLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestId TEXT NOT NULL,
  routeId INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  args TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executionLogs_requestId ON executionLogs(requestId);
CREATE INDEX IF NOT EXISTS idx_executionLogs_routeId ON executionLogs(routeId, id);
CREATE INDEX IF NOT EXISTS idx_executionLogs_route_level ON executionLogs(routeId, level, id);
CREATE INDEX IF NOT EXISTS idx_executionLogs_timestamp ON executionLogs(timestamp);

-- Execution metrics table - stores execution timing data for analytics
-- routeId is NULL for global metrics (combined across all functions)
CREATE TABLE IF NOT EXISTS executionMetrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routeId INTEGER,  -- NULL for global metrics, no FK: orphaned records retained for aggregation
  type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
  avgTimeMs REAL NOT NULL,
  maxTimeMs INTEGER NOT NULL,
  executionCount INTEGER NOT NULL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_executionMetrics_routeId ON executionMetrics(routeId);
CREATE INDEX IF NOT EXISTS idx_executionMetrics_type_route_timestamp
  ON executionMetrics(type, COALESCE(routeId, -1), timestamp);
CREATE INDEX IF NOT EXISTS idx_executionMetrics_timestamp ON executionMetrics(timestamp);

-- Metrics aggregation state - tracks watermarks for aggregation progress
CREATE TABLE IF NOT EXISTS metricsState (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

--------------------------------------------------------------------------------
-- Secrets and Settings
--------------------------------------------------------------------------------

-- Secrets table - multi-scope secret storage
CREATE TABLE IF NOT EXISTS secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  comment TEXT,
  scope INTEGER NOT NULL,
  functionId INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  apiGroupId INTEGER REFERENCES apiKeyGroups(id) ON DELETE CASCADE,
  apiKeyId INTEGER REFERENCES apiKeys(id) ON DELETE CASCADE,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Settings table - stores application settings (global and per-user)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  userId TEXT REFERENCES user(id) ON DELETE CASCADE,
  value TEXT,
  isEncrypted INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_name_user
ON settings(name, COALESCE(userId, ''));
CREATE INDEX IF NOT EXISTS idx_settings_name ON settings(name);
CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(userId) WHERE userId IS NOT NULL;
