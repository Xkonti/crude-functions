-- Migration 001: Add CORS configuration to functionDef table
--
-- Adds an optional CORS configuration field to function definitions.
-- When present, enables automatic CORS handling for the route:
-- - OPTIONS preflight requests are intercepted and responded to automatically
-- - CORS headers are added to all responses for that route
--
-- CORS object structure:
-- {
--   origins: ["https://app.example.com"],  -- Required: allowed origins, or ["*"] for any
--   credentials: true,                      -- Optional: allow cookies/auth headers
--   maxAge: 86400,                          -- Optional: preflight cache seconds
--   allowHeaders: ["X-Custom-Header"],      -- Optional: extra allowed request headers
--   exposeHeaders: ["X-Request-Id"]         -- Optional: headers client can read
-- }

DEFINE FIELD IF NOT EXISTS cors ON TABLE functionDef TYPE option<object> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS cors.origins ON TABLE functionDef TYPE array<string>;
DEFINE FIELD IF NOT EXISTS cors.credentials ON TABLE functionDef TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS cors.maxAge ON TABLE functionDef TYPE option<int>;
DEFINE FIELD IF NOT EXISTS cors.allowHeaders ON TABLE functionDef TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS cors.exposeHeaders ON TABLE functionDef TYPE option<array<string>>;

-- Normalized route pattern for collision detection
-- This field stores the canonical form of routePath where all parameter names
-- are replaced with wildcards while preserving regex constraints.
-- Used to detect route collisions (e.g., /users/:id vs /users/:userId both normalize to /users/*)
DEFINE FIELD IF NOT EXISTS normalizedRoute ON TABLE functionDef TYPE string;
