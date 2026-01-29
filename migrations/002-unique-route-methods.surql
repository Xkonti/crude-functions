-- Migration 002: Enforce unique route+method combinations
--
-- Changes:
-- 1. Convert methods from array to set for automatic deduplication and ordering
-- 2. Add unique index on (normalizedRoute, methods) as baseline constraint
-- 3. Add event to prevent overlapping methods between functions on same route
--
-- The unique index prevents exact duplicate (route, methods) combinations.
-- The event handles the more complex case of overlapping methods between
-- different functions on the same route (e.g., one has {GET, POST}, another
-- has {POST, PUT} - both define POST which is a collision).

-- Change methods field from array to set
-- Sets automatically deduplicate and order values
DEFINE FIELD OVERWRITE methods ON TABLE functionDef TYPE set<string>;

-- Migrate existing values
LET $functionDefs = SELECT id, methods FROM functionDef;
FOR $fun IN $functionDefs {
    UPDATE $fun.id SET methods = <set>$fun.methods;
};

-- Unique index ensures no exact duplicate (route, methods) combinations
DEFINE INDEX OVERWRITE idx_functionDef_route_methods ON functionDef FIELDS normalizedRoute, methods UNIQUE;

-- Event to prevent overlapping HTTP methods on same normalized route
DEFINE EVENT OVERWRITE check_route_method_overlap ON TABLE functionDef
WHEN $event = "CREATE" OR $event = "UPDATE"
THEN {
    LET $others = SELECT * FROM functionDef
        WHERE normalizedRoute = $after.normalizedRoute
        AND id != $after.id;

    FOR $other IN $others {
        LET $intersection = $after.methods.intersect($other.methods);
        IF $intersection.len() > 0 {
            THROW "Route collision: methods " + <string>$intersection + " already defined for route " + $after.normalizedRoute + " by function " + <string>$other.name;
        };
    };
};
