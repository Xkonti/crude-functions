/**
 * Log levels in order of verbosity (most verbose first)
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Gets the configured log level from environment variable.
 * Defaults to "info" if not set or invalid.
 */
function getLogLevel(): LogLevel {
  const level = Deno.env.get("LOG_LEVEL")?.toLowerCase();
  if (level && level in LOG_LEVELS) {
    return level as LogLevel;
  }
  return "info";
}

/**
 * Simple logger with configurable log levels via LOG_LEVEL env var.
 *
 * Log levels (from most to least verbose):
 * - debug: Detailed debugging information
 * - info: General operational information (default)
 * - warn: Warning messages
 * - error: Error messages only
 * - none: No logging
 */
export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[getLogLevel()] <= LOG_LEVELS.debug) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[getLogLevel()] <= LOG_LEVELS.info) {
      console.info(`[INFO] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[getLogLevel()] <= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[getLogLevel()] <= LOG_LEVELS.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
};
