/** Log levels captured from console methods, streams, and execution events */
export type ConsoleLogLevel =
  | "log" | "debug" | "info" | "warn" | "error" | "trace"
  | "stdout" | "stderr"
  | "exec_start" | "exec_end" | "exec_reject";

/** A captured console log entry */
export interface ConsoleLog {
  id: string;  // SurrealDB RecordId string (e.g., "abc123xyz" part of executionLog:abc123xyz)
  requestId: string;
  functionId: string;  // SurrealDB RecordId string of functionDef (empty string for orphaned logs)
  level: ConsoleLogLevel;
  message: string;
  args?: string; // JSON-serialized additional arguments
  sequence: number; // Sequence number within batch for ordering
  timestamp: Date;
}

/** Context for the current request, stored in AsyncLocalStorage */
export interface RequestContext {
  requestId: string;
  functionId: string;  // SurrealDB RecordId string of functionDef
}

/** Input type for storing a new console log (id, sequence, and timestamp are auto-generated) */
export type NewConsoleLog = Omit<ConsoleLog, "id" | "sequence" | "timestamp">;

/** Pagination cursor combining timestamp and sequence for robust pagination */
export interface PaginationCursor {
  timestamp: string; // ISO timestamp
  sequence: number;  // Sequence number within batch (for same-timestamp ordering)
}

/** Options for paginated log queries */
export interface GetPaginatedOptions {
  functionId?: string;  // SurrealDB RecordId string of functionDef
  levels?: ConsoleLogLevel[]; // Optional log level filtering
  limit: number; // 1-1000
  cursor?: string; // base64-encoded PaginationCursor
}

/** Result of paginated log query */
export interface PaginatedLogsResult {
  logs: ConsoleLog[];
  hasMore: boolean;
  nextCursor?: string; // base64-encoded PaginationCursor
  prevCursor?: string; // base64-encoded PaginationCursor
}
