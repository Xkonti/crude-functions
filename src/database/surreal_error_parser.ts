/**
 * SurrealDB error parser - extracts structured information from constraint violation errors
 */

// ============== Parsed Error Types ==============

/** Parsed unique index constraint violation */
export interface IndexViolation {
  type: "index_violation";
  /** Name of the violated index (e.g., "unique_functionDef_name") */
  indexName: string;
  /** The conflicting value that already exists */
  conflictingValue: string;
  /** Full record ID of the existing conflicting record (e.g., "functionDef:abc123") */
  existingRecordId: string;
}

/** Parsed event-thrown error with tagged fields */
export interface EventError {
  type: "event_error";
  /** Name of the event that threw the error (e.g., "check_route_method_overlap") */
  eventName: string;
  /** Error code extracted from [CODE] ... [CODE] tags, if present */
  code: string | null;
  /** Tagged field values extracted from the message (e.g., { ROUTE: "/users" }) */
  fields: Record<string, string>;
  /** The raw error message after the event prefix */
  rawMessage: string;
}

/** Unrecognized error format */
export interface UnknownError {
  type: "unknown";
  /** Original error message */
  message: string;
}

export type ParsedSurrealError = IndexViolation | EventError | UnknownError;

// ============== Regex Patterns ==============

// Pattern: Database index `<name>` already contains '<value>' | [<values>], with record `<table>:<id>`
const INDEX_VIOLATION_PATTERN =
  /Database index `([^`]+)` already contains (.+?), with record `([^`]+)`/;

// Pattern: Error while processing event <name>: An error occurred: <message>
const EVENT_ERROR_PATTERN =
  /Error while processing event ([^:]+): An error occurred: (.+)/;

// ============== Public Functions ==============

/**
 * Parse a SurrealDB error into a structured format.
 * Identifies index violations and event errors, extracting relevant fields.
 */
export function parseSurrealError(error: unknown): ParsedSurrealError {
  const message = getErrorMessage(error);

  // Try to parse as index violation
  const indexMatch = message.match(INDEX_VIOLATION_PATTERN);
  if (indexMatch) {
    return {
      type: "index_violation",
      indexName: indexMatch[1],
      conflictingValue: indexMatch[2],
      existingRecordId: indexMatch[3],
    };
  }

  // Try to parse as event error
  const eventMatch = message.match(EVENT_ERROR_PATTERN);
  if (eventMatch) {
    const eventName = eventMatch[1].trim();
    const rawMessage = eventMatch[2];

    return {
      type: "event_error",
      eventName,
      code: extractTaggedValue(rawMessage, "CODE"),
      fields: extractAllTaggedFields(rawMessage),
      rawMessage,
    };
  }

  // Unknown format
  return {
    type: "unknown",
    message,
  };
}

/**
 * Extract a single tagged value from a message.
 * Tags are in format: [TAG] value [TAG]
 *
 * @example
 * extractTaggedValue("[CODE] ERROR_123 [CODE] Something went wrong", "CODE")
 * // Returns: "ERROR_123"
 */
export function extractTaggedValue(
  message: string,
  tag: string
): string | null {
  const pattern = new RegExp(`\\[${tag}\\]\\s*(.+?)\\s*\\[${tag}\\]`);
  const match = message.match(pattern);
  return match ? match[1].trim() : null;
}

// ============== Internal Helpers ==============

/**
 * Extract the error message from various error types.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Extract all tagged fields from a message.
 * Returns a record of tag name -> value.
 */
function extractAllTaggedFields(message: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Find all [TAG] value [TAG] patterns
  const pattern = /\[([A-Z_]+)\]\s*(.+?)\s*\[\1\]/g;
  let match;

  while ((match = pattern.exec(message)) !== null) {
    const tag = match[1];
    const value = match[2].trim();
    // Skip CODE since it's handled separately
    if (tag !== "CODE") {
      fields[tag] = value;
    }
  }

  return fields;
}
