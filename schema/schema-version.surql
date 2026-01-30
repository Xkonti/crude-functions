-- Schema version tracking table
DEFINE TABLE IF NOT EXISTS schemaVersion SCHEMAFULL TYPE NORMAL;
DEFINE FIELD IF NOT EXISTS version ON TABLE schemaVersion TYPE int;
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE schemaVersion TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE schemaVersion TYPE datetime VALUE time::now();

-- Index for version lookups
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
