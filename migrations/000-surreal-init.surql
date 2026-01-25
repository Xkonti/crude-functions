-- SurrealDB Bootstrap Migration
-- Creates the system namespace/database and schema version tracking
--
-- This migration runs with root credentials.
-- The connection should be established to system/system before running.

-- Ensure namespace exists (idempotent)
DEFINE NAMESPACE IF NOT EXISTS system;

-- Ensure database exists (idempotent)
DEFINE DATABASE IF NOT EXISTS system;

-- Schema version tracking table
DEFINE TABLE IF NOT EXISTS schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON TABLE schema_version TYPE int;

-- Create the initial version record
-- Using a fixed ID 'current' for easy lookup
UPSERT schema_version:current SET version = 0;
