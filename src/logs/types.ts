/** Log levels captured from console methods, streams, and execution events */
export type ConsoleLogLevel =
  | "log" | "debug" | "info" | "warn" | "error" | "trace"
  | "stdout" | "stderr"
  | "exec_start" | "exec_end" | "exec_reject";

/** A captured console log entry */
export interface ConsoleLog {
  id: number;
  requestId: string;
  routeId: string;  // SurrealDB RecordId string (was number before routes migration)
  level: ConsoleLogLevel;
  message: string;
  args?: string; // JSON-serialized additional arguments
  timestamp: Date;
}

/** Context for the current request, stored in AsyncLocalStorage */
export interface RequestContext {
  requestId: string;
  routeId: string;  // SurrealDB RecordId string (was number before routes migration)
}

/** Input type for storing a new console log (id and timestamp are auto-generated) */
export type NewConsoleLog = Omit<ConsoleLog, "id" | "timestamp">;

/** Pagination cursor combining timestamp and ID for robust pagination */
export interface PaginationCursor {
  timestamp: string; // ISO timestamp
  id: number;
}

/** Options for paginated log queries */
export interface GetPaginatedOptions {
  routeId?: string;  // SurrealDB RecordId string (was number before routes migration)
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
