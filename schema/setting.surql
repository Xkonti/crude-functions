-- Settings table - stores application settings (global and in future per-user)
DEFINE TABLE IF NOT EXISTS setting SCHEMAFULL TYPE NORMAL;

DEFINE FIELD IF NOT EXISTS name ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS value ON TABLE setting TYPE string;
DEFINE FIELD IF NOT EXISTS isEncrypted ON TABLE setting TYPE bool;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE setting TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE setting TYPE datetime VALUE time::now();

DEFINE INDEX unique_setting ON setting FIELDS name UNIQUE;
