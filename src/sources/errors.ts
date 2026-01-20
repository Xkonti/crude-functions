/**
 * Base error class for code source operations.
 */
export class CodeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeSourceError";
  }
}

/**
 * Thrown when a code source is not found.
 */
export class SourceNotFoundError extends CodeSourceError {
  constructor(public readonly identifier: string | number) {
    super(`Code source '${identifier}' not found`);
    this.name = "SourceNotFoundError";
  }
}

/**
 * Thrown when attempting to create a source with a duplicate name.
 */
export class DuplicateSourceError extends CodeSourceError {
  constructor(public readonly sourceName: string) {
    super(`Code source '${sourceName}' already exists`);
    this.name = "DuplicateSourceError";
  }
}

/**
 * Thrown when source configuration is invalid.
 */
export class InvalidSourceConfigError extends CodeSourceError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceConfigError";
  }
}

/**
 * Thrown when a sync operation fails.
 */
export class SyncError extends CodeSourceError {
  public readonly originalError?: Error;

  constructor(
    public readonly sourceId: number,
    message: string,
    originalError?: Error,
  ) {
    super(`Sync failed for source ${sourceId}: ${message}`);
    this.name = "SyncError";
    this.originalError = originalError;
  }
}

/**
 * Thrown when attempting to modify files in a non-editable source.
 */
export class SourceNotEditableError extends CodeSourceError {
  constructor(
    public readonly sourceName: string,
    public readonly sourceType: string,
  ) {
    super(`Source '${sourceName}' (type: ${sourceType}) is not editable`);
    this.name = "SourceNotEditableError";
  }
}

/**
 * Thrown when attempting to sync a non-syncable source (manual).
 */
export class SourceNotSyncableError extends CodeSourceError {
  constructor(public readonly sourceName: string) {
    super(`Source '${sourceName}' is a manual source and cannot be synced`);
    this.name = "SourceNotSyncableError";
  }
}

/**
 * Thrown when source directory operations fail.
 */
export class SourceDirectoryError extends CodeSourceError {
  constructor(
    public readonly sourceName: string,
    public readonly operation: string,
    message: string,
  ) {
    super(
      `Directory ${operation} failed for source '${sourceName}': ${message}`,
    );
    this.name = "SourceDirectoryError";
  }
}

/**
 * Thrown when webhook authentication fails.
 */
export class WebhookAuthError extends CodeSourceError {
  constructor(public readonly sourceName: string) {
    super(`Webhook authentication failed for source '${sourceName}'`);
    this.name = "WebhookAuthError";
  }
}

/**
 * Thrown when no provider is registered for a source type.
 */
export class ProviderNotFoundError extends CodeSourceError {
  constructor(public readonly sourceType: string) {
    super(`No provider registered for source type '${sourceType}'`);
    this.name = "ProviderNotFoundError";
  }
}
