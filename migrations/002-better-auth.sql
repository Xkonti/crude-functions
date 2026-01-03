-- Better Auth: Users table
-- Stores user accounts with authentication metadata
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

-- Better Auth: Sessions table
-- Stores active user sessions with metadata
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

-- Better Auth: Accounts table
-- Stores credentials and OAuth provider links
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

-- Better Auth: Verification table
-- Stores email verification and password reset tokens
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);
