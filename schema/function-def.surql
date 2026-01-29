-- Function definitions table - stores function configurations
-- (Renamed from 'route' to 'functionDef' for clarity)
DEFINE TABLE IF NOT EXISTS functionDef SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS description ON TABLE functionDef TYPE option<string>;
DEFINE FIELD IF NOT EXISTS handler ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS routePath ON TABLE functionDef TYPE string;
DEFINE FIELD IF NOT EXISTS normalizedRoute ON TABLE functionDef TYPE string;  -- Normalized version of routePath for collision detection
DEFINE FIELD IF NOT EXISTS methods ON TABLE functionDef TYPE set<string>;
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

-- Unique constraint on route+methods combination (prevents exact duplicates)
DEFINE INDEX IF NOT EXISTS idx_functionDef_route_methods ON functionDef FIELDS normalizedRoute, methods UNIQUE;

-- When functionDef is deleted, delete all function-scoped secrets
DEFINE EVENT IF NOT EXISTS delete_functionDef ON TABLE functionDef WHEN $event = "DELETE" THEN {
    DELETE secret WHERE scopeType = "function" AND scopeRef = $before.id;
    DELETE executionLog WHERE functionId = $before.id;
};

-- Prevent overlapping HTTP methods on same normalized route
-- Example: if one function has {GET, POST} and another tries {POST, PUT} on same route,
-- both define POST which is a collision
DEFINE EVENT OVERWRITE check_route_method_overlap ON TABLE functionDef
WHEN $event = "CREATE" OR $event = "UPDATE"
THEN {
    LET $others = SELECT * FROM functionDef
        WHERE normalizedRoute = $value.normalizedRoute
        AND id != $value.id;

    FOR $other IN $others {
        LET $intersection = $value.methods.intersect($other.methods);
        IF $intersection.len() > 0 {
            THROW "Route collision: methods " + <string>$intersection + " already defined for route " + $value.normalizedRoute + " by function " + <string>$other.name;
        };
    };
};

