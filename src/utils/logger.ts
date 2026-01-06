import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";

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

/** Default refresh interval for log level (5 seconds) */
const REFRESH_INTERVAL_MS = 5000;

// Module-level state
let settingsService: SettingsService | null = null;
let currentLogLevel: LogLevel = "info";
let refreshIntervalId: number | null = null;

/**
 * Initialize the logger with a settings service.
 * Starts periodic refresh of log level from database.
 * Should be called once during application startup after settings service is ready.
 *
 * @param settings - The settings service instance
 */
export function initializeLogger(settings: SettingsService): void {
  settingsService = settings;

  // Initial synchronous-ish load (fire and forget, but happens immediately)
  refreshLogLevel();

  // Start periodic refresh
  refreshIntervalId = setInterval(() => {
    refreshLogLevel();
  }, REFRESH_INTERVAL_MS);
}

/**
 * Stop the log level refresh interval.
 * Should be called during graceful shutdown.
 */
export function stopLoggerRefresh(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

/**
 * Refresh log level from settings service.
 * Fire-and-forget async operation - errors are silently ignored.
 */
function refreshLogLevel(): void {
  if (!settingsService) return;

  settingsService
    .getGlobalSetting(SettingNames.LOG_LEVEL)
    .then((level) => {
      if (level && level.toLowerCase() in LOG_LEVELS) {
        currentLogLevel = level.toLowerCase() as LogLevel;
      }
    })
    .catch(() => {
      // Silently ignore errors, keep current level
    });
}

/**
 * Simple logger with configurable log levels.
 *
 * Log level is read from the database settings and refreshed every 5 seconds.
 * Before initialization, defaults to "info".
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
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.debug) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.info) {
      console.info(`[INFO] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (LOG_LEVELS[currentLogLevel] <= LOG_LEVELS.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
};
