-- Routes table
-- Stores function routes with their configuration

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  handler TEXT NOT NULL,
  route TEXT NOT NULL,
  methods TEXT NOT NULL,  -- JSON array: ["GET", "POST"]
  keys TEXT,              -- JSON array: ["api"] or NULL
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups by route path
CREATE INDEX IF NOT EXISTS idx_routes_route ON routes(route);
