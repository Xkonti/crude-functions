/** Log levels captured from console methods */
export type ConsoleLogLevel = "log" | "debug" | "info" | "warn" | "error" | "trace";

/** A captured console log entry */
export interface ConsoleLog {
  id: number;
  requestId: string;
  routeId: number;
  level: ConsoleLogLevel;
  message: string;
  args?: string; // JSON-serialized additional arguments
  timestamp: Date;
}

/** Context for the current request, stored in AsyncLocalStorage */
export interface RequestContext {
  requestId: string;
  routeId: number;
}

/** Input type for storing a new console log (id and timestamp are auto-generated) */
export type NewConsoleLog = Omit<ConsoleLog, "id" | "timestamp">;
