-- SurrealDB Schema Version Tracking
-- This migration initializes the schema version tracking table

-- Define the schema_version table
-- Using SCHEMAFULL to enforce strict typing
DEFINE TABLE schema_version SCHEMAFULL;
DEFINE FIELD version ON schema_version TYPE int;

-- Create the initial version record
-- Using a fixed ID 'current' for easy lookup
CREATE schema_version:current SET version = 0;
