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
