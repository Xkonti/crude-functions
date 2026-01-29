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

-- Enforce unique route+method combinations
--
-- Changes:
-- 1. Convert methods from array to set for automatic deduplication and ordering
-- 2. Add unique index on (normalizedRoute, methods) as baseline constraint
-- 3. Add event to prevent overlapping methods between functions on same route
--
-- The unique index prevents exact duplicate (route, methods) combinations.
-- The event handles the more complex case of overlapping methods between
-- different functions on the same route

DEFINE FIELD OVERWRITE methods ON TABLE functionDef TYPE set<string>;

-- Migrate existing values
LET $functionDefs = SELECT id, methods FROM functionDef;
FOR $fun IN $functionDefs {
    UPDATE $fun.id SET methods = <set>$fun.methods;
};

DEFINE INDEX OVERWRITE idx_functionDef_route_methods ON functionDef FIELDS normalizedRoute, methods UNIQUE;
DEFINE EVENT OVERWRITE check_route_method_overlap ON TABLE functionDef
WHEN $event = "CREATE" OR $event = "UPDATE"
THEN {
    LET $others = SELECT * FROM functionDef
        WHERE normalizedRoute = $value.normalizedRoute
        AND <string>id != <string>$value.id;

    FOR $other IN $others {
        LET $intersection = $value.methods.intersect($other.methods);
        IF $intersection.len() > 0 {
            THROW "[CODE] ROUTE_METHOD_COLLISION [CODE] Route collision on [ROUTE] " + $value.normalizedRoute + " [ROUTE] for methods [METHODS] " + <string>$intersection + " [METHODS] already defined by function [FUNCTION] " + <string>$other.name + " [FUNCTION]";
        };
    };
};

-- Remove index that is not needed
REMOVE INDEX IF EXISTS idx_functionDef_path ON functionDef;
