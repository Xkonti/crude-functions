import process from "node:process";
import type { ConsoleLogService } from "./console_log_service.ts";
import type { ConsoleLogLevel } from "./types.ts";
import { getCurrentRequestContext } from "./request_context.ts";

/** Console methods that are intercepted */
type InterceptedConsoleMethod = "log" | "debug" | "info" | "warn" | "error" | "trace";

const INTERCEPTED_METHODS: InterceptedConsoleMethod[] = [
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "trace",
];

// Store original methods for system-level logging
// deno-lint-ignore no-explicit-any
type ConsoleMethod = (...args: any[]) => void;

// deno-lint-ignore no-explicit-any
type WriteFunction = (...args: any[]) => boolean;

// Deno.stdout/stderr write method types
type DenoWriteSync = (p: Uint8Array) => number;
type DenoWrite = (p: Uint8Array) => Promise<number>;

const originalConsoleMethods: Record<InterceptedConsoleMethod, ConsoleMethod> = {
  log: console.log.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  trace: console.trace.bind(console),
};

const originalStdoutWrite: WriteFunction = process.stdout.write.bind(process.stdout);
const originalStderrWrite: WriteFunction = process.stderr.write.bind(process.stderr);

// Original Deno stdout/stderr methods
const originalDenoStdoutWriteSync: DenoWriteSync = Deno.stdout.writeSync.bind(Deno.stdout);
const originalDenoStdoutWrite: DenoWrite = Deno.stdout.write.bind(Deno.stdout);
const originalDenoStderrWriteSync: DenoWriteSync = Deno.stderr.writeSync.bind(Deno.stderr);
const originalDenoStderrWrite: DenoWrite = Deno.stderr.write.bind(Deno.stderr);

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

/**
 * Original stream write methods that bypass interception.
 * Use these for system-level output that should not be captured.
 */
export const originalStreams = {
  stdout: originalStdoutWrite,
  stderr: originalStderrWrite,
  denoStdout: {
    write: originalDenoStdoutWrite,
    writeSync: originalDenoStdoutWriteSync,
  },
  denoStderr: {
    write: originalDenoStderrWrite,
    writeSync: originalDenoStderrWriteSync,
  },
};

export interface StreamInterceptorOptions {
  logService: ConsoleLogService;
}

/**
 * Intercepts all output streams to capture logs from function handlers:
 * - process.stdout/stderr (Node.js compat layer)
 * - Deno.stdout/stderr (native Deno API)
 * - console.* methods (to preserve log level information)
 *
 * This captures output from npm packages like `debug` that write directly
 * to streams, bypassing console.* methods.
 *
 * When code runs within a request context (via runInRequestContext),
 * output is captured and stored in the database.
 *
 * When code runs outside a request context (system code),
 * output passes through to the original streams.
 */
export class StreamInterceptor {
  private readonly logService: ConsoleLogService;
  private isInstalled = false;

  // Track if we're currently processing a console.* call to avoid double-capture
  private inConsoleCall = false;
  private currentConsoleLevel: ConsoleLogLevel | null = null;

  constructor(options: StreamInterceptorOptions) {
    this.logService = options.logService;
  }

  /**
   * Install stream and console method patches.
   * Call this once at application startup.
   */
  install(): void {
    if (this.isInstalled) return;

    // Install console method interceptors (to capture log level)
    for (const method of INTERCEPTED_METHODS) {
      console[method] = this.createConsoleInterceptor(method);
    }

    // Install Node.js compat stream interceptors
    process.stdout.write = this.createStreamInterceptor("stdout", originalStdoutWrite);
    process.stderr.write = this.createStreamInterceptor("stderr", originalStderrWrite);

    // Install Deno native stream interceptors
    Deno.stdout.writeSync = this.createDenoWriteSyncInterceptor("stdout", originalDenoStdoutWriteSync);
    Deno.stdout.write = this.createDenoWriteInterceptor("stdout", originalDenoStdoutWrite);
    Deno.stderr.writeSync = this.createDenoWriteSyncInterceptor("stderr", originalDenoStderrWriteSync);
    Deno.stderr.write = this.createDenoWriteInterceptor("stderr", originalDenoStderrWrite);

    this.isInstalled = true;
  }

  /**
   * Restore original methods.
   * Primarily useful for testing.
   */
  uninstall(): void {
    if (!this.isInstalled) return;

    // Restore console methods
    for (const method of INTERCEPTED_METHODS) {
      console[method] = originalConsoleMethods[method];
    }

    // Restore Node.js compat stream write methods
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;

    // Restore Deno native stream methods
    Deno.stdout.writeSync = originalDenoStdoutWriteSync;
    Deno.stdout.write = originalDenoStdoutWrite;
    Deno.stderr.writeSync = originalDenoStderrWriteSync;
    Deno.stderr.write = originalDenoStderrWrite;

    this.isInstalled = false;
  }

  get installed(): boolean {
    return this.isInstalled;
  }

  private createConsoleInterceptor(method: InterceptedConsoleMethod): ConsoleMethod {
    return (...args: unknown[]): void => {
      const context = getCurrentRequestContext();

      if (context) {
        // Inside request context - capture the log directly
        // Console.log doesn't go through stdout.write in Deno, so we capture here
        const [firstArg, ...restArgs] = args;
        const message = serializeMessage(firstArg);
        const serializedArgs = restArgs.length > 0 ? serializeArgs(restArgs) : undefined;

        this.logService.store({
          requestId: context.requestId,
          functionId: context.functionId,
          level: method as ConsoleLogLevel,
          message,
          args: serializedArgs,
        });

        // Don't call original - logs are captured only (not forwarded to console)
      } else {
        // Outside request context - pass through directly
        originalConsoleMethods[method](...args);
      }
    };
  }

  private createStreamInterceptor(
    stream: "stdout" | "stderr",
    originalWrite: WriteFunction
  ): WriteFunction {
    const defaultLevel: ConsoleLogLevel = stream === "stdout" ? "stdout" : "stderr";

    // deno-lint-ignore no-explicit-any
    return (...args: any[]): boolean => {
      const context = getCurrentRequestContext();
      const chunk = args[0] as string | Uint8Array;

      if (context) {
        // Inside request context - capture the output
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

        // Use console level if available, otherwise use stream level
        const level = this.inConsoleCall && this.currentConsoleLevel
          ? this.currentConsoleLevel
          : defaultLevel;

        // Strip trailing newline for cleaner logs
        const message = text.replace(/\n$/, "");

        // Only store non-empty messages
        if (message.length > 0) {
          this.logService.store({
            requestId: context.requestId,
            functionId: context.functionId,
            level,
            message,
          });
        }

        // Don't write to actual stream - logs are captured only
        // But we still need to handle the callback if provided
        const encodingOrCallback = args[1];
        const callback = args[2];
        if (typeof encodingOrCallback === "function") {
          encodingOrCallback();
        } else if (typeof callback === "function") {
          callback();
        }
        return true;
      } else {
        // Outside request context - pass through to original
        return originalWrite(...args);
      }
    };
  }

  private createDenoWriteSyncInterceptor(
    stream: "stdout" | "stderr",
    originalWriteSync: DenoWriteSync
  ): DenoWriteSync {
    const defaultLevel: ConsoleLogLevel = stream === "stdout" ? "stdout" : "stderr";

    return (p: Uint8Array): number => {
      const context = getCurrentRequestContext();

      if (context) {
        // Inside request context - capture the output
        const text = new TextDecoder().decode(p);

        // Use console level if available, otherwise use stream level
        const level = this.inConsoleCall && this.currentConsoleLevel
          ? this.currentConsoleLevel
          : defaultLevel;

        // Strip trailing newline for cleaner logs
        const message = text.replace(/\n$/, "");

        // Only store non-empty messages
        if (message.length > 0) {
          this.logService.store({
            requestId: context.requestId,
            functionId: context.functionId,
            level,
            message,
          });
        }

        // Don't write to actual stream - return the byte count as if written
        return p.length;
      } else {
        // Outside request context - pass through to original
        return originalWriteSync(p);
      }
    };
  }

  private createDenoWriteInterceptor(
    stream: "stdout" | "stderr",
    originalWrite: DenoWrite
  ): DenoWrite {
    const defaultLevel: ConsoleLogLevel = stream === "stdout" ? "stdout" : "stderr";

    return (p: Uint8Array): Promise<number> => {
      const context = getCurrentRequestContext();

      if (context) {
        // Inside request context - capture the output
        const text = new TextDecoder().decode(p);

        // Use console level if available, otherwise use stream level
        const level = this.inConsoleCall && this.currentConsoleLevel
          ? this.currentConsoleLevel
          : defaultLevel;

        // Strip trailing newline for cleaner logs
        const message = text.replace(/\n$/, "");

        // Only store non-empty messages
        if (message.length > 0) {
          this.logService.store({
            requestId: context.requestId,
            functionId: context.functionId,
            level,
            message,
          });
        }

        // Don't write to actual stream - return the byte count as if written
        return Promise.resolve(p.length);
      } else {
        // Outside request context - pass through to original
        return originalWrite(p);
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
