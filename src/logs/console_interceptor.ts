import type { ConsoleLogService } from "./console_log_service.ts";
import type { ConsoleLogLevel } from "./types.ts";
import { getCurrentRequestContext } from "./request_context.ts";

/** Console methods that are intercepted */
export type InterceptedConsoleMethod = "log" | "debug" | "info" | "warn" | "error" | "trace";

const INTERCEPTED_METHODS: InterceptedConsoleMethod[] = [
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "trace",
];

// Store original console methods for system-level logging
// deno-lint-ignore no-explicit-any
type ConsoleMethod = (...args: any[]) => void;

const originalConsoleMethods: Record<InterceptedConsoleMethod, ConsoleMethod> = {
  log: console.log.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  trace: console.trace.bind(console),
};

/**
 * Original console methods that bypass interception.
 * Use these for system-level logging that should not be captured.
 */
export const originalConsole = {
  log: originalConsoleMethods.log,
  debug: originalConsoleMethods.debug,
  info: originalConsoleMethods.info,
  warn: originalConsoleMethods.warn,
  error: originalConsoleMethods.error,
  trace: originalConsoleMethods.trace,
};

export interface ConsoleInterceptorOptions {
  logService: ConsoleLogService;
}

/**
 * Intercepts console methods to capture logs from function handlers.
 *
 * When code runs within a request context (via runInRequestContext),
 * console calls are captured and stored in the database.
 *
 * When code runs outside a request context (system code),
 * console calls pass through to the original console.
 */
export class ConsoleInterceptor {
  private readonly logService: ConsoleLogService;
  private isInstalled = false;

  constructor(options: ConsoleInterceptorOptions) {
    this.logService = options.logService;
  }

  /**
   * Install console method patches.
   * Call this once at application startup.
   */
  install(): void {
    if (this.isInstalled) return;

    for (const method of INTERCEPTED_METHODS) {
      console[method] = this.createInterceptor(method);
    }

    this.isInstalled = true;
  }

  /**
   * Restore original console methods.
   * Primarily useful for testing.
   */
  uninstall(): void {
    if (!this.isInstalled) return;

    for (const method of INTERCEPTED_METHODS) {
      console[method] = originalConsoleMethods[method];
    }

    this.isInstalled = false;
  }

  private createInterceptor(method: InterceptedConsoleMethod): ConsoleMethod {
    const logService = this.logService;

    return function (...args: unknown[]): void {
      const context = getCurrentRequestContext();

      if (context) {
        // Inside a request context - capture the log, don't output
        const [firstArg, ...restArgs] = args;

        // Fire-and-forget storage (don't await, don't block)
        logService
          .store({
            requestId: context.requestId,
            routeId: context.routeId,
            level: method as ConsoleLogLevel,
            message: serializeMessage(firstArg),
            args: restArgs.length > 0 ? serializeArgs(restArgs) : undefined,
          })
          .catch((err) => {
            // Log storage failure to original console (not captured)
            originalConsole.error("[ConsoleInterceptor] Failed to store log:", err);
          });

        // Per requirements: captured logs should NOT be forwarded to actual console
        // So we don't call originalConsoleMethods[method] here
      } else {
        // Outside request context (system logs) - pass through to original
        originalConsoleMethods[method](...args);
      }
    };
  }
}

/**
 * Serialize a value to a string for storage.
 */
function serializeMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Serialize additional arguments to JSON for storage.
 */
function serializeArgs(args: unknown[]): string | undefined {
  if (args.length === 0) return undefined;

  try {
    return JSON.stringify(args);
  } catch {
    // If JSON serialization fails, convert each arg to string
    return JSON.stringify(args.map((arg) => String(arg)));
  }
}
