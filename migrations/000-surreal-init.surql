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


--------------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------------

-- Settings table - stores application settings (global and per-user)
DEFINE TABLE IF NOT EXISTS setting
  SCHEMAFULL TYPE NORMAL
  ;

DEFINE FIELD IF NOT EXISTS
  name ON TABLE settings
  TYPE string
  ;

-- No users defined yet
-- DEFINE FIELD IF NOT EXISTS
--   user ON TABLE settings
--   TYPE option<record<user>>
--   ;

DEFINE FIELD IF NOT EXISTS
  value ON TABLE settings
  TYPE string
  ;

DEFINE FIELD IF NOT EXISTS
  isEncrypted ON TABLE settings
  TYPE bool
  ;

DEFINE FIELD IF NOT EXISTS
  updatedAt ON TABLE settings
  TYPE datetime
  VALUE time::now()
  ;

-- Combination of setting and user (or lack of it) is unique
DEFINE INDEX unique_setting
  ON setting
  FIELDS name --, user
  UNIQUE
  ;
