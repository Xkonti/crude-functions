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

-- ============================================
-- Schema Version Table Redesign
-- ============================================
-- Migrate from schema_version to schemaVersion with:
-- - History of all applied migrations
-- - Event-based integrity enforcement
-- - Self-registering migrations

-- Create new schemaVersion table
DEFINE TABLE IF NOT EXISTS schemaVersion SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS version ON TABLE schemaVersion TYPE int;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE schemaVersion TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE schemaVersion TYPE datetime VALUE time::now();

-- Index for version lookups (NOT unique - current record shares version with history)
DEFINE INDEX IF NOT EXISTS idx_schemaVersion_version ON schemaVersion FIELDS version;

-- CREATE event: Validate uniqueness and update current pointer
DEFINE EVENT OVERWRITE schemaVersion_on_create ON TABLE schemaVersion
WHEN $event = "CREATE" AND <string>$value.id != "schemaVersion:current"
THEN {
    -- Check for duplicate version using count (excludes current record)
    -- Count > 1 means: the new record + at least one other history record = duplicate
    LET $count = (SELECT count() FROM schemaVersion
        WHERE version = $value.version
        AND <string>id != "schemaVersion:current"
        GROUP ALL)[0].count ?? 0;

    IF $count > 1 {
        THROW "[CODE] DUPLICATE_MIGRATION [CODE] Migration version [VERSION] " + <string>$value.version + " [VERSION] has already been applied";
    };

    -- Update the current pointer to this new version
    UPSERT schemaVersion:current SET version = $value.version;
};

-- UPDATE event: Restrict updates
DEFINE EVENT OVERWRITE schemaVersion_on_update ON TABLE schemaVersion
WHEN $event = "UPDATE"
THEN {
    -- Only allow updates to the 'current' record
    IF <string>$value.id != "schemaVersion:current" {
        THROW "[CODE] IMMUTABLE_RECORD [CODE] Cannot update schema version history records - they are immutable";
    };

    -- For 'current': only allow setting to the max version
    LET $maxVersion = (SELECT VALUE version FROM schemaVersion
        WHERE <string>id != "schemaVersion:current"
        ORDER BY version DESC LIMIT 1)[0];

    IF $after.version != $maxVersion {
        THROW "[CODE] INVALID_VERSION [CODE] schemaVersion:current can only be set to the highest version [MAX_VERSION] " + <string>$maxVersion + " [MAX_VERSION], attempted [ATTEMPTED_VERSION] " + <string>$after.version + " [ATTEMPTED_VERSION]";
    };

    -- Check that version is actually incrementing (skip for first migration when $before.version is NONE)
    IF $before.version IS NOT NONE AND $after.version <= $before.version {
        THROW "[CODE] VERSION_NOT_INCREMENTING [CODE] Version must increase from [BEFORE_VERSION] " + <string>$before.version + " [BEFORE_VERSION] to [AFTER_VERSION] " + <string>$after.version + " [AFTER_VERSION]";
    };
};

-- DELETE event: Prevent deletion of any version records
DEFINE EVENT OVERWRITE schemaVersion_on_delete ON TABLE schemaVersion
WHEN $event = "DELETE"
THEN {
    THROW "[CODE] DELETE_NOT_ALLOWED [CODE] Cannot delete schema version records - version [VERSION] " + <string>$before.version + " [VERSION]";
};

-- Migrate existing version 0 to new table (creates history record)
CREATE schemaVersion SET version = 0;

-- Record this migration (version 1)
CREATE schemaVersion SET version = 1;

-- Remove old table
REMOVE TABLE IF EXISTS schema_version;
