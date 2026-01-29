-- Function definitions table - stores function configurations
-- (Renamed from 'route' to 'functionDef' for clarity)
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

-- Parent field: optional object, defaults to NONE (no CORS)
DEFINE FIELD IF NOT EXISTS cors ON TABLE functionDef TYPE option<object> DEFAULT NONE;

  -- Required when cors is present: array of allowed origins
  DEFINE FIELD IF NOT EXISTS cors.origins ON TABLE functionDef TYPE array<string>;

  -- Optional: allow credentials (cookies, auth headers)
  DEFINE FIELD IF NOT EXISTS cors.credentials ON TABLE functionDef TYPE option<bool>;

  -- Optional: preflight cache duration in seconds
  DEFINE FIELD IF NOT EXISTS cors.maxAge ON TABLE functionDef TYPE option<int>;

  -- Optional: additional headers the client is allowed to send
  DEFINE FIELD IF NOT EXISTS cors.allowHeaders ON TABLE functionDef TYPE option<array<string>>;

  -- Optional: headers the client is allowed to read from response
  DEFINE FIELD IF NOT EXISTS cors.exposeHeaders ON TABLE functionDef TYPE option<array<string>>;


-- Unique name constraint
DEFINE INDEX IF NOT EXISTS unique_functionDef_name ON functionDef FIELDS name UNIQUE;

-- Index for route path lookups (used by FunctionRouter)
DEFINE INDEX IF NOT EXISTS idx_functionDef_path ON functionDef FIELDS routePath;

-- When functionDef is deleted, delete all function-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_functionDef ON TABLE functionDef WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "function" AND scopeRef = $before.id;
    DELETE executionLog WHERE functionId = $before.id;
};

